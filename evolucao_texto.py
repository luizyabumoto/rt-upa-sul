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


def _maiusculas(texto):
    """Sem acento e em maiúsculas, mantendo as quebras de linha (normalizar() junta tudo numa linha só)."""
    import unicodedata
    return unicodedata.normalize('NFD', str(texto or '')).encode('ascii', 'ignore').decode().upper()


def _nome_profissional(item):
    p = item.get('profissional')
    if isinstance(p, dict):
        for chave in ('nome', 'nomeProfissional', 'profissionalNome', 'nomeCompleto', 'descricao'):
            if isinstance(p.get(chave), str) and p[chave].strip():
                return p[chave].strip()
        pessoa = p.get('pessoa')
        if isinstance(pessoa, dict) and isinstance(pessoa.get('nome'), str):
            return pessoa['nome'].strip()
    # O Gestor devolve o nome em "profisionalResponsavel" (assim mesmo, com um "s"): aceita as duas grafias.
    for chave, v in item.items():
        k = chave.lower()
        if isinstance(v, str) and v.strip() and ('profis' in k or 'responsavel' in k) and not k.endswith('id'):
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


LIGACOES = {'DA', 'DE', 'DO', 'DAS', 'DOS', 'E'}


def _mesmo_nome(a, b):
    """Mesma pessoa: mesmo primeiro nome e pelo menos mais um nome igual ("RAQUEL ALVES" ≠ "RAQUEL SOUZA")."""
    ta = [x for x in normalizar(a).split() if x not in LIGACOES]
    tb = [x for x in normalizar(b).split() if x not in LIGACOES]
    if not ta or not tb or ta[0] != tb[0]:
        return False
    return len(set(ta) & set(tb)) >= min(2, len(ta), len(tb))


def _de_outra_profissao(item, texto=''):
    descricao = normalizar(' '.join(str(item.get(k) or '') for k in item if 'hipotese' in k.lower() or 'tipo' in k.lower()))
    return bool(NAO_MEDICO.search(descricao) or NAO_MEDICO.search(normalizar(' '.join(_cbos(item)))) or re.search(r'\bCOREN\b|ENFERMAGEM', _maiusculas(texto)))


def eh_medica(item, texto, medicos=(), nao_medicos=()):
    """Evolução de MÉDICO. Regra rígida (enfermagem também escreve "conduta"):
    1) quem já evoluiu como enfermagem/técnico/NIR/fisio… (nao_medicos) ou texto com COREN → não;
    2) CBO de médico no item → sim;
    3) com a lista de médicos da produção (CBO médico, últimos dias) → só quem está nela;
    4) sem essa lista → roteiro médico completo (HD: e CD:/CONDUTA:)."""
    nome = _nome_profissional(item)
    if _de_outra_profissao(item, texto) or (nome and any(_mesmo_nome(nome, n) for n in nao_medicos)):
        return False
    if _cbos(item) & CBO_MEDICO:
        return True
    if medicos:
        return bool(nome) and any(_mesmo_nome(nome, m) for m in medicos)
    t = _maiusculas(texto)
    return bool(re.search(r'(^|\n)\s*#?\s*(HD|HIPOTESE DIAGNOSTICA)\s*:', t)) and bool(re.search(r'(^|\n)\s*#?\s*(CD|CONDUTA)\s*:', t))


def evolucoes_do_paciente(cliente, paciente_id, por_pagina=15):
    corpo = {'page': 1, 'pageSize': por_pagina, 'filter': [], 'sort': [{'column': 'pacienteAtendimentoEvolucaoId', 'direction': 'desc'}]}
    caminho = f'api/PacienteAtendimentoEvolucao/Pagination/{int(paciente_id)}'
    try:
        resposta = cliente._chamar(caminho, corpo, token=cliente.token)
    except GestorSaudeError:
        resposta = cliente._chamar(caminho, token=cliente.token, metodo='GET')
    return (resposta or {}).get('items') or []


def ultima_medica(itens, medicos=(), nao_medicos=()):
    """{data, medico, resumo} da evolução médica mais recente; None se não houver."""
    melhores = []
    for ordem, item in enumerate(itens):
        texto = _texto(item)
        if texto and eh_medica(item, texto, medicos, nao_medicos):
            momento = _data(item)
            # Sem data, vale a ordem da lista (a API devolve da mais nova para a mais antiga).
            melhores.append(((momento.timestamp() if momento else 0, -ordem), momento, item, texto))
    if not melhores:
        return None
    melhores.sort(key=lambda x: x[0], reverse=True)
    _, momento, item, texto = melhores[0]
    recentes = [{'momento': m.isoformat(), 'medico': _nome_profissional(i)} for _, m, i, _ in melhores[:8] if m]
    return {'data': momento.isoformat() if momento else None, 'medico': _nome_profissional(item), 'resumo': resumir_evolucao(texto),
            'texto': texto[:20000], 'recentes': recentes}


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
        pac = i.get('paciente') if isinstance(i.get('paciente'), dict) else {}
        nome = next((str(v) for v in (i.get('pacienteNome'), i.get('nome'), i.get('nomePaciente'), pac.get('nome'), pac.get('nomeCompleto'), pac.get('pessoaNome')) if v), '')
        saida.append({'pacienteId': i['pacienteId'], 'setor': 'box' if 'BOX' in tipo else 'enfermaria', '_nome': ' '.join(normalizar(nome).split()),
                      'anos': int(anos.group(1)) if anos else None, 'chegada': chegada.date().isoformat() if chegada else None})
    return saida


def medicos_da_producao(cliente, dias=7):
    """Nomes de quem atendeu como MÉDICO (CBO de clínico/pediatra) nos últimos dias: a lista que decide quem é médico.
    Guardada por 6 h no cliente (são só nomes de profissionais)."""
    import time
    from datetime import datetime, timedelta
    from gestor_saude import CUIABA
    guardado = getattr(cliente, 'medicos_producao', None)
    if guardado and time.time() - guardado[0] < 6 * 3600:
        return guardado[1]
    agora = datetime.now(CUIABA).replace(second=0, microsecond=0)
    linhas = cliente.producao(agora - timedelta(days=dias), agora, chaves=('adulto', 'pediatria'))
    nomes = {m for atend in linhas.values() for m, *_ in atend if m and m != 'SEM PROFISSIONAL'}
    cliente.medicos_producao = (time.time(), nomes)
    return nomes


def medicos_cadastrados():
    """Médicos da escala e do cadastro do site (src/seed.json: cadastro, escala importada, visitadores e cinderelas).
    Cobre quem só faz visita na enfermaria e não atende no consultório (e por isso não aparece na produção)."""
    import json
    from pathlib import Path
    try:
        seed = json.loads((Path(__file__).resolve().parent / 'src' / 'seed.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return set()
    nomes = set(seed.get('physicians') or [])
    for chave in ('assignments', 'visits', 'cinderelas'):
        nomes |= {x.get('doctor') for x in seed.get(chave) or [] if isinstance(x, dict)}
    return {str(n).split('\n')[0].strip() for n in nomes if n and str(n).strip()}


def ler_resumos(cliente, medicos=()):
    """[{setor, anos, chegada, evolucao}] de cada internado da fila (sem nenhum identificador na saída final)."""
    medicos = set(medicos) | medicos_cadastrados()
    try:
        medicos |= medicos_da_producao(cliente)
    except (GestorSaudeError, AttributeError, TypeError):
        pass   # sem a lista da produção, vale o CBO e o roteiro médico completo

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
            diag = {'itens': len(itens), 'comTexto': len(com_texto), 'medicos': len(medicos),
                    'campos': sorted(itens[0])[:60] if itens else [],
                    'camposProfissional': sorted(itens[0]['profissional'])[:40] if itens and isinstance(itens[0].get('profissional'), dict) else []}
            return {**p, 'itens': itens, 'diag': diag}
        with ThreadPoolExecutor(max_workers=4) as executor:
            lidos = list(executor.map(um, fila))
        # Quem evoluiu como enfermagem, técnico, NIR, fisio… em QUALQUER paciente não é médico em nenhum.
        nao_medicos = {_nome_profissional(i) for r in lidos for i in r.get('itens') or [] if _de_outra_profissao(i, _texto(i)) and _nome_profissional(i)}
        nao_medicos = {n for n in nao_medicos if not any(_mesmo_nome(n, m) for m in medicos)}
        saida = []
        for r in lidos:
            itens = r.pop('itens', None) or []
            if 'diag' in r and 'erro' not in r['diag']:
                r['diag']['medicas'] = sum(1 for i in itens if _texto(i) and eh_medica(i, _texto(i), medicos, nao_medicos))
            saida.append({**r, 'evolucao': ultima_medica(itens, medicos, nao_medicos) if itens else r.get('evolucao')})
        return saida
    return cliente._com_token(ler)


def _nota_ligacao(p, r, unico=False):
    """Quão certo é que o paciente r da fila do Gestor está no leito p do censo (-1 = não pode ser).
    Idade igual +2, mesmo setor +1, mesma data de internação +4 (±1 dia +2), idade sem nenhum vizinho no censo +2.
    Data diferente NÃO pesa contra: quem passa do Box para a enfermaria ganha atendimento novo no Gestor."""
    from datetime import date
    # Nome dos dois lados (planilha e Gestor): decide sozinho. Mesmo nome = é ele; nome diferente = não é.
    if p.get('_nome') and r.get('_nome'):
        a = [x for x in p['_nome'].split() if x not in LIGACOES]
        b = [x for x in r['_nome'].split() if x not in LIGACOES]
        if a and b and (a == b or (a[0] == b[0] and a[-1] == b[-1]) or (a[0] == b[0] and len(set(a) & set(b)) >= 3)):
            return 50
        return -1
    if r['anos'] is None or not isinstance(p.get('idade'), int) or abs(r['anos'] - p['idade']) > 1:
        return -1
    nota = 2 if r['anos'] == p['idade'] else 0
    setor = 'box' if p['categoria'] == 'box' else 'enfermaria'
    nota += 1 if r['setor'] == setor else 0
    if r.get('chegada') and p.get('internacao'):
        dias = abs((date.fromisoformat(r['chegada']) - date.fromisoformat(p['internacao'])).days)
        nota += 4 if dias == 0 else 2 if dias == 1 else 0
    if unico and r['anos'] == p['idade']:
        nota += 2
    return nota


def cruzar_resumos(pacientes, resumos):
    """Põe em cada leito do censo a última evolução médica do paciente da fila que bate com ele.
    Calcula todas as combinações (idade, data de internação, setor) e liga primeiro os pares mais certos:
    assim um leito não "rouba" o paciente de outro só por vir antes na lista."""
    candidatos = [r for r in resumos if r.get('evolucao')]
    # Idade "única": nenhum outro internado do censo com idade a até 1 ano (ex.: a única paciente de 91 anos).
    idades = [p.get('idade') for p in pacientes if isinstance(p.get('idade'), int)]
    unico = lambda p: isinstance(p.get('idade'), int) and sum(abs(x - p['idade']) <= 1 for x in idades) == 1
    pares = sorted(((_nota_ligacao(p, r, unico(p)), i, j) for i, p in enumerate(pacientes) for j, r in enumerate(candidatos)), reverse=True)
    ligado, usado = {}, set()
    for nota, i, j in pares:
        if nota < 3:
            break
        if i in ligado or j in usado:
            continue
        ligado[i] = {**candidatos[j], 'nota': nota}
        usado.add(j)
    saida = []
    for i, p in enumerate(pacientes):
        r = ligado.get(i)
        if not r:
            saida.append(p)
            continue
        e = r['evolucao']
        saida.append({**p, 'resumo': e['resumo'], 'resumoEm': e['data'], 'resumoMedico': e['medico'],
                      'resumoRecentes': e.get('recentes', []), 'evolucaoTexto': e.get('texto', ''),
                      'ligacao': {'anos': r['anos'], 'chegada': r['chegada'], 'nota': r['nota']}})
    return saida
