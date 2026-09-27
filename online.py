"""Aplicação WSGI: autenticação, armazenamento privado e exportação."""
import json
import os
import re
import tempfile
from http import HTTPStatus
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from export_excel import export, DEFAULT_TEMPLATE

ROOT = Path(__file__).resolve().parent
LIMIT = 2_000_000
ASSETS = {'/src/organizer.js', '/src/app.js', '/src/calendar.js', '/src/template-map.js', '/src/online-store.js'}


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
        if not isinstance(key, str) or not re.fullmatch(r'rt-upa:(organizer|doctors|fixed|absences|visits:weekly|edits:\d{4}:\d{1,2}:[12])', key):
            raise ApiError(400, 'Registro desconhecido no backup.')
        if not isinstance(value, str):
            raise ApiError(400, 'Backup inválido.')
        try:
            parsed = json.loads(value)
        except (ValueError, TypeError):
            raise ApiError(400, 'Backup inválido.')
        name = key[7:]
        if name == 'organizer':
            if not isinstance(parsed, list) or len(parsed) > 2000:
                raise ApiError(400, 'Lista de anotações inválida.')
            seen = set()
            for item in parsed:
                if not isinstance(item, dict) or set(item) != {'id', 'kind', 'title', 'body', 'date', 'reminder', 'shift', 'status', 'doctor', 'cover'}:
                    raise ApiError(400, 'Anotação inválida.')
                limits = {'id': 100, 'title': 160, 'body': 10000, 'doctor': 500, 'cover': 500}
                if any(not isinstance(item.get(k), str) or len(item[k]) > limit for k, limit in limits.items()):
                    raise ApiError(400, 'Texto de anotação inválido.')
                if not item['id'] or item['id'] in seen or not item['title'].strip():
                    raise ApiError(400, 'Identificação de anotação inválida.')
                seen.add(item['id'])
                if item['kind'] not in ('task', 'note') or item['status'] not in ('Precisa de cobertura', 'Aguardando confirmação', 'Em acompanhamento', 'Resolvido') or item['shift'] not in ('', 'Diurno', 'Noturno', 'Visitador'):
                    raise ApiError(400, 'Situação de anotação inválida.')
                from datetime import date
                for field in ('date', 'reminder'):
                    value = item[field]
                    if not isinstance(value, str):
                        raise ApiError(400, 'Data inválida.')
                    if value:
                        try:
                            if date.fromisoformat(value).isoformat() != value:
                                raise ValueError()
                        except ValueError:
                            raise ApiError(400, 'Data inválida.')
        elif name in ('doctors', 'fixed', 'absences'):
            if not isinstance(parsed, list) or len(parsed) > 2000:
                raise ApiError(400, 'Lista inválida.')
            for item in parsed:
                if name == 'doctors':
                    valid = isinstance(item, str) and len(item) <= 500
                elif name == 'fixed':
                    valid = isinstance(item, dict) and type(item.get('weekday')) is int and 0 <= item['weekday'] <= 6 and type(item.get('slot')) is int and 0 <= item['slot'] < 14 and isinstance(item.get('doctor'), str) and len(item['doctor']) <= 500
                else:
                    valid = isinstance(item, dict) and isinstance(item.get('doctor'), str) and all(isinstance(item.get(k), str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', item[k]) for k in ('start', 'end')) and item['start'] <= item['end']
                if not valid:
                    raise ApiError(400, 'Registro inválido.')
        else:
            if not isinstance(parsed, dict) or len(parsed) > 500:
                raise ApiError(400, 'Grade inválida.')
            pattern = r'[0-6]\|[01]' if name == 'visits:weekly' else r'\d{4}-\d{2}-\d{2}\|(?:[0-9]|1[0-3])'
            if any(not re.fullmatch(pattern, k) or not isinstance(v, str) or len(v) > 500 for k, v in parsed.items()):
                raise ApiError(400, 'Posição inválida na grade.')
        result[name] = parsed
    return result


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
