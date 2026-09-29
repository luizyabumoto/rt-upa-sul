import base64
import io
import json
import os
import unittest
from datetime import datetime
from unittest.mock import patch
from urllib.error import HTTPError

import online
from gestor_saude import CUIABA, GestorSaude, GestorSaudeError, PainelFluxo, resumir
from test_online import provider, request

AGORA = datetime(2026, 9, 28, 16, 0, tzinfo=CUIABA)


def item(tipo, situacao='AGUARDANDO', minutos=10, prioridade=5, cor='#008000', profissional=None, **extra):
    chegada = datetime.fromtimestamp(AGORA.timestamp() - minutos * 60, CUIABA).replace(tzinfo=None).isoformat()
    return {'atendimentoTipo': tipo, 'descricaoSituacao': situacao, 'chegada': chegada, 'prioridade': prioridade,
            'cor': cor, 'profissionalId': profissional, 'pacienteNome': 'NOME QUE NÃO PODE SAIR', 'cpf': '98765432100', **extra}


class ResumoTests(unittest.TestCase):
    def test_so_conta_quem_aguarda_sem_medico_nos_consultorios(self):
        fila = [
            item('CONSULTÓRIO ADULTO', minutos=30),
            item('CONSULTÓRIO ADULTO', minutos=90, prioridade=3, cor='#FFFF00'),
            item('CONSULTÓRIO ADULTO', minutos=50, profissional=3351),              # já tem médico: não aguarda
            item('CONSULTÓRIO ADULTO', 'ATENDIMENTO', minutos=5, profissional=4087),
            item('CONSULTÓRIO PEDIÁTRICO', minutos=20, prioridade=4, cor='#8a11b6'),
            item('BOX DE EMERGÊNCIA', minutos=15, prioridade=1, cor='#FF0000'),     # não entra
            item('RETORNO ADULTO', minutos=3000),
            item('RETORNO PEDIÁTRICO', minutos=100),
            item('CLASSIFICAÇÃO DE RISCO', minutos=12),
            item('CLASSIFICAÇÃO DE RISCO', minutos=4, profissional=9),
        ]
        r = resumir(fila, AGORA)
        self.assertEqual(r['total'], {'aguardando': 3, 'maiorEspera': 90, 'media': 47})
        self.assertEqual(r['adulto'], {'aguardando': 2, 'maiorEspera': 90, 'media': 60, 'emAtendimento': 2})
        self.assertEqual(r['pediatria'], {'aguardando': 1, 'maiorEspera': 20, 'media': 20, 'emAtendimento': 0})
        self.assertEqual([c['chave'] for c in r['classificacoes']], ['amarelo', 'roxo', 'verde'])
        roxo = r['classificacoes'][1]
        self.assertEqual((roxo['descricao'], roxo['pediatria'], roxo['adulto'], roxo['cor']), ('Prioridade', 1, 0, '#8a11b6'))
        self.assertEqual(r['triagem'], {'aguardando': 1, 'maiorEspera': 12, 'media': 12})
        self.assertEqual(r['retornosPendentes'], 2)
        self.assertNotIn('NOME QUE NÃO PODE SAIR', json.dumps(r, ensure_ascii=False))

    def test_espera_acima_de_12h_fica_a_parte_e_nao_distorce_maior_espera(self):
        r = resumir([item('CONSULTÓRIO ADULTO', minutos=800), item('CONSULTÓRIO ADULTO', minutos=40, prioridade=7, cor='#0d0d0d')], AGORA)
        self.assertEqual(r['possiveisEsquecidos'], {'quantidade': 1, 'maiorEspera': 800})
        self.assertEqual(r['total']['maiorEspera'], 40)
        self.assertEqual(r['classificacoes'][0]['descricao'], 'Sutura')

    def test_fila_vazia(self):
        r = resumir([], AGORA)
        self.assertEqual(r['total'], {'aguardando': 0, 'maiorEspera': None, 'media': None})
        self.assertEqual(r['classificacoes'], [])


def jwt(claims):
    return 'x.' + base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('=') + '.y'


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeGestor:
    """Imita as quatro chamadas do Gestor Saúde e registra o que foi pedido."""

    def __init__(self, fila, senha='certa'):
        self.fila, self.senha, self.chamadas = fila, senha, []
        self.token_valido = 'ctx-1'

    def __call__(self, pedido, timeout=None):
        caminho = pedido.full_url.split('.br/', 1)[1]
        corpo = json.loads(pedido.data) if pedido.data else None
        auth = pedido.headers.get('Authorization')
        self.chamadas.append(caminho)
        def erro(code):
            return HTTPError(pedido.full_url, code, 'erro', {}, io.BytesIO(b'{}'))
        if caminho == 'Api/Token':
            if corpo['password'] != self.senha:
                raise erro(400)
            return FakeResponse(json.dumps({'access_token': jwt({'usuarioId': '3659', 'sessaoId': '1'})}).encode())
        if caminho == 'api/Usuario/ConfigAtendimentoPadrao/3659':
            return FakeResponse(json.dumps({'estabelecimentoId': 80, 'cboId': 455, 'setorId': 1615, 'departamentoId': 452}).encode())
        if caminho == 'Api/Token/AutorizaPermissaoUsuario':
            assert corpo['estabelecimentoId'] == 80 and corpo['usuarioId'] == 3659
            return FakeResponse(json.dumps({'access_token': jwt({'exp': 2_000_000_000}) if self.token_valido else 'x'}).encode())
        if caminho == 'api/PacienteAtendimento/Pagination/true':
            if auth != 'Bearer ' + jwt({'exp': 2_000_000_000}):
                raise erro(401)
            return FakeResponse(json.dumps({'items': self.fila, 'recordCount': len(self.fila)}).encode())
        raise AssertionError(caminho)


class ClienteTests(unittest.TestCase):
    def env(self, **extra):
        return {'GESTOR_SAUDE_USUARIO': 'LUIZ', 'GESTOR_SAUDE_SENHA': 'certa', **extra}

    def test_login_contexto_e_leitura_reaproveitando_o_token(self):
        fake = FakeGestor([item('CONSULTÓRIO ADULTO')])
        cliente = GestorSaude(self.env(), abrir=fake, relogio=lambda: 1_900_000_000)
        self.assertEqual(len(cliente.fila()), 1)
        self.assertEqual(len(cliente.fila()), 1)
        self.assertEqual(fake.chamadas.count('Api/Token'), 1, 'não pode fazer login a cada leitura')
        self.assertEqual(fake.chamadas[-1], 'api/PacienteAtendimento/Pagination/true')

    def test_sem_configuracao_ou_senha_errada_vira_erro_claro(self):
        with self.assertRaisesRegex(GestorSaudeError, 'configurada'):
            GestorSaude({}, abrir=FakeGestor([])).fila()
        with self.assertRaisesRegex(GestorSaudeError, 'usuário ou a senha'):
            GestorSaude(self.env(GESTOR_SAUDE_SENHA='errada'), abrir=FakeGestor([])).fila()


class PainelTests(unittest.TestCase):
    class Cliente:
        def __init__(self):
            self.leituras, self.falhar = 0, False

        def fila(self):
            self.leituras += 1
            if self.falhar:
                raise GestorSaudeError('O Gestor Saúde não respondeu.')
            return [item('CONSULTÓRIO ADULTO', minutos=10)]

    def test_cache_limita_consultas_e_falha_preserva_ultima_leitura(self):
        agora = [1_900_000_000.0]
        cliente = self.Cliente()
        painel = PainelFluxo(cliente, relogio=lambda: agora[0], cache_segundos=45)
        primeira = painel.obter()
        self.assertTrue(primeira['disponivel'])
        agora[0] += 10
        painel.obter()
        painel.obter(forcar=True)                     # menos de 15 s: não consulta de novo
        self.assertEqual(cliente.leituras, 1)
        agora[0] += 50
        cliente.falhar = True
        falha = painel.obter()
        self.assertFalse(falha['disponivel'])
        self.assertEqual(falha['erro'], 'O Gestor Saúde não respondeu.')
        self.assertEqual(falha['dados'], primeira['dados'], 'não pode zerar os indicadores')
        self.assertEqual(falha['atualizadoEm'], primeira['atualizadoEm'])


class RotaTests(unittest.TestCase):
    def setUp(self):
        for p in (patch.dict(os.environ, {'APP_ORIGIN': 'http://127.0.0.1:8001'}), patch('online.remote', side_effect=provider)):
            p.start()
            self.addCleanup(p.stop)
        online.FLUXO = None
        self.addCleanup(setattr, online, 'FLUXO', None)

    def test_fluxo_exige_login_e_devolve_so_numeros(self):
        self.assertEqual(request('/api/fluxo')['status'], 401)
        online.FLUXO = PainelFluxo(PainelTests.Cliente(), relogio=lambda: AGORA.timestamp(), cache_segundos=45)
        result = request('/api/fluxo', token='test-token')
        self.assertEqual(result['status'], 200)
        body = json.loads(result['body'])
        self.assertEqual(body['dados']['adulto']['aguardando'], 1)
        self.assertNotIn('NOME QUE NÃO PODE SAIR', result['body'].decode('utf8'))
        self.assertNotIn('98765432100', result['body'].decode('utf8'))

    def test_flow_js_so_com_login(self):
        self.assertEqual(request('/src/flow.js')['status'], 401)


if __name__ == '__main__':
    unittest.main()
