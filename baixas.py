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
# Sem diagnóstico no atendimento, o Gestor recusa a alta ("Preencha o CID"). Como o robô: registra antes
# Z000 - EXAME MÉDICO GERAL como suspeita diagnóstica (POST api/PacienteAtendimentoDiagnostico, conferido no F12).
ENCERRAR = {'encaminhamentoId': 194, 'encaminhamento': 'ENCERRAR ATENDIMENTO ', 'tipoEncaminhamentoId': 18}
CID_PADRAO = {'cidId': 4870, 'texto': 'Z000 - EXAME MÉDICO GERAL'}
MOTIVO_PADRAO = 5          # "Alta por Outros Motivos" (o que o RT usou no encerramento com Z000)
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


def montar_encerramento(item_fila, atual, cid_padrao=False):
    """Corpo do POST api/AtendimentoEncaminhamento, igual ao que a tela do Gestor envia.
    Com cid_padrao=True usa o Z000 (registrado antes como diagnóstico); senão o CID já registrado (None se não houver)."""
    cid_id = CID_PADRAO['cidId'] if cid_padrao else procurar(atual, 'cidId')
    if not cid_id:
        return None
    cid_texto = CID_PADRAO['texto'] if cid_padrao else procurar(atual, 'cidFilter') or ' - '.join(str(x) for x in (procurar(atual, 'cidCodigo') or procurar(atual, 'codigo'), procurar(atual, 'cidDescricao') or procurar(atual, 'descricao')) if x)
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

        def enviar(caminho, dados):
            return self.cliente._com_token(lambda: self.cliente._chamar(caminho, dados, token=self.cliente.token))

        atual = ler(f'api/PacienteAtendimento/FindAtendimentoEncaminhamento/{int(atendimento_id)}')
        corpo = montar_encerramento(item, atual)
        if not corpo:
            # O CID pode estar só na lista de diagnósticos do atendimento (a mesma da tela "Diagnóstico do Paciente").
            try:
                diagnosticos = enviar(f'api/PacienteAtendimentoDiagnostico/Pagination/{int(atendimento_id)}',
                                      {'page': 1, 'pageSize': 10, 'filter': [], 'sort': []})
            except Exception:   # noqa: BLE001 - sem a lista, segue para o Z000 como o robô
                diagnosticos = None
            if procurar(diagnosticos, 'cidId'):
                texto = procurar(diagnosticos, 'cidFilter') or procurar(diagnosticos, 'cidDescricao')
                corpo = montar_encerramento(item, {**(atual if isinstance(atual, dict) else {}), 'cidId': procurar(diagnosticos, 'cidId'),
                                                    'cidFilter': texto if isinstance(texto, str) else ''})
        precisa_z000 = not corpo
        if precisa_z000:
            corpo = montar_encerramento(item, atual, cid_padrao=True)
        resumo = f"CID {corpo['cidFilter'] or corpo['cidId']}{' (registrado agora)' if precisa_z000 else ''} · motivo {corpo['motivoEncerramentoId']}"
        if simular:
            return {'id': atendimento_id, 'nome': nome, 'ok': True, 'simulado': True, 'mensagem': f'Pronto para encerrar ({resumo}).'}
        profissional = None
        if precisa_z000:
            try:
                profissional = int(self.cliente._claims(self.cliente.token).get('profissionalId') or 0)
            except (AttributeError, IndexError, ValueError, TypeError):
                profissional = 0
            if not profissional:
                return {'id': atendimento_id, 'nome': nome, 'ok': False, 'mensagem': 'Sem CID e a conta do Gestor não tem profissional: dar baixa à mão.'}
        conta = normalizar(self.conta())
        preso = normalizar(item.get('profissionalNome'))
        if normalizar(item.get('descricaoSituacao')) == 'ATENDIMENTO' and preso and preso != conta:
            ler(f'api/PacienteAtendimento/Funcao/{int(atendimento_id)}/4/{quote(MOTIVO_LIBERAR)}', 'POST')
        ler(f'api/PacienteAtendimento/Funcao/{int(atendimento_id)}/1/0', 'POST')     # Atender
        if precisa_z000:
            enviar('api/PacienteAtendimentoDiagnostico', {'cidId': CID_PADRAO['cidId'], 'pacienteAtendimentoId': int(atendimento_id),
                                                         'profissionalId': profissional, 'tipoDiagnostico': 'SuspeitaDiagnostico'})
        enviar('api/AtendimentoEncaminhamento', corpo)
        return {'id': atendimento_id, 'nome': nome, 'ok': True, 'mensagem': f'Atendimento encerrado ({resumo}).'}
