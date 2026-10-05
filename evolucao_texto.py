"""Última evolução MÉDICA de cada internado, resumida no servidor (nada vai para serviço externo).

Caminho no Gestor Saúde (confirmado pelo RT na tela Atender › Evolução › Visualizar, 05/10/2026):
- a fila (api/PacienteAtendimento/Pagination/true) traz cada internado (ENFERMARIA, BOX…) com pacienteId,
  idade completa ("59 ano(s) 3 mese(s) 13 dia(s)") e chegada;
- api/PacienteAtendimentoEvolucao/Pagination/{pacienteId} traz as evoluções do paciente, da mais nova para a mais antiga.
Enfermagem, técnico, fisioterapia, serviço social e NIR também evoluem: só entra a evolução de MÉDICO
(CBO de médico, nome de médico da unidade ou o roteiro médico com HD:/CD:).
O leito do censo é ligado ao paciente pela idade + data de internação. Nome, CNS, CPF e números do Gestor
ficam só aqui dentro: a tela recebe apenas o resumo, a data e o médico.
"""
import html
import re
from concurrent.futures import ThreadPoolExecutor

from gestor_saude import GestorSaudeError, _horario, normalizar
from resumo_evolucao import resumir_evolucao

SETORES = ('ENFERMARIA', 'BOX', 'OBSERVACAO')
CBO_MEDICO = {'225125', '225124', '225142', '225170', '455', '454'}   # códigos de médico e os IDs de CBO médico da UPA Sul
NAO_MEDICO = re.compile(r'ENFERM|TECNIC|FISIOTERAP|ASSISTENTE SOCIAL|SERVICO SOCIAL|NUTRI|PSICOLOG|FARMAC|\bNIR\b|ADMINISTRATIV')
ROTEIRO_MEDICO = re.compile(r'(^|\n)\s*#?\s*(HD|CD|HIPOTESE DIAGNOSTICA|CONDUTA)\s*:', re.M)


def texto_de_html(valor):
    """O Gestor guarda a evolução formatada (negrito, listas): vira texto com uma linha por item."""
    t = str(valor or '')
    t = re.sub(r'(?i)<\s*br\s*/?>|</\s*(p|div|li|h\d|tr)\s*>', '\n', t)
    t = re.sub(r'(?i)<\s*li[^>]*>', '\n- ', t)
    t = re.sub(r'<[^>]+>', '', t)
    return re.sub(r'\n\s*\n+', '\n', html.unescape(t)).strip()


def _nome_profissional(item):
    p = item.get('profissional')
    if isinstance(p, dict):
        for chave in ('nome', 'nomeProfissional', 'profissionalNome', 'nomeCompleto', 'descricao'):
            if isinstance(p.get(chave), str) and p[chave].strip():
                return p[chave].strip()
        pessoa = p.get('pessoa')
        if isinstance(pessoa, dict) and isinstance(pessoa.get('nome'), str):
            return pessoa['nome'].strip()
    for chave, v in item.items():
        if isinstance(v, str) and 'profissional' in chave.lower() and 'nome' in chave.lower() and v.strip():
            return v.strip()
    return str(p).strip() if isinstance(p, str) else ''


def _cbos(item):
    """Todos os valores de campos de CBO no item e no profissional (código ou id)."""
    achados = set()
    for fonte in (item, item.get('profissional') if isinstance(item.get('profissional'), dict) else {}):
        for chave, v in fonte.items():
            if 'cbo' in chave.lower():
                if isinstance(v, dict):
                    achados |= {str(x) for k, x in v.items() if k.lower() in ('cbocodigo', 'codigo', 'cboid', 'descricao') and x is not None}
                elif v is not None:
                    achados.add(str(v))
    return achados


def _texto(item):
    """Texto da evolução: o maior campo de texto do item (o nome do campo não é documentado)."""
    candidatos = [v for k, v in item.items() if isinstance(v, str) and len(v) > 40 and not k.lower().startswith(('data', 'hora'))]
    return texto_de_html(max(candidatos, key=len)) if candidatos else ''


def _data(item):
    for chave in ('dataEvolucao', 'data', 'dataCadastro', 'dataHora', 'dataAtendimento'):
        m = _horario(item.get(chave)) if item.get(chave) else None
        if m:
            return m
    return None


def _mesmo_nome(a, b):
    ta, tb = set(normalizar(a).split()), set(normalizar(b).split())
    return bool(ta and tb) and len(ta & tb) >= min(2, len(ta), len(tb))


def eh_medica(item, texto, medicos=()):
    """Evolução de médico: CBO médico, nome entre os médicos da unidade, ou roteiro médico (HD:/CD:) sem ser de outra profissão."""
    cbos = _cbos(item)
    nome = _nome_profissional(item)
    descricao = normalizar(' '.join(str(item.get(k) or '') for k in item if 'hipotese' in k.lower() or 'tipo' in k.lower()))
    if NAO_MEDICO.search(descricao) or NAO_MEDICO.search(normalizar(' '.join(cbos))):
        return False
    if cbos & CBO_MEDICO:
        return True
    if nome and any(_mesmo_nome(nome, m) for m in medicos):
        return True
    return bool(ROTEIRO_MEDICO.search(normalizar(texto)))


def evolucoes_do_paciente(cliente, paciente_id, por_pagina=15):
    corpo = {'page': 1, 'pageSize': por_pagina, 'filter': [], 'sort': [{'column': 'pacienteAtendimentoEvolucaoId', 'direction': 'desc'}]}
    caminho = f'api/PacienteAtendimentoEvolucao/Pagination/{int(paciente_id)}'
    try:
        resposta = cliente._chamar(caminho, corpo, token=cliente.token)
    except GestorSaudeError:
        resposta = cliente._chamar(caminho, token=cliente.token, metodo='GET')
    return (resposta or {}).get('items') or []


def ultima_medica(itens, medicos=()):
    """{data, medico, resumo} da evolução médica mais recente; None se não houver."""
    melhores = []
    for ordem, item in enumerate(itens):
        texto = _texto(item)
        if texto and eh_medica(item, texto, medicos):
            momento = _data(item)
            # Sem data, vale a ordem da lista (a API devolve da mais nova para a mais antiga).
            melhores.append(((momento.timestamp() if momento else 0, -ordem), momento, item, texto))
    if not melhores:
        return None
    _, momento, item, texto = max(melhores, key=lambda x: x[0])
    return {'data': momento.isoformat() if momento else None, 'medico': _nome_profissional(item), 'resumo': resumir_evolucao(texto)}


def internados_na_fila(itens_fila):
    """Pacientes de internação na fila do Gestor: setor, idade em anos e data de chegada (só para ligar ao leito)."""
    saida = []
    for i in itens_fila:
        tipo = normalizar(i.get('atendimentoTipo'))
        if not any(s in tipo for s in SETORES) or not i.get('pacienteId'):
            continue
        idade = str(i.get('idadeMeses') or i.get('idade') or '')
        anos = re.match(r'\s*(\d+)\s*ano', idade)
        chegada = _horario(i.get('chegada'))
        saida.append({'pacienteId': i['pacienteId'], 'setor': 'box' if 'BOX' in tipo else 'enfermaria',
                      'anos': int(anos.group(1)) if anos else None, 'chegada': chegada.date().isoformat() if chegada else None})
    return saida


def ler_resumos(cliente, medicos=()):
    """[{setor, anos, chegada, evolucao}] de cada internado da fila (sem nenhum identificador na saída final)."""
    def ler():
        fila = internados_na_fila(cliente.fila())

        def um(p):
            # Diagnóstico sem dado de paciente: quantas evoluções vieram, quantas com texto, quantas de médico,
            # o erro do Gestor (se houver) e só os NOMES dos campos de uma evolução.
            try:
                itens = evolucoes_do_paciente(cliente, p['pacienteId'])
            except (GestorSaudeError, PermissionError) as erro:
                return {**p, 'evolucao': None, 'diag': {'erro': str(erro) or erro.__class__.__name__}}
            com_texto = [i for i in itens if _texto(i)]
            diag = {'itens': len(itens), 'comTexto': len(com_texto), 'medicas': sum(1 for i in com_texto if eh_medica(i, _texto(i), medicos)),
                    'campos': sorted(itens[0])[:60] if itens else [],
                    'camposProfissional': sorted(itens[0]['profissional'])[:40] if itens and isinstance(itens[0].get('profissional'), dict) else []}
            return {**p, 'evolucao': ultima_medica(itens, medicos), 'diag': diag}
        with ThreadPoolExecutor(max_workers=4) as executor:
            return list(executor.map(um, fila))
    return cliente._com_token(ler)


def cruzar_resumos(pacientes, resumos):
    """Põe em cada leito do censo o resumo da última evolução médica do paciente da fila que bate com ele:
    mesmo setor (Box/enfermaria), mesma idade (±1 ano) e, de preferência, mesma data de internação."""
    livres, saida = [r for r in resumos if r.get('evolucao')], []
    for p in pacientes:
        setor = 'box' if p['categoria'] == 'box' else 'enfermaria'
        def nota(r):
            if r['anos'] is None or not isinstance(p.get('idade'), int) or abs(r['anos'] - p['idade']) > 1:
                return -1
            return (2 if r['chegada'] and r['chegada'] == p.get('internacao') else 0) + (1 if r['setor'] == setor else 0) + (1 if r['anos'] == p['idade'] else 0)
        melhor = max(livres, key=nota, default=None)
        if melhor and nota(melhor) >= 2:
            livres.remove(melhor)
            e = melhor['evolucao']
            saida.append({**p, 'resumo': e['resumo'], 'resumoEm': e['data'], 'resumoMedico': e['medico']})
        else:
            saida.append(p)
    return saida
