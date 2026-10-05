"""Resumo da evolução médica, feito aqui no servidor (nada vai para serviço externo).

As evoluções da UPA seguem um roteiro: #HDA, #HPP (comorbidades), #EVOLUÇÃO DIÁRIA, sinais vitais (SSVV),
#EXAMES, HD: (hipóteses) e CD: (conduta). O resumo pega o que importa para a RT acompanhar o leito:
hipóteses, conduta, o que está pendente (aguardando, solicitado, transferência), antibiótico em curso,
sinais vitais, comorbidades e o estado geral. Nome, CNS e outros identificadores não fazem parte do texto
da evolução e, se aparecerem, não entram no resumo (só os campos acima).
"""
import re
import unicodedata

TITULO = re.compile(r'^\s*#?\s*([A-ZÀ-Ü][A-ZÀ-Ü0-9 /\-.()]{0,40}?)\s*:\s*(.*)$')
SECOES = {
    'hd': ('HD', 'HIPOTESE DIAGNOSTICA', 'HIPOTESES DIAGNOSTICAS', 'HIPOTESES', 'DIAGNOSTICO', 'DIAGNOSTICOS', 'IMPRESSAO DIAGNOSTICA'),
    'cd': ('CD', 'CONDUTA', 'CONDUTAS', 'PLANO', 'PLANO TERAPEUTICO', 'PLANOS'),
    'evolucao': ('EVOLUCAO DIARIA', 'EVOLUCAO', 'EVOLUCAO MEDICA', 'SUBJETIVO', 'S'),
    'comorbidades': ('COMORBIDADES', 'HPP', 'ANTECEDENTES'),
    'alergias': ('ALERGIA MEDICAMENTOSAS', 'ALERGIAS', 'ALERGIA', 'ALERGIAS MEDICAMENTOSAS'),
    'internacao': ('DATA INTERNACAO', 'DATA DA INTERNACAO', 'DATA DE INTERNACAO', 'DI'),
    'ssvv': ('SSVV', 'SINAIS VITAIS', 'SV'),
}
PENDENTE = re.compile(r'AGUARD|SOLICIT|PENDENTE|TRANSFER|PROGRAMAD|AGENDAD|VAGA|REGULA|PARECER|INTERCONSULT')
VITAIS = [('PA', r'\bPA\s*:?\s*(\d{2,3}\s*[Xx/]\s*\d{2,3})'), ('FC', r'\bFC\s*:?\s*(\d{2,3})'), ('FR', r'\bFR\s*:?\s*(\d{1,2})'),
          ('SpO2', r'SPO2\s*:?\s*(\d{2,3})\s*%?'), ('Tax', r'\bTAX\s*:?\s*(\d{2}[.,]\d)'), ('Dextro', r'DEXTRO\s*:?\s*(\d{2,3})')]
ATB = re.compile(r'\bD\s?(\d{1,2})\s+(?:DE\s+)?([A-ZÀ-Ü]{5,}(?:\s*\+\s*[A-ZÀ-Ü]{5,})?)')


def _sem_acento(texto):
    return unicodedata.normalize('NFD', texto).encode('ascii', 'ignore').decode().upper()


def _frase(texto, limite):
    """Primeira(s) frase(s) até o limite, em minúsculas com a primeira letra maiúscula."""
    t = ' '.join(texto.split())
    if len(t) > limite:
        corte = max(t.rfind('. ', 0, limite), t.rfind(', ', 0, limite))
        t = (t[:corte] if corte > limite // 2 else t[:limite]).rstrip(' ,.') + '…'
    t = t.lower()
    return t[:1].upper() + t[1:]


def _itens(linhas):
    saida = []
    for linha in linhas:
        for parte in re.split(r'\s*//\s*|;\s*', linha):
            parte = parte.strip(' -•*·\t')
            if len(parte) >= 3:
                saida.append(parte)
    return saida


def secoes(texto):
    """{chave: [linhas]} pelas marcações do roteiro (#TÍTULO: ou TÍTULO: no começo da linha)."""
    atual, blocos = None, {}
    for bruta in str(texto or '').replace('\r', '').split('\n'):
        linha = bruta.strip()
        if not linha:
            continue
        m = TITULO.match(linha)
        chave = None
        if m:
            nome = _sem_acento(m.group(1)).strip(' .')
            chave = next((k for k, nomes in SECOES.items() if nome in nomes), None)
        if chave:
            atual = chave
            if m.group(2).strip():
                blocos.setdefault(atual, []).append(m.group(2).strip())
            continue
        if m and not chave:
            # Outro título (EXAME FISICO, AR, ACV…): encerra a seção anterior, mas os sinais vitais podem vir aqui.
            atual = 'ssvv' if re.search(r'\bPA\b.*\bFC\b', _sem_acento(linha)) else 'outro'
            if atual == 'ssvv':
                blocos.setdefault('ssvv', []).append(linha)
            continue
        if atual:
            blocos.setdefault(atual, []).append(linha)
    return blocos


def resumir_evolucao(texto):
    """Resumo estruturado + uma frase curta para mostrar no leito."""
    b = secoes(texto)
    tudo = _sem_acento(str(texto or ''))
    hd = _itens(b.get('hd', []))[:5]
    cd = _itens(b.get('cd', []))[:8]
    pendencias = [c for c in cd if PENDENTE.search(_sem_acento(c))]
    vitais = {}
    fonte_vitais = _sem_acento(' '.join(b.get('ssvv', []))) or tudo
    for rotulo, padrao in VITAIS:
        m = re.search(padrao, fonte_vitais)
        if m:
            vitais[rotulo] = re.sub(r'\s+', '', m.group(1)).replace('X', 'x')
    atbs = []
    for dia, droga in ATB.findall(tudo):
        rotulo = f'{droga.title()} (D{dia})'
        if droga not in ('INTERNACAO',) and rotulo not in atbs:
            atbs.append(rotulo)
    estado = _frase(' '.join(b.get('evolucao', [])), 220) if b.get('evolucao') else ''
    curto = lambda xs, n: ' · '.join(_frase(x, 60) for x in xs[:n])
    linha_hd = curto(hd, 3)
    linha_cd = curto(pendencias or cd, 3)
    return {
        'hipoteses': [_frase(x, 120) for x in hd],
        'conduta': [_frase(x, 120) for x in cd],
        'pendencias': [_frase(x, 120) for x in pendencias],
        'antibioticos': atbs[:3],
        'vitais': vitais,
        'comorbidades': _frase(' '.join(b.get('comorbidades', [])), 160) if b.get('comorbidades') else '',
        'alergias': _frase(' '.join(b.get('alergias', [])), 80) if b.get('alergias') else '',
        'estado': estado,
        'frase': ' | '.join(x for x in (f'HD: {linha_hd}' if linha_hd else '', f'{"Aguarda" if pendencias else "CD"}: {linha_cd}' if linha_cd else '') if x)[:220],
    }
