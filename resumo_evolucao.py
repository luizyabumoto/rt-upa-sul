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
          ('SpO2', r'(?:SPO2|SATO2|SAT\s?O2|\bSAT)\s*:?\s*(\d{2,3})\s*%?'), ('Tax', r'(?:\bTAX|\bTEMP|\bT)\s*:?\s*(\d{2}[.,]\d)'), ('Dextro', r'DEXTRO\s*:?\s*(\d{2,3})')]
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


# Título no MEIO da linha ("... AVC  CD: MANTENHO ..."): vira linha nova antes de separar as seções.
NO_MEIO = re.compile(r'(?<=\S)\s+(?=#?\s*(?:HD|CD|CONDUTA|PLANO|HIPOTESE DIAGNOSTICA|HIPÓTESE DIAGNÓSTICA|IMPRESSAO|IMPRESSÃO|SSVV)\s*:)', re.I)
# Sem roteiro (comum no Box): frases de conduta e de diagnóstico pelas palavras.
VERBOS_CONDUTA = re.compile(r'\b(MANTENHO|MANTEM|SOLICITO|SOLICITADO|AGUARDO|AGUARDA|INICIO|INICIADO|INICIADA|PRESCREVO|ENCAMINHO|TRANSFIRO|TRANSFERENCIA|SUSPENDO|SUSPENSO|ACIONAD|REGULAD|PROGRAMO|REAVALIO|REAVALIAR|ALTA|OBSERVACAO|OXIGENIO|O2|IOT|INTUBAD|VM\b|DVA|NORA|ATB)')
PALAVRAS_DIAGNOSTICO = re.compile(r'\b(QUADRO DE|DEVIDO A|DEVIDO|POR CONTA DE|SUSPEITA DE|HIPOTESE|DIAGNOSTICO|INTERNAD[OA] POR|ADMITID[OA] POR|EM INVESTIGACAO|PORTADOR[A]? DE|POS[- ]OPERATORIO|EM TRATAMENTO DE)\b')
SINAIS_OU_EXAMES = re.compile(r'\b(PA|FC|FR|SPO2|SATO2|TAX|DEXTRO|HB|HT|LEUCO|PLAQ|CREAT|UREIA|NA|K|PCR|EAS|RX|TC)\b\s*:?\s*\d')


def _frases(texto):
    t = ' '.join(str(texto or '').split())
    return [f.strip(' .;') for f in re.split(r'(?<=[.;!?])\s+|\s+//\s+|\n', t) if len(f.strip(' .;')) >= 8]


def secoes(texto):
    """{chave: [linhas]} pelas marcações do roteiro (#TÍTULO: ou TÍTULO: no começo da linha)."""
    atual, blocos = None, {}
    for bruta in NO_MEIO.sub('\n', str(texto or '').replace('\r', '')).split('\n'):
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
        blocos.setdefault(atual or 'livre', []).append(linha)
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
    # Texto corrido (sem roteiro, comum no Box, ou o parágrafo antes do HD/CD): a conduta escrita nas frases
    # (mantenho O2, aguardo vaga, solicito TC…) soma com a do "CD:"; o diagnóstico sai do trecho depois de
    # "quadro de", "admitido por"…; e o estado geral, das primeiras frases.
    corpo = ' '.join(b.get('evolucao', []) + b.get('livre', []))
    frases = [f for f in _frases(corpo) if not SINAIS_OU_EXAMES.search(_sem_acento(f))]
    if not hd:
        for f in frases:
            m = re.search(r'(?:QUADRO DE|ADMITID[OA] POR|INTERNAD[OA] POR|DEVIDO AO?|DEVIDO A|POR CONTA DE|SUSPEITA DE|EM TRATAMENTO DE|PORTADOR[A]? DE)\s+(.{3,90}?)(?:,|;|\.|$)', _sem_acento(f))
            if m:
                inicio = _sem_acento(f).find(m.group(1))
                hd.append(f[inicio:inicio + len(m.group(1))])
        hd = hd[:3]
    extras = [f for f in frases if VERBOS_CONDUTA.search(_sem_acento(f)) and not PALAVRAS_DIAGNOSTICO.search(_sem_acento(f))]
    vistos = {_sem_acento(c) for c in cd}
    cd = (cd + [f for f in extras if _sem_acento(f) not in vistos])[:8]
    pendencias = [c for c in cd if PENDENTE.search(_sem_acento(c))]
    if not estado and frases:
        estado = _frase(' '.join(f for f in frases[:2] if f not in cd), 240)
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
