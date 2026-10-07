"""Aba Baixas: retornos (adulto/pediátrico) esquecidos abertos no Gestor Saúde há mais de X horas.

Só LEITURA por enquanto. A tela recebe o primeiro nome, o tipo, a situação, há quanto tempo está aberto e se está
preso com outro profissional. O encerramento em si será ligado quando a chamada do Gestor for confirmada.
"""
import re
import time
import unicodedata

TIPOS = ('RETORNO ADULTO', 'RETORNO PEDIATRICO')
SITUACOES = ('AGUARDANDO', 'ATENDIMENTO')


def normalizar(texto):
    t = unicodedata.normalize('NFD', str(texto or '')).encode('ascii', 'ignore').decode()
    return ' '.join(t.split()).upper()


def minutos_de_espera(tempo):
    """'1 dia 03:25' / '2 dias 10:00' / '05:12' → minutos."""
    ultima = str(tempo or '').strip().splitlines()[-1:] or ['']
    m = re.search(r'(?:(\d+)\s*dias?\s+)?(\d{1,3}):(\d{2})$', ultima[0].strip())
    if not m:
        return 0
    return int(m.group(1) or 0) * 1440 + int(m.group(2)) * 60 + int(m.group(3))


def candidatos(itens, horas):
    """Retornos abertos há mais de `horas`, do mais antigo para o mais novo."""
    saida = []
    for i in itens:
        if normalizar(i.get('atendimentoTipo')) not in TIPOS or normalizar(i.get('descricaoSituacao')) not in SITUACOES:
            continue
        minutos = minutos_de_espera(i.get('tempo'))
        if minutos < horas * 60 or not i.get('pacienteAtendimentoId'):
            continue
        nome = normalizar(i.get('pacienteNome')).split()
        saida.append({'id': int(i['pacienteAtendimentoId']), 'primeiroNome': nome[0].title() if nome else '',
                      'tipo': 'Retorno pediátrico' if 'PEDIATRICO' in normalizar(i.get('atendimentoTipo')) else 'Retorno adulto',
                      'situacao': normalizar(i.get('descricaoSituacao')).title(), 'minutos': minutos,
                      'profissional': ' '.join(str(i.get('profissionalNome') or '').split()[:2]).title()})
    return sorted(saida, key=lambda c: -c['minutos'])


class PainelBaixas:
    def __init__(self, cliente=None, relogio=time.time):
        from gestor_saude import cliente_compartilhado
        self.cliente = cliente or cliente_compartilhado()
        self.relogio = relogio

    def fila_completa(self):
        """Todos os atendimentos abertos (Pagination/false = também os que estão em atendimento)."""
        def ler():
            itens, pagina = [], 1
            while True:
                r = self.cliente._chamar('api/PacienteAtendimento/Pagination/false', {
                    'page': pagina, 'pageSize': 1000, 'filter': [], 'sort': [{'column': 'chegada', 'direction': 'asc'}]},
                    token=self.cliente.token) or {}
                itens += r.get('items') or []
                if len(itens) >= int(r.get('recordCount') or 0) or pagina >= 5 or not r.get('items'):
                    return itens
                pagina += 1
        return self.cliente._com_token(ler)

    def obter(self, horas):
        lista = candidatos(self.fila_completa(), horas)
        return {'horas': horas, 'candidatos': lista, 'lidoEm': self.relogio(), 'podeEncerrar': False}
