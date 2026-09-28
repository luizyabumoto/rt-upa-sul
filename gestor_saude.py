"""Fluxo de pacientes: leitura da fila de Atendimento do Gestor Saúde (somente leitura).

O servidor entra no Gestor Saúde com as credenciais das variáveis de ambiente, lê a fila na
visão de Responsável Técnico e devolve ao navegador só números agregados. Nomes, CPF, CNS,
prontuário e demais identificadores nunca saem desta função nem são gravados.

Endpoints e campos confirmados na API real em 28/09/2026:
- POST Api/Token {username, password} -> access_token (JWT, 1h30) sem contexto de unidade;
- GET  api/Usuario/ConfigAtendimentoPadrao/{usuarioId} -> estabelecimento/CBO/setor salvos;
- POST Api/Token/AutorizaPermissaoUsuario -> token com o contexto (o "Continuar" da tela);
- POST api/PacienteAtendimento/Pagination/true -> fila completa (true = Responsável Técnico).
Cada etapa do paciente é um registro; "chegada" é quando ele entrou naquela etapa, e o tempo
que a tela do Gestor Saúde mostra é exatamente agora - chegada.
"""
import base64
import json
import os
import threading
import time
import unicodedata
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

# Cuiabá não tem horário de verão desde 2019: UTC-4 fixo. Os horários da API vêm sem fuso.
CUIABA = timezone(timedelta(hours=-4))
FILAS = {'CONSULTORIO ADULTO': 'adulto', 'CONSULTORIO PEDIATRICO': 'pediatria'}
TRIAGEM = 'CLASSIFICACAO DE RISCO'
RETORNOS = ('RETORNO ADULTO', 'RETORNO PEDIATRICO')
LIMITE_ESQUECIDO_MIN = 12 * 60
CLASSIFICACOES = {
    1: ('vermelho', 'Vermelho', 'Emergência'),
    2: ('laranja', 'Laranja', 'Muito urgente'),
    3: ('amarelo', 'Amarelo', 'Urgente'),
    4: ('roxo', 'Roxo', 'Prioridade'),
    5: ('verde', 'Verde', 'Pouco urgente'),
    6: ('azul', 'Azul', 'Não urgente'),
    7: ('preto', 'Preto', 'Sutura'),
    8: ('cinza', 'Cinza', 'Sem classificação'),
}


class GestorSaudeError(Exception):
    pass


def normalizar(texto):
    sem_acento = unicodedata.normalize('NFD', texto or '').encode('ascii', 'ignore').decode()
    return ' '.join(sem_acento.split()).upper()


def _chegada(item):
    try:
        return datetime.fromisoformat(str(item.get('chegada'))[:26]).replace(tzinfo=CUIABA)
    except ValueError:
        return None


def _stats(minutos):
    if not minutos:
        return {'aguardando': 0, 'maiorEspera': None, 'media': None}
    return {'aguardando': len(minutos), 'maiorEspera': max(minutos), 'media': round(sum(minutos) / len(minutos))}


def resumir(items, agora):
    """Transforma a fila em indicadores. Aguardando = situação AGUARDANDO e sem profissional."""
    por_cor, por_fila, esquecidos = {}, {'adulto': [], 'pediatria': []}, []
    em_atendimento = {'adulto': 0, 'pediatria': 0}
    triagem, retornos = [], 0
    for item in items:
        tipo = normalizar(item.get('atendimentoTipo'))
        aguardando = normalizar(item.get('descricaoSituacao')) == 'AGUARDANDO' and not item.get('profissionalId')
        chegada = _chegada(item)
        minutos = max(0, round((agora - chegada).total_seconds() / 60)) if chegada else None
        if tipo in RETORNOS:
            retornos += aguardando
            continue
        if tipo == TRIAGEM:
            if aguardando and minutos is not None:
                triagem.append(minutos)
            continue
        fila = FILAS.get(tipo)
        if not fila:
            continue
        if not aguardando:
            em_atendimento[fila] += 1
            continue
        if minutos is None:
            continue
        if minutos > LIMITE_ESQUECIDO_MIN:
            esquecidos.append(minutos)
            continue
        prioridade = item.get('prioridade')
        chave, nome, descricao = CLASSIFICACOES.get(prioridade, (f'p{prioridade}', 'Outra', 'Outra classificação'))
        grupo = por_cor.setdefault(chave, {'chave': chave, 'nome': nome, 'descricao': descricao, 'prioridade': prioridade,
                                           'cor': item.get('cor') or '#888888', 'minutos': [], 'adulto': 0, 'pediatria': 0})
        grupo['minutos'].append(minutos)
        grupo[fila] += 1
        por_fila[fila].append(minutos)
    todos = [m for lista in por_fila.values() for m in lista]
    classificacoes = []
    for grupo in sorted(por_cor.values(), key=lambda g: (g['prioridade'] if isinstance(g['prioridade'], int) else 99)):
        classificacoes.append({**{k: grupo[k] for k in ('chave', 'nome', 'descricao', 'cor', 'adulto', 'pediatria')}, **_stats(grupo.pop('minutos'))})
    return {
        'total': _stats(todos),
        'adulto': {**_stats(por_fila['adulto']), 'emAtendimento': em_atendimento['adulto']},
        'pediatria': {**_stats(por_fila['pediatria']), 'emAtendimento': em_atendimento['pediatria']},
        'classificacoes': classificacoes,
        'triagem': _stats(triagem),
        'retornosPendentes': retornos,
        'possiveisEsquecidos': {'quantidade': len(esquecidos), 'maiorEspera': max(esquecidos) if esquecidos else None},
    }


class GestorSaude:
    """Cliente com token em memória: evita logins repetidos, que podem derrubar a sessão do usuário."""

    def __init__(self, env=os.environ, abrir=urlopen, relogio=time.time):
        self.base = (env.get('GESTOR_SAUDE_URL') or 'https://gestorsaude.cuiaba.mt.gov.br/').rstrip('/') + '/'
        self.usuario, self.senha = env.get('GESTOR_SAUDE_USUARIO', ''), env.get('GESTOR_SAUDE_SENHA', '')
        self.abrir, self.relogio = abrir, relogio
        self.token, self.expira = None, 0

    @property
    def configurado(self):
        return bool(self.usuario and self.senha)

    def _chamar(self, caminho, corpo=None, token=None, metodo='POST'):
        headers = {'Accept': 'application/json', 'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        pedido = Request(self.base + caminho, method=metodo, headers=headers,
                         data=None if corpo is None else json.dumps(corpo).encode())
        try:
            with self.abrir(pedido, timeout=20) as resposta:
                bruto = resposta.read()
                return json.loads(bruto) if bruto else None
        except HTTPError as erro:
            if erro.code == 401:
                raise PermissionError('token expirado') from erro
            if erro.code == 400 and caminho == 'Api/Token':
                raise GestorSaudeError('O Gestor Saúde recusou o usuário ou a senha configurados.') from erro
            raise GestorSaudeError(f'O Gestor Saúde respondeu com erro {erro.code}.') from erro
        except (URLError, TimeoutError, OSError) as erro:
            raise GestorSaudeError('O Gestor Saúde não respondeu.') from erro

    @staticmethod
    def _claims(token):
        parte = token.split('.')[1]
        return json.loads(base64.urlsafe_b64decode(parte + '=' * (-len(parte) % 4)))

    def _entrar(self):
        """Mesmo caminho do navegador: login, configuração padrão salva e "Continuar"."""
        inicial = self._chamar('Api/Token', {'username': self.usuario, 'password': self.senha})['access_token']
        claims = self._claims(inicial)
        padrao = self._chamar(f"api/Usuario/ConfigAtendimentoPadrao/{claims['usuarioId']}", token=inicial, metodo='GET') or {}
        if not padrao.get('estabelecimentoId'):
            raise GestorSaudeError('A conta do Gestor Saúde não tem estabelecimento padrão salvo.')
        contexto = {'usuarioId': int(claims['usuarioId']), 'sessaoId': int(claims['sessaoId']),
                    **{k: padrao.get(k) for k in ('estabelecimentoId', 'cboId', 'setorId', 'departamentoId')},
                    'localAtendimento': None, 'cbo': None, 'salvaPadrao': False}
        self.token = self._chamar('Api/Token/AutorizaPermissaoUsuario', contexto, token=inicial)['access_token']
        # Renova com folga de 5 minutos antes do vencimento do JWT.
        self.expira = float(self._claims(self.token).get('exp', self.relogio() + 3600)) - 300

    def fila(self):
        if not self.configurado:
            raise GestorSaudeError('A integração com o Gestor Saúde ainda não foi configurada.')
        for tentativa in range(2):
            if not self.token or self.relogio() >= self.expira:
                self._entrar()
            try:
                itens, pagina = [], 1
                while True:
                    resposta = self._chamar('api/PacienteAtendimento/Pagination/true', {
                        'page': pagina, 'pageSize': 1000, 'filter': [], 'sort': [{'column': 'prioridade', 'direction': 'asc'}]}, token=self.token)
                    itens += resposta.get('items') or []
                    if len(itens) >= int(resposta.get('recordCount') or 0) or pagina >= 5 or not resposta.get('items'):
                        return itens
                    pagina += 1
            except PermissionError:
                self.token = None
                if tentativa:
                    raise GestorSaudeError('O Gestor Saúde recusou o acesso da conta configurada.')
        return []


class PainelFluxo:
    """Guarda a última leitura válida e limita a frequência de consultas ao Gestor Saúde."""

    def __init__(self, cliente=None, relogio=time.time, cache_segundos=None):
        self.cliente = cliente or GestorSaude()
        self.relogio = relogio
        self.cache = float(cache_segundos if cache_segundos is not None else os.environ.get('FLUXO_CACHE_SEGUNDOS') or 45)
        self.ultimo, self.lido_em, self.tentado_em, self.erro = None, 0, 0, None
        self.trava = threading.Lock()

    def obter(self, forcar=False):
        with self.trava:
            agora = self.relogio()
            idade = agora - self.tentado_em
            # "Atualizar agora" pula o cache, mas nunca consulta mais de uma vez a cada 15 s.
            if idade >= self.cache or (forcar and idade >= 15):
                self.tentado_em = agora
                try:
                    momento = datetime.fromtimestamp(agora, CUIABA)
                    self.ultimo = resumir(self.cliente.fila(), momento)
                    self.lido_em, self.erro = agora, None
                except GestorSaudeError as erro:
                    self.erro = str(erro)
            base = {'disponivel': self.erro is None, 'erro': self.erro,
                    'atualizadoEm': datetime.fromtimestamp(self.lido_em, timezone.utc).isoformat() if self.lido_em else None,
                    'intervaloSegundos': int(self.cache)}
            return {**base, 'dados': self.ultimo}
