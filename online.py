"""Aplicação WSGI: autenticação, armazenamento privado e exportação."""
import base64
import json
import os
import re
import tempfile
from http import HTTPStatus
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import urlparse, quote

from export_excel import export, export_cinderela, DEFAULT_TEMPLATE

ROOT = Path(__file__).resolve().parent
LIMIT = 2_000_000
ASSETS = {'/src/assistant.js','/src/doctor-picker.js','/src/quick-view.js','/src/pdf.js','/src/roster.js','/src/scheduling.js','/src/coverage-ui.js','/src/schedule-view.js','/src/push.js', '/src/organizer.js', '/src/app.js', '/src/calendar.js', '/src/template-map.js', '/src/online-store.js', '/src/flow.js'}
# Um painel por processo: o token do Gestor Saúde e a última leitura ficam só em memória.
FLUXO = None


class ApiError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def remote(path, method='GET', data=None, token=None):
    url = os.environ.get('SUPABASE_URL', '').rstrip('/')
    key = os.environ.get('SUPABASE_PUBLISHABLE_KEY', '')
    if not url.startswith('https://') or not key:
        raise ApiError(503, 'O acesso online ainda está em configuração.')
    headers = {'apikey': key, 'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    request = Request(url + path, method=method, headers=headers,
                      data=None if data is None else json.dumps(data).encode())
    try:
        with urlopen(request, timeout=15) as response:
            body = response.read()
            return json.loads(body) if body else None
    except HTTPError as error:
        if error.code in (400, 401, 403) and path.startswith('/auth/'):
            raise ApiError(401, 'Confira seu acesso e entre novamente.') from error
        if error.code == 429:
            raise ApiError(429, 'Muitas tentativas. Aguarde antes de tentar novamente.') from error
        if error.code == 409:
            raise ApiError(409, 'A escala mudou em outro dispositivo. Baixe um backup e atualize antes de salvar.') from error
        raise ApiError(503, 'Não foi possível acessar seus dados. Tente novamente.') from error
    except (URLError, TimeoutError) as error:
        raise ApiError(503, 'Serviço temporariamente indisponível. Suas alterações continuam nesta tela.') from error


def validate_items(items):
    if not isinstance(items, dict) or len(items) > 1000:
        raise ApiError(400, 'Backup inválido.')
    result = {}
    for key, value in items.items():
        if not isinstance(key, str) or not re.fullmatch(r'rt-upa:(roster|coverages|organizer|doctors|fixed|absences|visits:weekly|edits:\d{4}:\d{1,2}:[12])', key):
            raise ApiError(400, 'Registro desconhecido no backup.')
        if not isinstance(value, str):
            raise ApiError(400, 'Backup inválido.')
        try:
            parsed = json.loads(value)
        except (ValueError, TypeError):
            raise ApiError(400, 'Backup inválido.')
        name = key[7:]
        if name == 'coverages':
            if not isinstance(parsed,list) or len(parsed)>2000:
                raise ApiError(400,'Lista de coberturas inválida.')
            seen=set()
            for item in parsed:
                if not isinstance(item,dict) or set(item)!={'id','taskId','date','slot','start','end','doctor','original','confirmed'}:
                    raise ApiError(400,'Cobertura inválida.')
                if any(not isinstance(item.get(k),str) or len(item[k])>500 for k in ('id','taskId','date','doctor','original')) or not item['id'] or item['id'] in seen or not item['doctor']:
                    raise ApiError(400,'Dados de cobertura inválidos.')
                seen.add(item['id'])
                from datetime import date
                try: date.fromisoformat(item['date'])
                except ValueError: raise ApiError(400,'Data de cobertura inválida.')
                slot=item['slot']
                if type(slot) is not int or not 0<=slot<=15 or type(item['confirmed']) is not bool:
                    raise ApiError(400,'Posto inválido.')
                a,b=(12,18) if slot==14 else (18,24) if slot==15 else (7,19) if slot<7 else (19,31)
                if item['start']!=a or item['end']!=b:
                    raise ApiError(400,'A cobertura deve corresponder ao horário completo do posto.')
            active=[x for x in parsed if x['confirmed']]
            if len({(x['date'],x['slot']) for x in active})!=len(active):
                raise ApiError(400,'Há coberturas confirmadas duplicadas no mesmo posto.')
        elif name == 'organizer':
            if not isinstance(parsed, list) or len(parsed) > 2000:
                raise ApiError(400, 'Lista de anotações inválida.')
            seen = set()
            for item in parsed:
                if not isinstance(item, dict) or not {'id', 'kind', 'title', 'body', 'date', 'reminder', 'shift', 'status', 'doctor', 'cover'}.issubset(item) or isinstance(item,dict) and set(item)-{'id','kind','title','body','date','reminder','shift','status','doctor','cover','type','needed','endDate'}:
                    raise ApiError(400, 'Anotação inválida.')
                if item.get('type','Cobertura') not in ('Cobertura','Troca de plantão','Atestado / afastamento','Férias','Outro') or type(item.get('needed',1)) is not int or not 1<=item.get('needed',1)<=20:
                    raise ApiError(400,'Tipo ou quantidade de cobertura inválidos.')
                limits = {'id': 100, 'title': 160, 'body': 10000, 'doctor': 500, 'cover': 500}
                if any(not isinstance(item.get(k), str) or len(item[k]) > limit for k, limit in limits.items()):
                    raise ApiError(400, 'Texto de anotação inválido.')
                if not item['id'] or item['id'] in seen or not item['title'].strip():
                    raise ApiError(400, 'Identificação de anotação inválida.')
                seen.add(item['id'])
                if item['kind'] not in ('task', 'note') or item['status'] not in ('Precisa de cobertura', 'Aguardando confirmação', 'Em acompanhamento', 'Resolvido') or item['shift'] not in ('', 'Diurno', 'Noturno', 'Visitador', 'Cinderela'):
                    raise ApiError(400, 'Situação de anotação inválida.')
                from datetime import date
                for field in ('date', 'reminder', 'endDate'):
                    value = item.get(field, '')
                    if not isinstance(value, str):
                        raise ApiError(400, 'Data inválida.')
                    if value:
                        try:
                            if date.fromisoformat(value).isoformat() != value:
                                raise ValueError()
                        except ValueError:
                            raise ApiError(400, 'Data inválida.')
                if item.get('type') == 'Férias' and item['kind'] == 'task' and (not item['doctor'].strip() or not item['date'] or not item.get('endDate') or item['endDate'] < item['date']):
                    raise ApiError(400, 'Confira médico e período das férias.')
        elif name == 'roster':
            if not isinstance(parsed,list) or len(parsed)>2000:
                raise ApiError(400,'Lista de dias fixos inválida.')
            seen=set()
            from datetime import date
            for item in parsed:
                if not isinstance(item,dict) or not {'id','start','weekday','slot','doctor'}.issubset(item) or set(item)-{'id','start','weekday','slot','doctor','repeatExtra'} or not isinstance(item.get('id'),str) or not 1<=len(item['id'])<=100 or type(item.get('weekday')) is not int or not 0<=item['weekday']<=6 or type(item.get('slot')) is not int or not 0<=item['slot']<16 or not isinstance(item.get('doctor'),str) or len(item['doctor'])>500:
                    raise ApiError(400,'Dia fixo inválido.')
                try:
                    if date.fromisoformat(item['start']).isoformat()!=item['start']:raise ValueError()
                except (ValueError,TypeError):raise ApiError(400,'Data de vigência inválida.')
                key=(item['start'],item['weekday'],item['slot'])
                if key in seen:raise ApiError(400,'Dois padrões para o mesmo posto e data.')
                if 'repeatExtra' in item and type(item['repeatExtra']) is not bool:raise ApiError(400,'Repetição inválida.')
                if 'EXTRA' in item['doctor'].upper() and item.get('repeatExtra') is not True:raise ApiError(400,'Confirme a repetição semanal do extra.')
                seen.add(key)
        elif name in ('doctors', 'fixed', 'absences'):
            if not isinstance(parsed, list) or len(parsed) > 2000:
                raise ApiError(400, 'Lista inválida.')
            for item in parsed:
                if name == 'doctors':
                    valid = isinstance(item, str) and len(item) <= 500
                elif name == 'fixed':
                    valid = isinstance(item, dict) and type(item.get('weekday')) is int and 0 <= item['weekday'] <= 6 and type(item.get('slot')) is int and 0 <= item['slot'] < 16 and isinstance(item.get('doctor'), str) and len(item['doctor']) <= 500
                else:
                    valid = isinstance(item, dict) and isinstance(item.get('doctor'), str) and all(isinstance(item.get(k), str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', item[k]) for k in ('start', 'end')) and item['start'] <= item['end']
                if not valid:
                    raise ApiError(400, 'Registro inválido.')
        else:
            if not isinstance(parsed, dict) or len(parsed) > 500:
                raise ApiError(400, 'Grade inválida.')
            pattern = r'[0-6]\|[01]' if name == 'visits:weekly' else r'\d{4}-\d{2}-\d{2}\|(?:[0-9]|1[0-5])'
            if any(not re.fullmatch(pattern, k) or not isinstance(v, str) or len(v) > 500 for k, v in parsed.items()):
                raise ApiError(400, 'Posição inválida na grade.')
        result[name] = parsed
    return result


def validate_subscription(sub):
    if not isinstance(sub, dict) or not isinstance(sub.get('endpoint'), str):
        raise ApiError(400, 'Aparelho inválido.')
    endpoint = sub['endpoint']
    parsed = urlparse(endpoint)
    host = parsed.hostname or ''
    if len(endpoint) > 2048 or parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port or parsed.fragment or not (host in ('web.push.apple.com', 'fcm.googleapis.com', 'updates.push.services.mozilla.com') or host.endswith('.push.services.mozilla.com')):
        raise ApiError(400, 'Serviço de notificações não reconhecido.')
    keys = sub.get('keys')
    if not isinstance(keys, dict):
        raise ApiError(400, 'Chaves inválidas.')
    for name, size in [('p256dh', 65), ('auth', 16)]:
        value = keys.get(name, '')
        if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]+={0,2}', value) or len(value)>100:
            raise ApiError(400, 'Chaves inválidas.')
        try:
            decoded = base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))
        except ValueError:
            raise ApiError(400, 'Chaves inválidas.')
        if len(decoded) != size or (name == 'p256dh' and decoded[0] != 4):
            raise ApiError(400, 'Chaves inválidas.')


def app(environ, start_response):
    extra = []
    def respond(status, body, content_type='application/json; charset=utf-8'):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode('utf8')
        elif isinstance(body, str):
            body = body.encode('utf8')
        headers = [('Content-Type', content_type), ('Cache-Control', 'no-store'),
                   ('X-Content-Type-Options', 'nosniff'), ('Referrer-Policy', 'same-origin'),
                   ('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"), *extra]
        start_response(f'{status} {HTTPStatus(status).phrase}', headers)
        # Iterator allows streaming the official workbook, which exceeds 4.5 MB.
        return (body[i:i + 65536] for i in range(0, len(body), 65536))

    def cookie(value, age=3600):
        secure = '' if os.environ.get('APP_ORIGIN', '').startswith('http://127.0.0.1:') else '; Secure'
        extra.append(('Set-Cookie', f'rt_session={value}; Path=/; HttpOnly; SameSite=Strict; Max-Age={age}{secure}'))

    try:
        path, method = environ.get('PATH_INFO', '/'), environ.get('REQUEST_METHOD', 'GET')
        if method not in ('GET', 'POST', 'PUT'):
            raise ApiError(405, 'Método não permitido.')
        payload = None
        if method != 'GET':
            origin = os.environ.get('APP_ORIGIN', '').rstrip('/')
            if not origin or environ.get('HTTP_ORIGIN') != origin:
                raise ApiError(403, 'Origem da solicitação não autorizada.')
            if environ.get('CONTENT_TYPE', '').split(';')[0] != 'application/json':
                raise ApiError(415, 'Envie dados JSON.')
            length = int(environ.get('CONTENT_LENGTH') or 0)
            if not 0 < length <= LIMIT:
                raise ApiError(413, 'Arquivo muito grande ou vazio.')
            payload = json.loads(environ['wsgi.input'].read(length))
            if not isinstance(payload, dict):
                raise ApiError(400, 'Pedido inválido.')

        if method == 'GET' and path in ('/sw.js', '/manifest.webmanifest', '/icon.png'):
            if path == '/icon.png':
                return respond(200, base64.b64decode((ROOT / 'icon.png.b64').read_text()), 'image/png')
            return respond(200, (ROOT / path.lstrip('/')).read_bytes(), 'text/javascript; charset=utf-8' if path == '/sw.js' else 'application/manifest+json')
        if path == '/src/dark.css' and method == 'GET':
            return respond(200,(ROOT/'src/dark.css').read_bytes(),'text/css; charset=utf-8')
        if path == '/login' and method == 'GET':
            return respond(200, (ROOT / 'login.html').read_bytes(), 'text/html; charset=utf-8')
        if path == '/src/login.js' and method == 'GET':
            return respond(200, (ROOT / 'src/login.js').read_bytes(), 'text/javascript; charset=utf-8')
        if path == '/api/login' and method == 'POST':
            email, password = payload.get('email'), payload.get('password')
            if not isinstance(email, str) or not isinstance(password, str) or len(email) > 320 or len(password) > 1000:
                raise ApiError(400, 'Informe e-mail e senha.')
            session = remote('/auth/v1/token?grant_type=password', 'POST', {'email': email, 'password': password})
            token = session['access_token']
            members = remote('/rest/v1/rt_members?select=user_id', token=token)
            if not members:
                raise ApiError(403, 'Esta conta ainda não tem acesso ao RT UPA Sul.')
            cookie(token, min(int(session.get('expires_in', 3600)), 3600))
            return respond(200, {'ok': True})
        cookies = SimpleCookie(environ.get('HTTP_COOKIE', ''))
        token = cookies['rt_session'].value if 'rt_session' in cookies else None
        if path == '/api/logout' and method == 'POST':
            cookie('', 0)
            if token:
                remote('/auth/v1/logout?scope=local', 'POST', {}, token)
            return respond(200, {'ok': True})
        if not token:
            if path in ('/', '/index.html'):
                extra.append(('Location', '/login'))
                return respond(303, '')
            raise ApiError(401, 'Entre na sua conta para continuar.')
        user = remote('/auth/v1/user', token=token)
        if user.get('is_anonymous') or not remote('/rest/v1/rt_members?select=user_id', token=token):
            raise ApiError(403, 'Acesso não autorizado.')
        if path in ('/', '/index.html') and method == 'GET':
            return respond(200, (ROOT / 'index.html').read_bytes(), 'text/html; charset=utf-8')
        if path in ASSETS and method == 'GET':
            return respond(200, (ROOT / path.lstrip('/')).read_bytes(), 'text/javascript; charset=utf-8')
        if path == '/src/seed.json' and method == 'GET':
            return respond(200, (ROOT / 'src/seed.json').read_bytes())
        if path == '/api/session' and method == 'GET':
            return respond(200, {'email': user.get('email'), 'id': user['id']})
        if path == '/api/fluxo' and method == 'GET':
            global FLUXO
            from gestor_saude import PainelFluxo
            FLUXO = FLUXO or PainelFluxo()
            return respond(200, FLUXO.obter(forcar=environ.get('QUERY_STRING') == 'atualizar=1'))
        if path.startswith('/api/push/') and method == 'POST':
            action = path.rsplit('/', 1)[-1]
            if action == 'config':
                return respond(200, remote('/functions/v1/rt-push', 'POST', {'action': 'config'}, token))
            if action == 'subscribe':
                sub = payload.get('subscription')
                validate_subscription(sub)
                remote('/rest/v1/rpc/rt_register_push', 'POST', {'p_endpoint': sub['endpoint'], 'p_subscription': sub}, token)
                return respond(200, {'ok': True})
            endpoint = payload.get('endpoint')
            if not isinstance(endpoint, str) or len(endpoint) > 2048:
                raise ApiError(400, 'Aparelho inválido.')
            if action == 'status':
                rows = remote('/rest/v1/rt_push_subscriptions?select=enabled&endpoint=eq.' + quote(endpoint, safe=''), token=token)
                return respond(200, {'enabled': bool(rows and rows[0]['enabled'])})
            if action == 'disable':
                remote('/rest/v1/rpc/rt_disable_push', 'POST', {'p_endpoint': endpoint}, token)
                return respond(200, {'ok': True})
            if action == 'test':
                return respond(200, remote('/functions/v1/rt-push', 'POST', {'action': 'test', 'endpoint': endpoint}, token))
            raise ApiError(404, 'Ação desconhecida.')
        if path == '/api/state' and method == 'GET':
            rows = remote('/rest/v1/rt_state?select=items,revision', token=token)
            return respond(200, rows[0] if rows else {'items': {}, 'revision': 0})
        if path == '/api/state' and method == 'PUT':
            validate_items(payload.get('items'))
            revision = payload.get('revision')
            if type(revision) is not int or revision < 0:
                raise ApiError(400, 'Versão inválida.')
            result = remote('/rest/v1/rpc/save_rt_state', 'POST', {'new_items': payload['items'], 'expected_revision': revision}, token)
            return respond(200, {'revision': result})
        if path == '/api/export-cinderela' and method == 'POST':
            data=validate_items(payload.get('items'))
            with tempfile.TemporaryDirectory(prefix='rt-cinderela-') as temp:
                target=Path(temp)/'cinderelas.xlsx'
                export_cinderela(payload.get('date',''),data,target)
                body=target.read_bytes()
            extra.append(('Content-Disposition','attachment; filename="ESCALA_CINDERELAS.xlsx"'))
            return respond(200,body,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        if path == '/api/export-pdf' and method == 'POST':
            from export_pdf import export_pdf
            data=validate_items(payload.get('items'))
            try:
                body=export_pdf(payload.get('year'),payload.get('month'),payload.get('half'),payload.get('kind'),payload.get('layout'),data)
            except ValueError as error:
                raise ApiError(400,str(error))
            extra.append(('Content-Disposition','attachment; filename="ESCALA_UPA_SUL.pdf"'))
            return respond(200,body,'application/pdf')
        if path == '/api/export' and method == 'POST':
            data = validate_items(payload.get('items'))
            year, month, half = (payload.get(k) for k in ('year', 'month', 'half'))
            if any(type(v) is not int for v in (year, month, half)):
                raise ApiError(400, 'Período inválido.')
            with tempfile.TemporaryDirectory(prefix='rt-upa-') as temp:
                target = Path(temp) / 'escala.xlsx'
                export(year, month, half, data, DEFAULT_TEMPLATE, target)
                body = target.read_bytes()
            extra.append(('Content-Disposition', f'attachment; filename="ESCALA_{year}_{month:02d}_{half}.xlsx"'))
            return respond(200, body, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        raise ApiError(404, 'Página não encontrada.')
    except ApiError as error:
        return respond(error.status, {'error': error.message})
    except (ValueError, TypeError, KeyError):
        return respond(400, {'error': 'Dados inválidos. Confira o período e o backup.'})


if __name__ == '__main__':
    from wsgiref.simple_server import make_server
    print('RT UPA Sul online (teste local): http://127.0.0.1:8001/login', flush=True)
    with make_server('127.0.0.1', 8001, app) as server:
        server.serve_forever()
