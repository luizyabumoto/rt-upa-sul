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


# Produção médica: consultas contam; retornos ficam só como informação (dar baixa não é atender).
PRODUCAO = {
    'adulto': ('CONSULTORIO ADULTO', '225125'),        # Médico Clínico
    'pediatria': ('CONSULTORIO PEDIATRICO', '225124'),  # Médico Pediatra
    'retornoAdulto': ('RETORNO ADULTO', '225125'),
    'retornoPediatria': ('RETORNO PEDIATRICO', '225124'),
}
CLASSES_PRODUCAO = {'EMERGENCIA': 'emergencia', 'MUITO URGENTE': 'muitoUrgente', 'URGENTE': 'urgente', 'PRIORIDADE': 'prioridade',
                    'POUCO URGENTE': 'poucoUrgente', 'NAO URGENTE': 'naoUrgente', 'PROCEDIMENTOS': 'procedimentos', 'SEM CLASSIFICACAO': 'semClassificacao'}


class GestorSaudeError(Exception):
    pass


def _horario(valor):
    try:
        return datetime.fromisoformat(str(valor)[:26]).replace(tzinfo=CUIABA)
    except ValueError:
        return None


def plantao_de(momento):
    """Plantões de 12 h: diurno 07h-19h; noturno 19h-07h, que pertence ao dia em que começou."""
    if 7 <= momento.hour < 19:
        return momento.date().isoformat(), 'D'
    if momento.hour >= 19:
        return momento.date().isoformat(), 'N'
    return (momento.date() - timedelta(days=1)).isoformat(), 'N'


def resumir_producao(linhas):
    """Contagem por plantão e médico. Nada de paciente: só nome do médico, horário e classificação."""
    registros = {}
    for chave, atendimentos in linhas.items():
        for medico, momento, classificacao in atendimentos:
            data, turno = plantao_de(momento)
            registro = registros.setdefault((data, turno, medico), {'data': data, 'turno': turno, 'medico': medico,
                                                                    'adulto': 0, 'pediatria': 0, 'retornos': 0, 'classes': {}})
            if chave.startswith('retorno'):
                registro['retornos'] += 1
                continue
            registro[chave] += 1
            classe = CLASSES_PRODUCAO.get(normalizar(classificacao), 'outros')
            registro['classes'][classe] = registro['classes'].get(classe, 0) + 1
    return sorted(registros.values(), key=lambda r: (r['data'], r['turno'], r['medico']))


def resumir_medicos_hora(linhas):
    """Perfil por hora de cada médico (só consultas, sem retornos): pacientes por hora, pico e vale.
    Nada de paciente; só nome do médico e horário do atendimento."""
    from collections import Counter, defaultdict
    relogio = defaultdict(Counter)   # médico -> contagem por hora-relógio real ('AAAA-MM-DDTHH')
    for chave, atendimentos in linhas.items():
        if chave.startswith('retorno'):
            continue
        for medico, momento, _ in atendimentos:
            relogio[medico][momento.strftime('%Y-%m-%dT%H')] += 1
    resultado = []
    for medico, contagem in relogio.items():
        total = sum(contagem.values())
        horas_ativas = len(contagem)               # horas-relógio em que atendeu ao menos 1
        soma = [0] * 24
        dias = [set() for _ in range(24)]
        for hora_chave, n in contagem.items():
            h = int(hora_chave[11:13])
            soma[h] += n
            dias[h].add(hora_chave[:10])
        # Média por hora do dia = atendimentos naquela faixa ÷ dias em que ele trabalhou nela.
        ativas = [(h, soma[h] / len(dias[h])) for h in range(24) if dias[h]]
        pico = max(ativas, key=lambda x: x[1])
        vale = min(ativas, key=lambda x: x[1])
        resultado.append({
            'medico': medico.split('\n')[0],
            'total': total,
            'porHora': round(total / horas_ativas, 1) if horas_ativas else 0,
            'maxHora': max(contagem.values()),
            'horaPico': pico[0], 'mediaPico': round(pico[1], 1),
            'horaVale': vale[0], 'mediaVale': round(vale[1], 1),
        })
    return sorted(resultado, key=lambda r: (-r['porHora'], -r['total']))


def resumir_atrasos(linhas):
    """Por médico: atraso para o 1º atendimento do plantão e maior intervalo sem atender.
    Início do plantão: 07h (diurno) ou 19h (noturno). Só consultas; sem dados de paciente."""
    from collections import defaultdict
    por_plantao = defaultdict(list)                        # (data, turno, médico) -> horários
    for chave, atendimentos in linhas.items():
        if chave.startswith('retorno'):
            continue
        for medico, momento, _ in atendimentos:
            data, turno = plantao_de(momento)
            por_plantao[(data, turno, medico)].append(momento)
    por_medico = defaultdict(lambda: {'plantoes': 0, 'atrasos': [], 'intervalos': []})
    for (data, turno, medico), momentos in por_plantao.items():
        momentos.sort()
        inicio = datetime.fromisoformat(f'{data}T{"07" if turno == "D" else "19"}:00').replace(tzinfo=CUIABA)
        atraso = max(0, (momentos[0] - inicio).total_seconds() / 60)
        # Acima de 2 h quase sempre é Cinderela/extra/entrada em horário diferente, não atraso real: ignora esse plantão.
        if atraso > 120:
            continue
        maior_intervalo = max((((b - a).total_seconds() / 60) for a, b in zip(momentos, momentos[1:])), default=0)
        m = por_medico[medico]
        m['plantoes'] += 1
        m['atrasos'].append(atraso)
        m['intervalos'].append(maior_intervalo)
    media = lambda xs: round(sum(xs) / len(xs)) if xs else 0
    return sorted(({
        'medico': medico.split('\n')[0], 'plantoes': d['plantoes'],
        'atrasoMedio': media(d['atrasos']), 'piorAtraso': round(max(d['atrasos'])) if d['atrasos'] else 0,
        'intervaloMedio': media(d['intervalos']), 'maiorIntervalo': round(max(d['intervalos'])) if d['intervalos'] else 0,
    } for medico, d in por_medico.items()), key=lambda r: (-r['atrasoMedio'], -r['piorAtraso']))


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
        self.token, self.expira, self.tipos = None, 0, None
        self.trava = threading.Lock()

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

    def _com_token(self, acao):
        """Executa com o token atual; se o Gestor Saúde recusar, entra de novo uma única vez."""
        if not self.configurado:
            raise GestorSaudeError('A integração com o Gestor Saúde ainda não foi configurada.')
        for tentativa in range(2):
            with self.trava:
                if not self.token or self.relogio() >= self.expira:
                    self._entrar()
            try:
                return acao()
            except PermissionError:
                self.token = None
                if tentativa:
                    raise GestorSaudeError('O Gestor Saúde recusou o acesso da conta configurada.')

    def fila(self):
        def ler():
            itens, pagina = [], 1
            while True:
                resposta = self._chamar('api/PacienteAtendimento/Pagination/true', {
                    'page': pagina, 'pageSize': 1000, 'filter': [], 'sort': [{'column': 'prioridade', 'direction': 'asc'}]}, token=self.token)
                itens += resposta.get('items') or []
                if len(itens) >= int(resposta.get('recordCount') or 0) or pagina >= 5 or not resposta.get('items'):
                    return itens
                pagina += 1
        return self._com_token(ler)

    def _tipos_producao(self):
        """IDs de tipo de atendimento e CBO do relatório, descobertos pelo nome e pelo código do CBO."""
        if not self.tipos:
            tipos = {normalizar(t.get('atendimentoTipo')): t.get('atendimentoTipoId') for t in self._chamar('api/AtendimentoTipo', token=self.token, metodo='GET') or []}
            resultado = {}
            for chave, (nome, codigo) in PRODUCAO.items():
                if not tipos.get(nome):
                    raise GestorSaudeError(f'Tipo de atendimento "{nome}" não encontrado no Gestor Saúde.')
                cbos = self._chamar(f'api/Cbo/GetByAtendimentoTipoId/{tipos[nome]}', token=self.token, metodo='GET') or []
                cbo = next((b.get('cboId') for b in cbos if str(b.get('cboCodigo')) == codigo), None)
                if not cbo:
                    raise GestorSaudeError(f'CBO {codigo} não disponível para {nome} no Gestor Saúde.')
                resultado[chave] = (tipos[nome], cbo)
            self.tipos = resultado
        return self.tipos

    def producao(self, inicio, fim, chaves=None):
        """Atendimentos do relatório Produção Analítico (formato 2 = dados), só médico, horário e classificação.
        O Gestor Saúde aceita no máximo 31 dias por consulta; períodos maiores são lidos em partes."""
        def ler():
            linhas = {}
            for chave, (tipo, cbo) in self._tipos_producao().items():
                if chaves and chave not in chaves:
                    continue
                linhas[chave] = []
                parte = inicio
                while parte < fim:
                    ate = min(parte + timedelta(days=30), fim)
                    resposta = self._chamar('api/PacienteAtendimento/ImprimirProducaoAnalitico', {
                        'atendimentoTipoId': tipo, 'cboId': cbo, 'profissionalId': 0, 'formato': 2,
                        'competenciaInicial': parte.strftime('%Y-%m-%d %H:%M'), 'competenciaFinal': ate.strftime('%Y-%m-%d %H:%M')}, token=self.token) or {}
                    for atendimento in resposta.get('atendimentos') or []:
                        momento = _horario(atendimento.get('dataAtendimento'))
                        # Descarta aqui os dados do paciente; o limite evita contar duas vezes na emenda das partes.
                        if momento and parte <= momento < ate + timedelta(minutes=1) and (momento < fim + timedelta(minutes=1)):
                            linhas[chave].append(((atendimento.get('profissional') or 'SEM PROFISSIONAL').strip(), momento, atendimento.get('classificacaoDescricao')))
                    parte = ate + timedelta(minutes=1) if ate < fim else fim
            return linhas
        return self._com_token(ler)


_CLIENTE = None


def cliente_compartilhado():
    """Fluxo e Produção usam o mesmo token: cada login novo pode derrubar a sessão do usuário no navegador."""
    global _CLIENTE
    _CLIENTE = _CLIENTE or GestorSaude()
    return _CLIENTE


class PainelFluxo:
    """Guarda a última leitura válida e limita a frequência de consultas ao Gestor Saúde."""

    def __init__(self, cliente=None, relogio=time.time, cache_segundos=None):
        self.cliente = cliente or cliente_compartilhado()
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


class PainelProducao:
    """Produção por período. Plantão em andamento: releitura a cada 2 min; períodos encerrados: 6 h de cache."""
    LIMITE_DIAS = 93

    def __init__(self, cliente=None, relogio=time.time):
        self.cliente = cliente or cliente_compartilhado()
        self.relogio = relogio
        self.cache = {}
        self.trava = threading.Lock()

    def obter(self, inicio, fim=None):
        agora = datetime.fromtimestamp(self.relogio(), CUIABA).replace(second=0, microsecond=0)
        fim = min(fim or agora, agora)
        if inicio >= fim:
            raise ValueError('O início precisa ser antes do fim.')
        if fim - inicio > timedelta(days=self.LIMITE_DIAS):
            raise ValueError(f'Escolha um período de até {self.LIMITE_DIAS} dias.')
        aberto = agora - fim < timedelta(minutes=5)
        chave = (inicio.isoformat(), 'agora' if aberto else fim.isoformat())
        with self.trava:
            guardado = self.cache.get(chave)
            if guardado and self.relogio() < guardado[0]:
                return guardado[1]
            try:
                resultado = {'disponivel': True, 'erro': None, 'inicio': inicio.isoformat(), 'fim': fim.isoformat(), 'emAndamento': aberto,
                             'atualizadoEm': datetime.fromtimestamp(self.relogio(), timezone.utc).isoformat(),
                             **(lambda linhas: {'registros': resumir_producao(linhas), 'perfilMedicos': resumir_medicos_hora(linhas), 'atrasos': resumir_atrasos(linhas)})(self.cliente.producao(inicio, fim))}
            except GestorSaudeError as erro:
                if guardado:
                    return {**guardado[1], 'disponivel': False, 'erro': str(erro)}
                return {'disponivel': False, 'erro': str(erro), 'inicio': inicio.isoformat(), 'fim': fim.isoformat(), 'emAndamento': aberto, 'atualizadoEm': None, 'registros': []}
            if len(self.cache) > 40:
                self.cache.clear()
            self.cache[chave] = (self.relogio() + (120 if aberto else 6 * 3600), resultado)
            return resultado


def resumir_demanda(linhas):
    """Consultas por hora (adulto e pediatria), para a análise de demanda. Só contagens."""
    horas = {}
    for chave, atendimentos in linhas.items():
        for _, momento, _ in atendimentos:
            hora = horas.setdefault(momento.strftime('%Y-%m-%dT%H'), {'adulto': 0, 'pediatria': 0})
            hora[chave] += 1
    return horas


class PainelDemanda:
    """Demanda por hora em janelas de até 32 dias. A tela junta as janelas; períodos encerrados ficam 6 h em cache."""
    LIMITE_DIAS = 32

    def __init__(self, cliente=None, relogio=time.time):
        self.cliente = cliente or cliente_compartilhado()
        self.relogio = relogio
        self.cache = {}
        self.trava = threading.Lock()

    def obter(self, inicio, fim=None):
        agora = datetime.fromtimestamp(self.relogio(), CUIABA).replace(second=0, microsecond=0)
        fim = min(fim or agora, agora)
        if inicio >= fim:
            raise ValueError('O início precisa ser antes do fim.')
        if fim - inicio > timedelta(days=self.LIMITE_DIAS):
            raise ValueError(f'Peça no máximo {self.LIMITE_DIAS} dias por vez.')
        aberto = agora - fim < timedelta(minutes=5)
        chave = (inicio.isoformat(), 'agora' if aberto else fim.isoformat())
        with self.trava:
            guardado = self.cache.get(chave)
            if guardado and self.relogio() < guardado[0]:
                return guardado[1]
            try:
                resultado = {'disponivel': True, 'erro': None, 'inicio': inicio.isoformat(), 'fim': fim.isoformat(), 'emAndamento': aberto,
                             'horas': resumir_demanda(self.cliente.producao(inicio, fim, chaves=('adulto', 'pediatria')))}
            except GestorSaudeError as erro:
                return {'disponivel': False, 'erro': str(erro), 'inicio': inicio.isoformat(), 'fim': fim.isoformat(), 'emAndamento': aberto, 'horas': {}}
            if len(self.cache) > 60:
                self.cache.clear()
            self.cache[chave] = (self.relogio() + (300 if aberto else 6 * 3600), resultado)
            return resultado
