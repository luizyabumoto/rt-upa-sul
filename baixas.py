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


# Encerramento confirmado no Gestor (F12 do RT, 07/10/2026): Atender = POST Funcao/{id}/1/0; depois
# POST api/AtendimentoEncaminhamento com encaminhamento 194 "ENCERRAR ATENDIMENTO" e o CID já registrado no atendimento.
ENCERRAR = {'encaminhamentoId': 194, 'encaminhamento': 'ENCERRAR ATENDIMENTO ', 'tipoEncaminhamentoId': 18}
MOTIVO_PADRAO = 3          # "Alta Melhorado" (o que o RT usou no encerramento manual)
MINIMO_HORAS = 24          # nunca encerra retorno aberto há menos que isso, venha o pedido de onde vier
MOTIVO_LIBERAR = 'FINALIZAR ATENDIMENTO'


def procurar(obj, chave):
    """Primeiro valor não vazio de `chave` em qualquer nível do JSON."""
    if isinstance(obj, dict):
        if obj.get(chave) not in (None, '', 0):
            return obj[chave]
        obj = list(obj.values())
    if isinstance(obj, list):
        for v in obj:
            achado = procurar(v, chave)
            if achado not in (None, '', 0):
                return achado
    return None


def montar_encerramento(item_fila, atual):
    """Corpo do POST api/AtendimentoEncaminhamento, igual ao que a tela do Gestor envia.
    None se o atendimento não tem CID registrado (aí a baixa fica para ser feita à mão)."""
    cid_id = procurar(atual, 'cidId')
    if not cid_id:
        return None
    cid_texto = procurar(atual, 'cidFilter') or ' - '.join(str(x) for x in (procurar(atual, 'cidCodigo') or procurar(atual, 'codigo'), procurar(atual, 'cidDescricao') or procurar(atual, 'descricao')) if x)
    return {'pacienteAtendimentoId': int(item_fila['pacienteAtendimentoId']), 'encaminhamentoId': ENCERRAR['encaminhamentoId'],
            'encaminhamentoFilter': dict(ENCERRAR), 'motivoEncerramentoId': int(procurar(atual, 'motivoEncerramentoId') or MOTIVO_PADRAO),
            'cidId': int(cid_id), 'cidFilter': str(cid_texto or ''),
            'atendimentoTipoId': int(item_fila.get('atendimentoTipoId') or procurar(atual, 'atendimentoTipoId') or 0)}


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

    def conta(self):
        """Nome da conta do Gestor que o site usa: é nela que as baixas ficam registradas."""
        try:
            return self.cliente._claims(self.cliente.token).get('username') or ''
        except (AttributeError, IndexError, ValueError, TypeError):
            return ''

    def obter(self, horas):
        lista = candidatos(self.fila_completa(), horas)
        return {'horas': horas, 'candidatos': lista, 'lidoEm': self.relogio(), 'podeEncerrar': True, 'conta': self.conta()}

    def encerrar(self, atendimento_id, simular=True):
        """Encerra UM retorno esquecido. Confere tudo de novo no Gestor antes (ainda aberto, é retorno, passou de 24 h).
        simular=True só lê e devolve o que seria enviado, sem alterar nada."""
        from urllib.parse import quote
        item = next((i for i in self.fila_completa() if str(i.get('pacienteAtendimentoId')) == str(atendimento_id)), None)
        if not item:
            return {'id': atendimento_id, 'ok': False, 'mensagem': 'Não está mais aberto no Gestor (alguém já deu baixa).'}
        if not candidatos([item], MINIMO_HORAS):
            return {'id': atendimento_id, 'ok': False, 'mensagem': f'Não é retorno aberto há mais de {MINIMO_HORAS} h; nada foi feito.'}
        nome = (candidatos([item], MINIMO_HORAS)[0]['primeiroNome'])

        def ler(caminho, metodo='GET'):
            return self.cliente._com_token(lambda: self.cliente._chamar(caminho, token=self.cliente.token, metodo=metodo))

        atual = ler(f'api/PacienteAtendimento/FindAtendimentoEncaminhamento/{int(atendimento_id)}')
        corpo = montar_encerramento(item, atual)
        if not corpo:
            return {'id': atendimento_id, 'nome': nome, 'ok': False, 'mensagem': 'Sem CID registrado no atendimento: dar baixa à mão no Gestor.'}
        resumo = f"CID {corpo['cidFilter'] or corpo['cidId']} · motivo {corpo['motivoEncerramentoId']}"
        if simular:
            return {'id': atendimento_id, 'nome': nome, 'ok': True, 'simulado': True, 'mensagem': f'Pronto para encerrar ({resumo}).'}
        conta = normalizar(self.conta())
        preso = normalizar(item.get('profissionalNome'))
        if normalizar(item.get('descricaoSituacao')) == 'ATENDIMENTO' and preso and preso != conta:
            ler(f'api/PacienteAtendimento/Funcao/{int(atendimento_id)}/4/{quote(MOTIVO_LIBERAR)}', 'POST')
        ler(f'api/PacienteAtendimento/Funcao/{int(atendimento_id)}/1/0', 'POST')     # Atender
        self.cliente._com_token(lambda: self.cliente._chamar('api/AtendimentoEncaminhamento', corpo, token=self.cliente.token))
        return {'id': atendimento_id, 'nome': nome, 'ok': True, 'mensagem': f'Atendimento encerrado ({resumo}).'}
