"""Internados e equipe do plantão, pelo Gestor Saúde (somente leitura).

1. Evolução médica de quem está internado (Box e enfermaria): cada evolução do médico vira uma linha do relatório
   Produção Analítico do tipo de atendimento do setor, com a idade do paciente ("76 ano(s) 4 mese(s) 10 dia(s)").
   Pela idade dá para casar com o leito do censo sem nome nem prontuário: só idade, horário e médico, em memória.
2. Quem está de plantão agora, pela produção (consultórios + evoluções no Box), como no painel da Secretaria.
"""
import calendar
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

from gestor_saude import CUIABA, GestorSaudeError, _horario, cliente_compartilhado, normalizar, plantao_de

CBOS_MEDICOS = ('225125', '225124')   # médico clínico, médico pediatra
TIPOS_INTERNACAO = ('BOX', 'ENFERMARIA', 'OBSERVACAO', 'INTERNA', 'VISITA', 'LEITO')
TIPOS_FORA = ('CONSULTORIO', 'RETORNO', 'CLASSIFICACAO', 'SUTURA', 'MEDICACAO', 'TRIAGEM')
# Evolução do Box vale por 12 h (um plantão); a visita da enfermaria vale para o dia (desde as 07h).
VALIDADE_BOX = timedelta(hours=12)


def nascimento_aprox(idade, referencia):
    """Data de nascimento a partir de "76 ano(s) 4 mese(s) 10 dia(s)" na data de referência (None se não der)."""
    m = re.search(r'(\d+)\s*ano\D+(\d+)\s*mes\D+(\d+)\s*dia', str(idade or ''))
    if not m:
        return None
    anos, meses, dias = map(int, m.groups())
    ano, mes = referencia.year - anos, referencia.month - meses
    while mes < 1:
        mes += 12
        ano -= 1
    try:
        return date(ano, mes, min(referencia.day, calendar.monthrange(ano, mes)[1])) - timedelta(days=dias)
    except ValueError:
        return None


def anos_em(nascimento, dia):
    return dia.year - nascimento.year - ((dia.month, dia.day) < (nascimento.month, nascimento.day))


def _relatorio(cliente, tipo, cbo, inicio, fim):
    return cliente._chamar('api/PacienteAtendimento/ImprimirProducaoAnalitico', {
        'atendimentoTipoId': tipo, 'cboId': cbo, 'profissionalId': 0, 'formato': 2,
        'competenciaInicial': inicio.strftime('%Y-%m-%d %H:%M'), 'competenciaFinal': fim.strftime('%Y-%m-%d %H:%M')}, token=cliente.token) or {}


def tipos_internacao(cliente):
    """[(tipoId, nome, cboId, 'box'|'enfermaria')] dos setores de internação, descobertos pelo nome no Gestor Saúde."""
    if getattr(cliente, 'tipos_internacao', None) is None:
        achados = []
        for t in cliente._chamar('api/AtendimentoTipo', token=cliente.token, metodo='GET') or []:
            nome = normalizar(t.get('atendimentoTipo'))
            if not any(p in nome for p in TIPOS_INTERNACAO) or any(p in nome for p in TIPOS_FORA):
                continue
            for b in cliente._chamar(f"api/Cbo/GetByAtendimentoTipoId/{t.get('atendimentoTipoId')}", token=cliente.token, metodo='GET') or []:
                if str(b.get('cboCodigo')) in CBOS_MEDICOS:
                    achados.append((t.get('atendimentoTipoId'), t.get('atendimentoTipo'), b.get('cboId'), 'box' if 'BOX' in nome else 'enfermaria'))
        cliente.tipos_internacao = achados
    return cliente.tipos_internacao


def ler_evolucoes(cliente, inicio, fim):
    """Evoluções médicas do período nos setores de internação: [{setor, nascimento, momento, medico}]."""
    def ler():
        tipos = tipos_internacao(cliente)

        def baixar(item):
            tipo, _, cbo, setor = item
            try:
                r = _relatorio(cliente, tipo, cbo, inicio, fim)
            except GestorSaudeError:
                return []
            saida = []
            for a in r.get('atendimentos') or []:
                m = _horario(a.get('dataAtendimento'))
                if m and inicio <= m <= fim + timedelta(minutes=1):
                    nasc = nascimento_aprox(a.get('idade'), m.date())
                    saida.append({'setor': setor, 'nascimento': nasc.isoformat() if nasc else None, 'momento': m.isoformat(),
                                  'medico': (a.get('profissional') or '').strip()})
            return saida
        with ThreadPoolExecutor(max_workers=max(1, min(4, len(tipos)))) as executor:
            evolucoes = [e for lista in executor.map(baixar, tipos) for e in lista]
        return {'tipos': sorted({nome for _, nome, _, _ in tipos}), 'evolucoes': sorted(evolucoes, key=lambda e: e['momento'])}
    return cliente._com_token(ler)


def inicio_visita(agora):
    """Dia de visita: das 07h às 07h do dia seguinte."""
    base = agora.replace(hour=7, minute=0, second=0, microsecond=0)
    return base if agora.hour >= 7 else base - timedelta(days=1)


def cruzar_evolucoes(pacientes, evolucoes, agora):
    """Casa cada leito do censo com as evoluções do Gestor pela idade (mesma pessoa = mesma data de nascimento,
    ±2 dias). Cada pessoa vale para um leito só; o setor da evolução (Box/enfermaria) desempata.
    Devolve os pacientes com ultimaEvolucao, medicoEvolucao e evolucao: 'em-dia' | 'pendente' | 'sem-idade'."""
    pessoas = []   # [{nascimento, setores, ultima, medico}]
    for e in evolucoes:
        if not e.get('nascimento'):
            continue
        nasc, momento = date.fromisoformat(e['nascimento']), datetime.fromisoformat(e['momento'])
        p = next((x for x in pessoas if abs((x['nascimento'] - nasc).days) <= 2), None)
        if not p:
            p = {'nascimento': nasc, 'setores': set(), 'ultima': momento, 'medico': e['medico']}
            pessoas.append(p)
        p['setores'].add(e['setor'])
        if momento >= p['ultima']:
            p['ultima'], p['medico'] = momento, e['medico']
    livres, saida = list(pessoas), []
    visita = inicio_visita(agora)
    # Primeiro quem tem idade e o mesmo setor; depois tolerância de 1 ano (aniversário perto da data).
    resultado = {}
    for tolerancia in (0, 1):
        for i, p in enumerate(pacientes):
            if i in resultado or not isinstance(p.get('idade'), int):
                continue
            setor = 'box' if p['categoria'] == 'box' else 'enfermaria'
            candidatas = [x for x in livres if abs(anos_em(x['nascimento'], agora.date()) - p['idade']) <= tolerancia]
            candidatas.sort(key=lambda x: (setor not in x['setores'], -x['ultima'].timestamp()))
            if candidatas:
                resultado[i] = candidatas[0]
                livres.remove(candidatas[0])
    for i, p in enumerate(pacientes):
        par = resultado.get(i)
        prazo = agora - VALIDADE_BOX if p['categoria'] == 'box' else visita
        # Internado depois do começo do dia de visita: a admissão já é a avaliação do dia.
        recem = p['categoria'] != 'box' and p.get('internacao') == agora.date().isoformat()
        if not isinstance(p.get('idade'), int):
            estado = 'sem-idade'
        elif par and par['ultima'] >= prazo or recem:
            estado = 'em-dia'
        else:
            estado = 'pendente'
        saida.append({**p, 'evolucao': estado, 'ultimaEvolucao': par['ultima'].isoformat() if par else None,
                      'medicoEvolucao': par['medico'] if par else None,
                      'horasSemEvolucao': round((agora - par['ultima']).total_seconds() / 3600, 1) if par else None})
    return saida


def resumir_visitas(pacientes):
    """Quantos faltam evoluir no Box e visitar na enfermaria (inclui pediatria)."""
    def grupo(filtro):
        lista = [p for p in pacientes if filtro(p)]
        return {'total': len(lista), 'emDia': sum(p['evolucao'] == 'em-dia' for p in lista),
                'pendentes': sum(p['evolucao'] == 'pendente' for p in lista), 'semIdade': sum(p['evolucao'] == 'sem-idade' for p in lista)}
    return {'box': grupo(lambda p: p['categoria'] == 'box'), 'enfermaria': grupo(lambda p: p['categoria'] in ('enfermaria', 'pediatria'))}


class PainelInternacao:
    """Evoluções das últimas 36 h (Box e enfermaria), relidas no máximo a cada 3 min."""

    def __init__(self, cliente=None, relogio=time.time):
        self.cliente = cliente or cliente_compartilhado()
        self.relogio = relogio
        self.ultimo, self.lido, self.erro = None, 0, None
        self.trava = threading.Lock()

    def obter(self):
        with self.trava:
            if self.relogio() - self.lido >= 180:
                agora = datetime.fromtimestamp(self.relogio(), CUIABA).replace(second=0, microsecond=0)
                try:
                    self.ultimo, self.erro = ler_evolucoes(self.cliente, agora - timedelta(hours=36), agora), None
                except GestorSaudeError as erro:
                    self.erro = str(erro)
                self.lido = self.relogio()
            return {'disponivel': self.erro is None and self.ultimo is not None, 'erro': self.erro, **(self.ultimo or {'tipos': [], 'evolucoes': []})}


# ---------- Quem está de plantão agora, pela produção
def inicio_plantao(agora):
    data, turno = plantao_de(agora)
    return datetime.fromisoformat(f'{data}T{"07" if turno == "D" else "19"}:00').replace(tzinfo=CUIABA)


def area_do_medico(adulto, pediatria, box):
    """Box quando evoluiu mais no Box do que atendeu nos consultórios; senão, onde mais consultou."""
    if box and box >= adulto + pediatria:
        return 'box'
    return 'pediatria' if pediatria > adulto else 'adulto'


def eh_cinderela(primeiro, ultimo):
    """Cinderela (12h–18h / 13h–19h): no diurno, a primeira consulta foi das 11h em diante."""
    return 11 <= primeiro.hour < 19 and ultimo.hour < 20 and primeiro.date() == ultimo.date()


def eh_avulso(total, primeiro, ultimo, agora, box=0):
    """Até 3 atendimentos, começou na segunda metade do plantão e parou há 30 min: atendeu de passagem."""
    if total > 3 or (box and box * 2 >= total):
        return False
    if primeiro - inicio_plantao(primeiro) < timedelta(hours=5):
        return False
    return agora - ultimo >= timedelta(minutes=30) or (plantao_de(primeiro)[1] == 'D' and (primeiro.hour, primeiro.minute) >= (14, 30))


def resumir_equipe(linhas, agora, anterior=()):
    """Médicos do plantão: área (clínico, pediatra ou Box), consultas, evoluções no Box, ritmo, se está atendendo
    agora (última hora), cinderela, avulso e quem só fechava o plantão anterior."""
    medicos = {}
    for chave, atendimentos in linhas.items():
        if chave not in ('adulto', 'pediatria', 'box'):
            continue
        for medico, momento, *_ in atendimentos:
            m = medicos.setdefault(medico, {'medico': medico, 'adulto': 0, 'pediatria': 0, 'box': 0, 'primeiro': momento, 'ultimo': momento})
            m[chave] += 1
            m['primeiro'], m['ultimo'] = min(m['primeiro'], momento), max(m['ultimo'], momento)
    inicio, saida = inicio_plantao(agora), []
    for m in medicos.values():
        total = m['adulto'] + m['pediatria'] + m['box']
        horas = max(0.5, (min(agora, m['ultimo']) - max(inicio, m['primeiro'])).total_seconds() / 3600)
        avulso = eh_avulso(total, m['primeiro'], m['ultimo'], agora, m['box'])
        saida.append({**m, 'area': area_do_medico(m['adulto'], m['pediatria'], m['box']), 'consultas': m['adulto'] + m['pediatria'],
                      'porHora': round((m['adulto'] + m['pediatria']) / horas, 1),
                      'ativo': agora - m['ultimo'] <= timedelta(minutes=60), 'minutosParado': max(0, round((agora - m['ultimo']).total_seconds() / 60)),
                      'cinderela': plantao_de(m['primeiro'])[1] == 'D' and eh_cinderela(m['primeiro'], m['ultimo']) and not avulso,
                      'avulso': avulso, 'restoAnterior': m['medico'] in anterior and m['ultimo'] - inicio < timedelta(minutes=45),
                      'primeiro': m['primeiro'].isoformat(), 'ultimo': m['ultimo'].isoformat()})
    ordem = {'adulto': 0, 'pediatria': 1, 'box': 2}
    return sorted(saida, key=lambda m: (ordem[m['area']], -(m['consultas'] + m['box'])))


class PainelEquipe:
    """Equipe do plantão em andamento (consultórios + Box), relida no máximo a cada 2 min."""

    def __init__(self, cliente=None, internacao=None, relogio=time.time):
        self.cliente = cliente or cliente_compartilhado()
        self.internacao, self.relogio = internacao, relogio
        self.ultimo, self.lido, self.erro = None, 0, None
        self.trava = threading.Lock()

    def obter(self):
        with self.trava:
            if self.relogio() - self.lido >= 120:
                agora = datetime.fromtimestamp(self.relogio(), CUIABA).replace(second=0, microsecond=0)
                inicio = inicio_plantao(agora)
                try:
                    linhas = self.cliente.producao(inicio - timedelta(hours=12), agora, chaves=('adulto', 'pediatria'))
                    box = (self.internacao.obter() if self.internacao else {'evolucoes': []})['evolucoes']
                    linhas['box'] = [(e['medico'], datetime.fromisoformat(e['momento'])) for e in box if e['setor'] == 'box' and e['medico']]
                    atual = {k: [x for x in v if x[1] >= inicio] for k, v in linhas.items()}
                    antes = {x[0] for v in linhas.values() for x in v if inicio - timedelta(hours=12) <= x[1] < inicio}
                    self.ultimo = {'plantao': {'inicio': inicio.isoformat(), 'turno': plantao_de(inicio)[1]}, 'equipe': resumir_equipe(atual, agora, antes),
                                   'atualizadoEm': datetime.fromtimestamp(self.relogio(), timezone.utc).isoformat()}
                    self.erro = None
                except GestorSaudeError as erro:
                    self.erro = str(erro)
                self.lido = self.relogio()
            return {'disponivel': self.erro is None and self.ultimo is not None, 'erro': self.erro, **(self.ultimo or {'equipe': []})}


def internados(censo, evolucoes=None, agora=None):
    """Resposta da aba Internados: censo da planilha + situação da evolução médica de cada leito (se o Gestor responder)."""
    agora = agora or datetime.now(CUIABA)
    dados = censo.obter()
    evo = evolucoes.obter() if evolucoes else {'disponivel': False, 'erro': 'Gestor Saúde não configurado.', 'tipos': [], 'evolucoes': []}
    pacientes = dados.get('pacientes') or []
    if evo['disponivel']:
        pacientes = cruzar_evolucoes(pacientes, evo['evolucoes'], agora)
    return {**dados, 'pacientes': pacientes,
            'evolucao': {'disponivel': evo['disponivel'], 'erro': evo.get('erro'), 'tiposLidos': evo.get('tipos', []),
                         'inicioVisita': inicio_visita(agora).isoformat(), **({'visitas': resumir_visitas(pacientes)} if evo['disponivel'] else {})}}
