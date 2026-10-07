"""Aplicação WSGI: autenticação, armazenamento privado e exportação."""
import base64
import hashlib
import json
import os
import re
import tempfile
import threading
import time
from http import HTTPStatus
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import urlparse, quote

from export_excel import export, export_cinderela, slot_bounds, nome_arquivo, content_disposition, DEFAULT_TEMPLATE

ROOT = Path(__file__).resolve().parent
LIMIT = 2_000_000
ASSETS = {'/src/ferias.js', '/src/baixas.js', '/src/datas.js', '/src/internados.js', '/src/equipe.js', '/src/documentos.js', '/src/topo.js', '/src/tema.js', '/src/assistant.js','/src/doctor-picker.js','/src/quick-view.js','/src/pdf.js','/src/roster.js','/src/scheduling.js','/src/coverage-ui.js','/src/schedule-view.js','/src/push.js', '/src/organizer.js', '/src/app.js', '/src/calendar.js', '/src/template-map.js', '/src/online-store.js', '/src/flow.js', '/src/production.js', '/src/demand.js', '/src/trocas.js', '/src/historico.js', '/src/escala-alertas.js', '/src/versoes.js', '/src/resumo.js', '/src/espera.js', '/src/cadastro.js', '/src/atencao.js', '/src/painel.js', '/src/lotacao.js'}
# Um painel por processo: o token do Gestor Saúde e a última leitura ficam só em memória.
FLUXO = None
PRODUCAO = None
DEMANDA = None
CENSO = None
INTERNACAO = None
EQUIPE = None
BAIXAS = None


def parse_minuto(valor):
    """Data e hora local de Cuiabá no formato AAAA-MM-DDTHH:MM, vindas da tela de produção."""
    from datetime import datetime
    from gestor_saude import CUIABA
    if not isinstance(valor, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}', valor):
        raise ApiError(400, 'Informe início e fim no formato de data e hora.')
    return datetime.fromisoformat(valor).replace(tzinfo=CUIABA)


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


# Sessão conferida no Supabase fica lembrada por até 5 min (nunca além do vencimento do token): antes, cada
# arquivo da página e cada sincronização faziam 2 consultas ao Supabase antes de responder.
SESSAO_CACHE_S = 300
_SESSOES = {}
_SESSOES_TRAVA = threading.Lock()


def _chave_sessao(token):
    return hashlib.sha256(token.encode()).hexdigest()


def _vencimento_jwt(token):
    try:
        parte = token.split('.')[1]
        return float(json.loads(base64.urlsafe_b64decode(parte + '=' * (-len(parte) % 4))).get('exp') or 0)
    except (IndexError, ValueError, TypeError, AttributeError):
        return 0


def usuario_autorizado(token):
    chave, agora = _chave_sessao(token), time.time()
    with _SESSOES_TRAVA:
        guardado = _SESSOES.get(chave)
    if guardado and agora < guardado[0]:
        return guardado[1]
    user = remote('/auth/v1/user', token=token)
    if user.get('is_anonymous') or not remote('/rest/v1/rt_members?select=user_id', token=token):
        raise ApiError(403, 'Acesso não autorizado.')
    validade = min(agora + SESSAO_CACHE_S, _vencimento_jwt(token) or agora + SESSAO_CACHE_S)
    with _SESSOES_TRAVA:
        if len(_SESSOES) > 500:
            _SESSOES.clear()
        _SESSOES[chave] = (validade, user)
    return user


def esquecer_sessao(token):
    with _SESSOES_TRAVA:
        _SESSOES.pop(_chave_sessao(token), None)


# Arquivos do site lidos uma vez por processo, com ETag: o navegador revalida e recebe 304 (sem corpo) se nada mudou.
_ARQUIVOS = {}


def arquivo(relativo):
    caminho = ROOT / relativo
    info = caminho.stat()
    chave = (relativo, info.st_mtime_ns, info.st_size)
    guardado = _ARQUIVOS.get(chave)
    if guardado is None:
        corpo = caminho.read_bytes()
        resumo = hashlib.sha256(corpo).hexdigest()
        # O Edge só revalida o cache com Last-Modified (ignora o ETag). A data sai do conteúdo, não do arquivo:
        # na Vercel a data dos arquivos pode ser a mesma em todo deploy, e o navegador ficaria com versão velha.
        segundos = 946684800 + int(resumo[:12], 16) % (20 * 365 * 86400)
        data = time.strftime('%a, %d %b %Y %H:%M:%S GMT', time.gmtime(segundos))
        guardado = (corpo, '"' + resumo[:24] + '"', data)
        if len(_ARQUIVOS) > 200:
            _ARQUIVOS.clear()
        _ARQUIVOS[chave] = guardado
    return guardado


def validate_items(items):
    if not isinstance(items, dict) or len(items) > 1000:
        raise ApiError(400, 'Backup inválido.')
    result = {}
    for key, value in items.items():
        if not isinstance(key, str) or not re.fullmatch(r'rt-upa:(roster|coverages|organizer|doctors|fixed|absences|trocas|historico|clinicoRoster|excluidos|atencao|lotacao|documentos|visits:weekly|edits:\d{4}:\d{1,2}:[12])', key):
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
                a,b=slot_bounds(slot,item['date'])
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
                if not isinstance(item, dict) or not {'id', 'kind', 'title', 'body', 'date', 'reminder', 'shift', 'status', 'doctor', 'cover'}.issubset(item) or isinstance(item,dict) and set(item)-{'id','kind','title','body','date','reminder','shift','status','doctor','cover','type','needed','endDate','substituto'}:
                    raise ApiError(400, 'Anotação inválida.')
                if item.get('type','Cobertura') not in ('Cobertura','Troca de plantão','Atestado / afastamento','Férias','Outro') or type(item.get('needed',1)) is not int or not 1<=item.get('needed',1)<=20:
                    raise ApiError(400,'Tipo ou quantidade de cobertura inválidos.')
                limits = {'id': 100, 'title': 160, 'body': 10000, 'doctor': 500, 'cover': 500}
                if not isinstance(item.get('substituto', ''), str) or len(item.get('substituto', '')) > 500:
                    raise ApiError(400, 'Substituto das férias inválido.')
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
        elif name == 'historico':
            # Histórico de trocas da escala (manuais e pela produção), com motivo opcional.
            if not isinstance(parsed, list) or len(parsed) > 3000:
                raise ApiError(400, 'Histórico inválido.')
            campos = {'id', 'data', 'slot', 'saiu', 'entrou', 'origem', 'motivo', 'criadoEm'}
            for item in parsed:
                if not isinstance(item, dict) or set(item) != campos or item['origem'] not in ('manual', 'produção', 'desfeita'):
                    raise ApiError(400, 'Registro de troca inválido.')
                if type(item['slot']) is not int or not 0 <= item['slot'] <= 15 or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', str(item['data'])):
                    raise ApiError(400, 'Registro de troca inválido.')
                if any(not isinstance(item[k], str) or len(item[k]) > 500 for k in ('id', 'saiu', 'entrou', 'motivo', 'criadoEm')) or len(item['motivo']) > 300:
                    raise ApiError(400, 'Registro de troca inválido.')
        elif name == 'lotacao':
            # Lotacionograma SMS: plantões por médico na semana e ajustes de área/situação de cada médico.
            if not isinstance(parsed, dict) or set(parsed) - {'porSemana', 'medicos'} or not isinstance(parsed.get('medicos', {}), dict) or len(parsed.get('medicos', {})) > 1000:
                raise ApiError(400, 'Lotação inválida.')
            if type(parsed.get('porSemana', 2)) is not int or not 1 <= parsed.get('porSemana', 2) <= 7:
                raise ApiError(400, 'Plantões por semana inválidos.')
            for chave, item in parsed.get('medicos', {}).items():
                if len(chave) > 200 or not isinstance(item, dict) or set(item) != {'nome', 'area', 'situacao'} or not isinstance(item['nome'], str) or len(item['nome']) > 500                         or item['area'] not in ('clinico', 'infantil', 'box', 'fora') or item['situacao'] not in ('ativo', 'licenca-maternidade', 'licenca', 'ferias', 'afastado'):
                    raise ApiError(400, 'Lotação de médico inválida.')
        elif name == 'atencao':
            # Médicos que merecem atenção (Painel): quando entrou, saiu e as datas das conversas do RT.
            if not isinstance(parsed, dict) or len(parsed) > 500:
                raise ApiError(400, 'Acompanhamento de médicos inválido.')
            data_ok = lambda v: v is None or (isinstance(v, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', v))
            for chave, item in parsed.items():
                if len(chave) > 500 or not isinstance(item, dict) or set(item) - {'nome', 'emAtencao', 'desde', 'conversas', 'saiuEm'}:
                    raise ApiError(400, 'Acompanhamento de médico inválido.')
                conversas = item.get('conversas', [])
                if not isinstance(item.get('nome'), str) or len(item['nome']) > 500 or type(item.get('emAtencao', False)) is not bool \
                        or not data_ok(item.get('desde')) or not data_ok(item.get('saiuEm')) \
                        or not isinstance(conversas, list) or len(conversas) > 20 or not all(data_ok(d) and d for d in conversas):
                    raise ApiError(400, 'Acompanhamento de médico inválido.')
        elif name == 'trocas':
            # Trocas detectadas pela produção (aplicadas automaticamente ou desfeitas): histórico para o alerta do Painel.
            if not isinstance(parsed, list) or len(parsed) > 2000:
                raise ApiError(400, 'Histórico de trocas inválido.')
            campos = {'id', 'data', 'turno', 'slot', 'saiu', 'entrou', 'consultas', 'status', 'criadoEm'}
            for item in parsed:
                if not isinstance(item, dict) or not campos <= set(item) or set(item) - campos - {'desde', 'parouAs'} or any(not isinstance(item.get(k, ''), str) or len(item.get(k, '')) > 20 for k in ('desde', 'parouAs')) or item['status'] not in ('aplicada', 'mantida', 'desfeita', 'ignorada') or item['turno'] not in ('D', 'N'):
                    raise ApiError(400, 'Troca inválida.')
                if type(item['slot']) is not int or not 0 <= item['slot'] <= 15 or type(item['consultas']) is not int or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', str(item['data'])):
                    raise ApiError(400, 'Troca inválida.')
                if any(not isinstance(item[k], str) or len(item[k]) > 500 for k in ('id', 'saiu', 'entrou', 'criadoEm')):
                    raise ApiError(400, 'Troca inválida.')
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
        elif name == 'clinicoRoster':
            # "Clínico (qualquer)": médico que preenche o posto de clínico que sobrar vago naquele dia e turno.
            if not isinstance(parsed, list) or len(parsed) > 2000:
                raise ApiError(400, 'Lista de clínicos inválida.')
            for item in parsed:
                if not isinstance(item, dict) or set(item) != {'id', 'start', 'weekday', 'turn', 'doctor', 'active'} or item['turn'] not in ('dia', 'noite') \
                        or type(item['weekday']) is not int or not 0 <= item['weekday'] <= 6 or type(item['active']) is not bool \
                        or not isinstance(item['id'], str) or not 1 <= len(item['id']) <= 100 or not isinstance(item['doctor'], str) or len(item['doctor']) > 500 \
                        or not isinstance(item['start'], str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', item['start']):
                    raise ApiError(400, 'Clínico (qualquer) inválido.')
        elif name == 'excluidos':
            # Médicos excluídos do cadastro (a partir de uma data): só identificação e nome.
            if not isinstance(parsed, list) or len(parsed) > 2000:
                raise ApiError(400, 'Lista de excluídos inválida.')
            for item in parsed:
                if not isinstance(item, dict) or set(item) != {'id', 'nome', 'desde', 'em'} or any(not isinstance(item[k], str) or len(item[k]) > 300 for k in item) \
                        or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', item['desde']):
                    raise ApiError(400, 'Médico excluído inválido.')
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
        elif name == 'documentos':
            # Comunicações Internas (CI) da aba Documentos: numeradas por ano, texto livre com limite de tamanho.
            if not isinstance(parsed, list) or len(parsed) > 3000:
                raise ApiError(400, 'Lista de documentos inválida.')
            campos = {'id': 100, 'data': 10, 'prazo': 100, 'para': 300, 'paraCargo': 300, 'de': 300, 'assunto': 300, 'saudacao': 200,
                      'corpo': 20000, 'anexos': 500, 'assinante': 200, 'cargo': 200, 'assinante2': 200, 'cargo2': 200, 'crm': 40,
                      'status': 20, 'criadoEm': 40, 'atualizadoEm': 40, 'emitidaEm': 40}
            vistos = set()
            for item in parsed:
                if not isinstance(item, dict) or set(item) - set(campos) - {'numero', 'ano', 'maiusculas', 'eletronico'}                         or any(not isinstance(item.get(k, ''), str) or len(item.get(k, '')) > limite for k, limite in campos.items()):
                    raise ApiError(400, 'Documento inválido.')
                if not item.get('id') or item['id'] in vistos or item.get('status') not in ('rascunho', 'emitida')                         or type(item.get('numero')) is not int or not 1 <= item['numero'] <= 9999                         or type(item.get('ano')) is not int or not 2000 <= item['ano'] <= 2100                         or type(item.get('maiusculas', True)) is not bool or type(item.get('eletronico', True)) is not bool or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', item.get('data', '')):
                    raise ApiError(400, 'Número, data ou situação do documento inválidos.')
                vistos.add(item['id'])
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
    def respond(status, body, content_type='application/json; charset=utf-8', cache='no-store'):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode('utf8')
        elif isinstance(body, str):
            body = body.encode('utf8')
        headers = [('Content-Type', content_type), ('Cache-Control', cache),
                   ('X-Content-Type-Options', 'nosniff'), ('Referrer-Policy', 'same-origin'),
                   ('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"), *extra]
        if status != 304:
            # Sem o tamanho, o navegador não sabe se recebeu o arquivo inteiro e não guarda no cache.
            headers.append(('Content-Length', str(len(body))))
        start_response(f'{status} {HTTPStatus(status).phrase}', headers)
        # Iterator allows streaming the official workbook, which exceeds 4.5 MB.
        return (body[i:i + 65536] for i in range(0, len(body), 65536))

    def static(relativo, content_type, cache='private, no-cache'):
        # no-cache = guarda, mas confere com o servidor; a resposta 304 não traz o arquivo de novo.
        corpo, etag, data = arquivo(relativo)
        extra.extend([('ETag', etag), ('Last-Modified', data)])
        # Igualdade exata da data (não "anterior a"): qualquer mudança de conteúdo muda a data e o arquivo vem de novo.
        if etag in (environ.get('HTTP_IF_NONE_MATCH') or '').replace('W/', '').split(', ') or environ.get('HTTP_IF_MODIFIED_SINCE') == data:
            return respond(304, b'', content_type, cache)
        return respond(200, corpo, content_type, cache)

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

        if method == 'GET' and path in ('/sw.js', '/manifest.webmanifest', '/icon.png', '/favicon.ico'):
            if path in ('/icon.png', '/favicon.ico'):
                return respond(200, base64.b64decode(arquivo('icon.png.b64')[0]), 'image/png', 'public, max-age=86400')
            return static(path.lstrip('/'), 'text/javascript; charset=utf-8' if path == '/sw.js' else 'application/manifest+json', 'no-cache')
        if path in ('/src/dark.css', '/src/theme.css', '/src/light.css', '/src/light-auto.css', '/src/documentos.css', '/src/internados.css', '/src/visual.css') and method == 'GET':
            return static(path.lstrip('/'), 'text/css; charset=utf-8', 'no-cache')
        if path == '/src/inter.woff2' and method == 'GET':
            return static('src/inter.woff2', 'font/woff2', 'public, max-age=604800')
        if path == '/login' and method == 'GET':
            return static('login.html', 'text/html; charset=utf-8', 'no-cache')
        if path == '/src/login.js' and method == 'GET':
            return static('src/login.js', 'text/javascript; charset=utf-8', 'no-cache')
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
                esquecer_sessao(token)
                remote('/auth/v1/logout?scope=local', 'POST', {}, token)
            return respond(200, {'ok': True})
        if not token:
            if path in ('/', '/index.html'):
                extra.append(('Location', '/login'))
                return respond(303, '')
            raise ApiError(401, 'Entre na sua conta para continuar.')
        user = usuario_autorizado(token)
        if path in ('/', '/index.html') and method == 'GET':
            return static('index.html', 'text/html; charset=utf-8')
        if path in ASSETS and method == 'GET':
            return static(path.lstrip('/'), 'text/javascript; charset=utf-8')
        if path == '/src/seed.json' and method == 'GET':
            return static('src/seed.json', 'application/json; charset=utf-8')
        if path == '/api/session' and method == 'GET':
            return respond(200, {'email': user.get('email'), 'id': user['id']})
        if path == '/api/fluxo' and method == 'GET':
            global FLUXO
            from gestor_saude import PainelFluxo
            FLUXO = FLUXO or PainelFluxo()
            return respond(200, FLUXO.obter(forcar=environ.get('QUERY_STRING') == 'atualizar=1'))
        if path == '/api/producao' and method == 'GET':
            global PRODUCAO
            from urllib.parse import parse_qs
            from gestor_saude import PainelProducao
            query = parse_qs(environ.get('QUERY_STRING', ''))
            inicio = parse_minuto((query.get('inicio') or [''])[0])
            fim_texto = (query.get('fim') or ['agora'])[0]
            fim = None if fim_texto == 'agora' else parse_minuto(fim_texto)
            PRODUCAO = PRODUCAO or PainelProducao()
            try:
                return respond(200, PRODUCAO.obter(inicio, fim))
            except ValueError as error:
                raise ApiError(400, str(error))
        if path == '/api/internados' and method == 'GET':
            # Censo da planilha do NIR (sem nome, CPF, CNS, nascimento ou SISREG) + evolução médica do Gestor Saúde.
            global CENSO, INTERNACAO
            from censo import Censo
            from gestor_saude import cliente_compartilhado
            from internacao import PainelInternacao, internados
            CENSO = CENSO or Censo()
            INTERNACAO = INTERNACAO or (PainelInternacao() if cliente_compartilhado().configurado else None)
            return respond(200, internados(CENSO, INTERNACAO))
        if path == '/api/baixas' and method == 'GET':
            # Retornos esquecidos abertos no Gestor há mais de X horas (só leitura).
            global BAIXAS
            from urllib.parse import parse_qs
            from baixas import PainelBaixas
            horas = (parse_qs(environ.get('QUERY_STRING', '')).get('horas') or ['24'])[0]
            if not horas.isdigit() or not 1 <= int(horas) <= 720:
                raise ApiError(400, 'Informe as horas entre 1 e 720.')
            from gestor_saude import GestorSaudeError
            BAIXAS = BAIXAS or PainelBaixas()
            try:
                return respond(200, BAIXAS.obter(int(horas)))
            except GestorSaudeError as erro:
                raise ApiError(503, str(erro) or 'O Gestor Saúde não respondeu.')
        if path == '/api/equipe' and method == 'GET':
            # Quem está atendendo no plantão agora (consultórios e Box), pela produção do Gestor Saúde.
            global EQUIPE
            from internacao import PainelEquipe, PainelInternacao
            INTERNACAO = INTERNACAO or PainelInternacao()
            EQUIPE = EQUIPE or PainelEquipe(internacao=INTERNACAO)
            return respond(200, EQUIPE.obter())
        if path == '/api/demanda' and method == 'GET':
            global DEMANDA
            from urllib.parse import parse_qs
            from gestor_saude import PainelDemanda
            query = parse_qs(environ.get('QUERY_STRING', ''))
            inicio = parse_minuto((query.get('inicio') or [''])[0])
            fim_texto = (query.get('fim') or ['agora'])[0]
            fim = None if fim_texto == 'agora' else parse_minuto(fim_texto)
            DEMANDA = DEMANDA or PainelDemanda()
            try:
                return respond(200, DEMANDA.obter(inicio, fim))
            except ValueError as error:
                raise ApiError(400, str(error))
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
            # Sincronização periódica: ?desde=<versão> só baixa a escala inteira quando ela mudou.
            from urllib.parse import parse_qs
            desde = (parse_qs(environ.get('QUERY_STRING', '')).get('desde') or [None])[0]
            if desde is not None:
                rows = remote('/rest/v1/rt_state?select=revision', token=token)
                atual = rows[0]['revision'] if rows else 0
                if str(atual) == desde:
                    return respond(200, {'revision': atual, 'inalterado': True})
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
                try:
                    info=export_cinderela(payload.get('date',''),data,target)
                except ValueError:
                    raise ApiError(400,'Escolha uma data válida para exportar a quinzena.')
                body=target.read_bytes()
            extra.append(('Content-Disposition',content_disposition(nome_arquivo('cinderela',info['ano'],info['mes'],info['quinzena']))))
            return respond(200,body,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        if path == '/api/export-pdf' and method == 'POST':
            from export_pdf import export_pdf
            data=validate_items(payload.get('items'))
            try:
                body=export_pdf(payload.get('year'),payload.get('month'),payload.get('half'),payload.get('kind'),payload.get('layout'),data)
            except ValueError as error:
                raise ApiError(400,str(error))
            extra.append(('Content-Disposition',content_disposition(nome_arquivo('cinderela' if payload.get('kind')=='cinderela' else 'regular',payload.get('year'),payload.get('month'),payload.get('half'),'pdf'))))
            return respond(200,body,'application/pdf')
        if path == '/api/export' and method == 'POST':
            data = validate_items(payload.get('items'))
            year, month, half = (payload.get(k) for k in ('year', 'month', 'half'))
            if any(type(v) is not int for v in (year, month, half)):
                raise ApiError(400, 'Período inválido.')
            with tempfile.TemporaryDirectory(prefix='rt-upa-') as temp:
                target = Path(temp) / 'escala.xlsx'
                try:
                    export(year, month, half, data, DEFAULT_TEMPLATE, target)
                except ValueError as error:
                    # Mês/quinzena inválidos viravam erro 500 ("servidor não respondeu"); agora a mensagem chega à tela.
                    raise ApiError(400, str(error))
                body = target.read_bytes()
            extra.append(('Content-Disposition', content_disposition(nome_arquivo('regular', year, month, half))))
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
