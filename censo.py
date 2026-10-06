"""Pacientes internados na UPA Sul, lidos da aba "PASCOAL R" da planilha de censos que o NIR alimenta.

A planilha é publicada pelo Google em CSV (só leitura) e lida com a biblioteca padrão do Python.
PROTEÇÃO DE DADOS: nome, CPF, CNS, data de nascimento e número do SISREG são descartados na leitura e
nunca saem do servidor. A tela recebe só leito, idade, dias de internação, hipótese/CID, especialidade e situação.
"""
import csv
import io
import os
import re
import threading
import time
import unicodedata
from datetime import datetime, timedelta, timezone
from urllib.error import URLError
from urllib.request import Request, urlopen

CUIABA = timezone(timedelta(hours=-4))
URL = os.environ.get('CENSO_CSV') or ('https://docs.google.com/spreadsheets/d/e/2PACX-1vS3gogeOkMm3-kiLjmgX1PhZfoUc9O1qPKV-iIxgJjg7bEjIZrSsirDTS8wvPR8EkRPlTxRJRk57suA'
                                      '/pub?gid=155165984&single=true&output=csv')
# Capacidade oficial: 13 leitos de enfermaria adulto (2 de isolamento) e 6 de Box. A pediatria conta os leitos da planilha.
CAPACIDADE = {'enfermaria': 13, 'isolamento': 2, 'box': 6}
VAGOS = ('VAGO', 'VAGA', 'LIVRE', 'DISPONIVEL', 'LEITO VAGO', '-', '--', 'X', 'NOME', 'NOME PACIENTE')
BLOQUEIOS = ('RESERVADO', 'BLOQUEADO', 'INTERDITADO', 'MANUTENCAO', 'DESATIVADO', 'FECHADO')
LEITO = re.compile(r'^(?:[A-Z]{0,3}-?\d{1,2}(?:\.0)?|[A-Z]{0,2}-?ISO\w*|ISOL\w*)$')
CID = re.compile(r'\b([A-TV-Z])\s?(\d{2})(?:[.,]?(\d))?\b')
CAPITULOS = [('A00', 'B99', 'Infecciosas e parasitárias'), ('C00', 'D48', 'Neoplasias (câncer)'), ('D50', 'D89', 'Sangue e imunidade'),
             ('E00', 'E90', 'Endócrinas e metabólicas'), ('F00', 'F99', 'Saúde mental'), ('G00', 'G99', 'Sistema nervoso'),
             ('H00', 'H95', 'Olhos e ouvidos'), ('I00', 'I99', 'Circulatórias (coração e vasos)'), ('J00', 'J99', 'Respiratórias'),
             ('K00', 'K93', 'Digestivas'), ('L00', 'L99', 'Pele'), ('M00', 'M99', 'Osteomusculares'), ('N00', 'N99', 'Rins e vias urinárias'),
             ('O00', 'O99', 'Gravidez e parto'), ('P00', 'P96', 'Perinatais'), ('Q00', 'Q99', 'Congênitas'), ('R00', 'R99', 'Sintomas sem diagnóstico definido'),
             ('S00', 'T98', 'Trauma e intoxicações'), ('V01', 'Y98', 'Causas externas'), ('Z00', 'Z99', 'Outros motivos de atendimento')]
# Hipótese escrita sem código: CID provável pelo texto (só para agrupar no painel; o prontuário é que vale).
PALAVRAS_CID = [('INFARTO', 'I21'), ('IAM', 'I21'), ('SINDROME CORONARIANA', 'I24'), ('ANGINA', 'I20'), ('INSUFICIENCIA CARDIACA', 'I50'), ('ICC', 'I50'),
                ('AVC', 'I64'), ('ACIDENTE VASCULAR', 'I64'), ('ISQUEMICO', 'G45'), ('TROMBOSE', 'I80'), ('TROMBOFLEBITE', 'I80'), ('FLEBITE', 'I80'),
                ('EMBOLIA PULMONAR', 'I26'), ('HIPERTENS', 'I10'), ('ARRITMIA', 'I49'), ('FIBRILACAO', 'I48'),
                ('PNEUMONIA', 'J18'), ('BRONQUIOLITE', 'J21'), ('ASMA', 'J45'), ('DPOC', 'J44'), ('INSUFICIENCIA RESPIRATORIA', 'J96'), ('COVID', 'U07'),
                ('SEPSE', 'A41'), ('SEPTIC', 'A41'), ('DENGUE', 'A90'), ('CHIKUNGUNYA', 'A92'), ('DIARREIA', 'A09'), ('GASTROENTER', 'A09'),
                ('INFECCAO DO TRATO URINARIO', 'N39'), ('ITU', 'N39'), ('PIELONEFRITE', 'N10'), ('INSUFICIENCIA RENAL', 'N19'), ('LESAO RENAL', 'N17'),
                ('CELULITE', 'L03'), ('ERISIPELA', 'A46'), ('ABSCESSO', 'L02'), ('PE DIABETICO', 'E11'), ('DIABETES', 'E14'), ('CETOACIDOSE', 'E10'), ('HIPOGLICEMIA', 'E16'),
                ('CONVULS', 'R56'), ('EPILEPS', 'G40'), ('CIRROSE', 'K74'), ('HEMORRAGIA DIGESTIVA', 'K92'), ('PANCREATITE', 'K85'), ('COLECIST', 'K81'), ('APENDIC', 'K35'),
                ('ANEMIA', 'D64'), ('FRATURA', 'T14'), ('TRAUMA', 'T14'), ('INTOXICA', 'T65'), ('PSIQUI', 'F99'), ('SURTO', 'F23'), ('ESQUIZO', 'F20'), ('DEPRESS', 'F32'),
                ('ETILIS', 'F10'), ('ALCOOL', 'F10'), ('NEOPLASIA', 'C80'), ('CANCER', 'C80'), ('TUMOR', 'D48'), ('DOR ABDOMINAL', 'R10'), ('DOR TORACICA', 'R07')]


class CensoError(Exception):
    pass


def normalizar(texto):
    sem = unicodedata.normalize('NFD', str(texto or '')).encode('ascii', 'ignore').decode()
    return ' '.join(sem.split()).upper()


def capitulo_do_cid(codigo):
    base = codigo[:3]
    return next((nome for ini, fim, nome in CAPITULOS if ini <= base <= fim), None)


def cid_da_hipotese(texto):
    """(CID, capítulo, provável?) — código escrito na hipótese ou, sem ele, o provável pelas palavras."""
    t = normalizar(texto)
    m = CID.search(t)
    if m:
        codigo = f'{m.group(1)}{m.group(2)}' + (f'.{m.group(3)}' if m.group(3) else '')
        return codigo, capitulo_do_cid(codigo), False
    for palavra, codigo in PALAVRAS_CID:
        if re.search(r'(?<![A-Z])' + palavra, t):
            return codigo, capitulo_do_cid(codigo), True
    return None, None, False


def situacao_leito(texto):
    t = normalizar(texto).strip(' .')
    if not t or t in VAGOS or t.startswith(('VAGO', 'LIVRE', 'LEITO VAGO')):
        return 'vago'
    return 'bloqueado' if t.startswith(BLOQUEIOS) else 'ocupado'


def tem_alta(*textos):
    t = ' '.join(normalizar(x) for x in textos)
    return bool(re.search(r'(?<![A-Z])ALTA(?![A-Z])(?! (COMPLEXIDADE|PRIORIDADE|DOSE|RISCO))', t)) or 'DE ALTA' in t


def tipo_uti(especialidade):
    t = normalizar(especialidade)
    if not re.search(r'\b(UTI|CTI|UCO|UCI)\b|INTENSIV', t):
        return None
    if 'NEO' in t:
        return 'UTI neonatal'
    if 'PED' in t or 'INFANT' in t:
        return 'UTI pediátrica'
    return 'UTI coronariana' if 'UCO' in t or 'CORONAR' in t else 'UTI adulto'


def categoria(titulo):
    t = normalizar(titulo)
    if 'BOX' in t:
        return 'box'
    if 'MEDICA' in t:
        return 'medicacao'
    if 'OBSERVA' in t:
        return 'observacao'
    if 'ENFERMARIA' in t and 'PEDIATR' in t:
        return 'pediatria'
    if 'ENFERMARIA' in t or 'ISOLAMENTO' in t:
        return 'enfermaria'
    return None


def _data(valor):
    m = re.search(r'(\d{1,2})/(\d{1,2})/(\d{2,4})', str(valor or ''))
    if not m:
        return None
    d, mes, a = int(m.group(1)), int(m.group(2)), int(m.group(3))
    try:
        return datetime(a + (2000 if a < 100 else 0), mes, d).date()
    except ValueError:
        return None


def _idade(valor):
    """Idade em anos ("68A", "68"); meses ("5M") viram fração de ano."""
    m = re.match(r'\s*(\d{1,3})\s*([AM])?', str(valor or '').upper())
    if not m:
        return None
    n = int(m.group(1))
    return round(n / 12, 1) if m.group(2) == 'M' else n


# Cabeçalho -> campo. Nome, CPF, CNS, DN e número do SISREG nunca viram campo de saída.
CAMPOS = [('idade', ('IDADE', 'ID')), ('internacao', ('DI', 'DATA DE INTERNACAO')), ('hipotese', ('HIPOTESE DIAGNOSTICA',)),
          ('especialidade', ('ESPECIALIDADE',)), ('dias', ('DIAS INT.', 'INT. DIAS', 'INT DIAS')), ('sisreg', ('SISREG',)),
          ('situacao', ('DATA/HORA/LOCAL TRANSFERENCIA/ OBSERVACOES', 'DATA/HORA/LOCAL TRANSFERENCIA/OBSERVACOES', 'OBSERVACOES')),
          ('nome', ('NOME PACIENTE', 'NOME'))]


def ler_csv(texto):
    return [{j: c for j, c in enumerate(linha) if c != ''} for linha in csv.reader(io.StringIO(texto))]


def ler_unidade(linhas, hoje):
    """Leitos e internados das seções do topo (enfermarias, pediatria, Box, sala de medicação, observação).
    A primeira seção de outro tipo (altas, transferências…) é histórico e encerra a leitura."""
    pacientes, leitos, secao, cat, colunas, comecou = [], [], None, None, {}, False
    for v in linhas:
        a = str(v.get(0) or '').strip()
        resto = any(str(v.get(i) or '').strip() for i in range(1, 6))
        if a and not resto and not LEITO.match(a.upper()):
            n = normalizar(a)
            if 'UNIDADE DE PRONTO' in n or n.startswith('PACIENTES INTERNADOS'):
                continue
            nova = categoria(a)
            if nova is None and comecou:
                break
            secao, cat, comecou = a.strip(), nova, comecou or nova is not None
            continue
        if any(normalizar(x) in ('NOME PACIENTE', 'NOME') for x in v.values()):
            colunas = {}
            for i, cab in v.items():
                for campo, nomes in CAMPOS:
                    if normalizar(cab) in nomes and campo not in colunas:
                        colunas[campo] = i
            if 'internacao' not in colunas and 'hipotese' not in colunas:
                cat = None
            continue
        # Leito listado sem nada ao lado (ex.: "B3", "SM1") é leito vago da seção atual.
        if not cat or not a or not LEITO.match(a.upper()):
            continue
        leito = a.upper()[:-2] if a.endswith('.0') else a.upper()
        isolamento = 'ISO' in leito or 'ISOL' in normalizar(secao)
        pega = lambda campo: str(v.get(colunas[campo]) or '').strip() if campo in colunas else ''
        estado = situacao_leito(pega('nome'))
        # Box às vezes vem sem nome mas com "OBSERVAÇÃO" na hipótese: tem alguém no leito.
        if estado == 'vago' and (pega('idade') or pega('hipotese') or pega('internacao')):
            estado = 'ocupado'
        leitos.append({'categoria': cat, 'setor': secao.title(), 'leito': leito, 'isolamento': isolamento, 'ocupado': estado == 'ocupado', 'bloqueado': estado == 'bloqueado'})
        if estado != 'ocupado':
            continue
        internado = _data(pega('internacao'))
        dias = (hoje - internado).days if internado and internado <= hoje else None
        if dias is None:
            try:
                dias = int(float(pega('dias').split()[0]))
            except (ValueError, IndexError):
                dias = None
        cid, capitulo, provavel = cid_da_hipotese(pega('hipotese'))
        setor_n = normalizar(secao)
        especialidade = pega('especialidade')[:60]
        observacao = normalizar(pega('hipotese')) in ('OBSERVACAO', 'EM OBSERVACAO') or normalizar(especialidade) == 'OBSERVACAO'
        nome_completo = ' '.join(normalizar(pega('nome')).split())
        pacientes.append({
            # Primeiro nome na tela (pedido do RT, acesso só de contas autorizadas). O nome completo fica só no
            # servidor (_nome) para ligar o leito ao paciente do Gestor Saúde e é retirado antes da resposta.
            'primeiroNome': nome_completo.split()[0].title() if nome_completo and situacao_leito(nome_completo) == 'ocupado' else '',
            '_nome': nome_completo,
            'categoria': cat, 'setor': secao.title(), 'leito': leito, 'isolamento': isolamento,
            'sexo': 'M' if 'MASC' in setor_n else 'F' if 'FEMI' in setor_n else '',
            'idade': _idade(pega('idade')), 'internacao': internado.isoformat() if internado else None, 'dias': dias,
            'hipotese': pega('hipotese')[:140], 'cid': cid, 'capitulo': capitulo, 'cidProvavel': provavel,
            'especialidade': especialidade, 'observacao': observacao,
            'uti': tipo_uti(especialidade), 'alta': tem_alta(pega('nome'), pega('situacao')),
            'regulado': bool(re.search(r'\d{6,}', pega('sisreg'))), 'situacao': pega('situacao')[:140],
        })
    return pacientes, leitos


def aguardando_leito(p):
    """Esperando vaga em hospital: tem especialidade pedida (não é só observação) e ainda não teve alta."""
    return bool(p['especialidade']) and not p['observacao'] and not p['alta']


def resumir(linhas, agora):
    pacientes, leitos = ler_unidade(linhas, agora.date())
    if not leitos:
        raise CensoError('A planilha de censo não trouxe os leitos da UPA Sul.')
    conta = lambda cat: sum(p['categoria'] == cat for p in pacientes)
    bloq = lambda cat: sum(x['categoria'] == cat and x['bloqueado'] for x in leitos)
    cap_ped = sum(x['categoria'] == 'pediatria' for x in leitos)
    dias = [p['dias'] for p in pacientes if p['dias'] is not None]
    capitulos = {}
    for p in pacientes:
        if p['capitulo']:
            capitulos[p['capitulo']] = capitulos.get(p['capitulo'], 0) + 1
    cids = {}
    for p in pacientes:
        if p['cid']:
            c = cids.setdefault(p['cid'][:3], {'cid': p['cid'][:3], 'capitulo': p['capitulo'], 'n': 0, 'exemplo': p['hipotese'][:80]})
            c['n'] += 1
    especialidades = {}
    for p in pacientes:
        if aguardando_leito(p):
            especialidades[p['especialidade'].title()] = especialidades.get(p['especialidade'].title(), 0) + 1
    ocupacao = lambda cat, cap: {'ocupados': conta(cat), 'capacidade': cap, 'bloqueados': bloq(cat), 'livres': max(0, cap - conta(cat) - bloq(cat)), 'excedente': max(0, conta(cat) - cap)}
    return {
        'pacientes': sorted(pacientes, key=lambda p: (-(p['dias'] if p['dias'] is not None else -1), p['leito'])),
        'leitos': leitos,
        'resumo': {
            'internados': len(pacientes),
            'enfermaria': ocupacao('enfermaria', CAPACIDADE['enfermaria']), 'box': ocupacao('box', CAPACIDADE['box']),
            'pediatria': ocupacao('pediatria', cap_ped), 'medicacao': conta('medicacao'), 'observacao': conta('observacao'),
            'mediaDias': round(sum(dias) / len(dias), 1) if dias else None, 'maiorDias': max(dias) if dias else None,
            'acima5dias': sum(d > 5 for d in dias), 'acima10dias': sum(d > 10 for d in dias),
            'aguardandoLeito': sum(aguardando_leito(p) for p in pacientes), 'aguardandoUti': sum(bool(p['uti']) for p in pacientes),
            'semSisreg': sum(aguardando_leito(p) and not p['regulado'] for p in pacientes), 'altas': sum(p['alta'] for p in pacientes),
            'capitulos': sorted(({'capitulo': k, 'n': n} for k, n in capitulos.items()), key=lambda x: -x['n']),
            'cids': sorted(cids.values(), key=lambda x: -x['n'])[:8],
            'especialidades': sorted(({'especialidade': k, 'n': n} for k, n in especialidades.items()), key=lambda x: -x['n']),
        },
    }


class Censo:
    """Lê a planilha no máximo a cada 60 s; se o Google falhar, devolve a última leitura boa com o aviso."""

    def __init__(self, url=URL, abrir=urlopen, relogio=time.time, cache=60):
        self.url, self.abrir, self.relogio, self.cache = url, abrir, relogio, cache
        self.ultimo, self.lido, self.tentado, self.erro = None, 0, 0, None
        self.trava = threading.Lock()

    def obter(self, forcar=False):
        with self.trava:
            agora = self.relogio()
            if agora - self.tentado >= self.cache or (forcar and agora - self.tentado >= 15):
                self.tentado = agora
                try:
                    with self.abrir(Request(self.url, headers={'User-Agent': 'RT-UPA-Sul/1.0'}), timeout=25) as r:
                        texto = r.read().decode('utf-8')
                    if texto.lstrip().startswith('<'):
                        raise CensoError('A planilha publicada devolveu uma página em vez dos dados (o link de publicação mudou?).')
                    self.ultimo = resumir(ler_csv(texto), datetime.fromtimestamp(agora, CUIABA))
                    self.lido, self.erro = agora, None
                except (URLError, TimeoutError, OSError) as erro:
                    self.erro = f'A planilha de censo não respondeu ({erro.__class__.__name__}).'
                except (CensoError, UnicodeDecodeError, csv.Error) as erro:
                    self.erro = str(erro) if isinstance(erro, CensoError) else 'A planilha de censo veio num formato inesperado.'
            return {'disponivel': self.erro is None, 'erro': self.erro,
                    'lidoEm': datetime.fromtimestamp(self.lido, timezone.utc).isoformat() if self.lido else None,
                    **(self.ultimo or {'pacientes': [], 'leitos': [], 'resumo': None})}
