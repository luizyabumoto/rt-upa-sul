import json
import os
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

import online
from gestor_saude import CUIABA, GestorSaude, GestorSaudeError, PainelProducao, plantao_de, resumir_producao
from test_fluxo import FakeResponse, jwt
from test_online import provider


def request(url, token=None):
    path, _, query = url.partition('?')
    env = {'PATH_INFO': path, 'QUERY_STRING': query, 'REQUEST_METHOD': 'GET', 'HTTP_COOKIE': f'rt_session={token}' if token else ''}
    result = {}
    def start(status, headers):
        result.update(status=int(status[:3]), headers=headers)
    result['body'] = b''.join(online.app(env, start))
    return result


def h(texto):
    return datetime.fromisoformat(texto).replace(tzinfo=CUIABA)


class PlantaoTests(unittest.TestCase):
    def test_plantoes_de_12h_comecam_as_7_e_as_19(self):
        self.assertEqual(plantao_de(h('2026-09-28T07:00')), ('2026-09-28', 'D'))
        self.assertEqual(plantao_de(h('2026-09-28T18:59')), ('2026-09-28', 'D'))
        self.assertEqual(plantao_de(h('2026-09-28T19:00')), ('2026-09-28', 'N'))
        self.assertEqual(plantao_de(h('2026-09-29T06:59')), ('2026-09-28', 'N'))  # noturno é do dia em que começou
        self.assertEqual(plantao_de(h('2026-10-01T03:00')), ('2026-09-30', 'N'))


class ResumoProducaoTests(unittest.TestCase):
    def test_conta_consultas_por_plantao_e_retorno_fica_a_parte(self):
        linhas = {
            'adulto': [('ANA', h('2026-09-28T08:00'), 'POUCO URGENTE'), ('ANA', h('2026-09-28T09:00'), 'PRIORIDADE'),
                       ('ANA', h('2026-09-28T20:00'), 'URGENTE'), ('BIA', h('2026-09-29T02:00'), 'Não Urgente')],
            'pediatria': [('CARLA', h('2026-09-28T10:00'), 'EMERGÊNCIA')],
            'retornoAdulto': [('ANA', h('2026-09-28T08:30'), 'POUCO URGENTE'), ('ROBO', h('2026-09-28T08:31'), 'POUCO URGENTE')],
            'retornoPediatria': [],
        }
        r = {(x['data'], x['turno'], x['medico']): x for x in resumir_producao(linhas)}
        ana_dia = r[('2026-09-28', 'D', 'ANA')]
        self.assertEqual((ana_dia['adulto'], ana_dia['retornos'], ana_dia['classes']), (2, 1, {'poucoUrgente': 1, 'prioridade': 1}))
        self.assertEqual(r[('2026-09-28', 'N', 'BIA')]['classes'], {'naoUrgente': 1})
        self.assertEqual(r[('2026-09-28', 'D', 'CARLA')]['pediatria'], 1)
        robo = r[('2026-09-28', 'D', 'ROBO')]
        self.assertEqual((robo['adulto'], robo['pediatria'], robo['retornos'], robo['classes']), (0, 0, 1, {}))


class FakeRelatorio:
    """Gestor Saúde de mentira: tipos, CBOs e um relatório que respeita o período pedido."""

    def __init__(self, atendimentos):
        self.atendimentos, self.periodos = atendimentos, []

    def __call__(self, pedido, timeout=None):
        caminho = pedido.full_url.split('.br/', 1)[1]
        corpo = json.loads(pedido.data) if pedido.data else None
        responder = lambda dado: FakeResponse(json.dumps(dado).encode())
        if caminho == 'Api/Token':
            return responder({'access_token': jwt({'usuarioId': '1', 'sessaoId': '1'})})
        if caminho.startswith('api/Usuario/ConfigAtendimentoPadrao'):
            return responder({'estabelecimentoId': 80, 'cboId': 455, 'setorId': 1, 'departamentoId': 1})
        if caminho == 'Api/Token/AutorizaPermissaoUsuario':
            return responder({'access_token': jwt({'exp': 2_000_000_000})})
        if caminho == 'api/AtendimentoTipo':
            return responder([{'atendimentoTipo': n, 'atendimentoTipoId': i} for i, n in enumerate(['CONSULTÓRIO ADULTO', 'CONSULTÓRIO PEDIÁTRICO', 'RETORNO ADULTO', 'RETORNO PEDIÁTRICO'], 1)])
        if caminho.startswith('api/Cbo/GetByAtendimentoTipoId/'):
            return responder([{'cboId': 455, 'cboCodigo': '225125'}, {'cboId': 454, 'cboCodigo': '225124'}, {'cboId': 400, 'cboCodigo': '223505'}])
        if caminho == 'api/PacienteAtendimento/ImprimirProducaoAnalitico':
            ini, fim = (datetime.fromisoformat(corpo[k]) for k in ('competenciaInicial', 'competenciaFinal'))
            assert fim - ini <= timedelta(days=31) and corpo['formato'] == 2 and corpo['profissionalId'] == 0
            self.periodos.append((corpo['atendimentoTipoId'], ini, fim))
            dentro = [a for a in self.atendimentos if a['tipo'] == corpo['atendimentoTipoId'] and ini <= datetime.fromisoformat(a['dataAtendimento']) < fim + timedelta(minutes=1)]
            return responder({'atendimentos': [{'profissional': a['medico'] + ' ', 'paciente': 'NOME DO PACIENTE', 'cns': '700000000000000',
                                                'cid': 'Z000', 'dataAtendimento': a['dataAtendimento'], 'classificacaoDescricao': 'URGENTE'} for a in dentro]})
        raise AssertionError(caminho)


class ClienteProducaoTests(unittest.TestCase):
    def test_periodo_longo_em_partes_sem_contar_duas_vezes_e_sem_dados_de_paciente(self):
        atendimentos = [{'tipo': 1, 'medico': 'ANA', 'dataAtendimento': (datetime(2026, 8, 1, 7) + timedelta(hours=10 * i)).isoformat()} for i in range(150)]
        fake = FakeRelatorio(atendimentos)
        cliente = GestorSaude({'GESTOR_SAUDE_USUARIO': 'u', 'GESTOR_SAUDE_SENHA': 's'}, abrir=fake, relogio=lambda: 1_900_000_000)
        linhas = cliente.producao(h('2026-08-01T07:00'), h('2026-09-30T07:00'))
        dentro = [a for a in atendimentos if datetime.fromisoformat(a['dataAtendimento']) <= datetime(2026, 9, 30, 7)]
        self.assertEqual(len(dentro), 145)
        self.assertEqual(len(linhas['adulto']), len(dentro))
        self.assertGreaterEqual(len([p for p in fake.periodos if p[0] == 1]), 2)
        self.assertEqual(linhas['adulto'][0][0], 'ANA')                      # nome do médico sem espaço sobrando
        self.assertNotIn('NOME DO PACIENTE', repr(linhas))
        self.assertNotIn('700000000000000', repr(linhas))


class PainelProducaoTests(unittest.TestCase):
    class Cliente:
        def __init__(self):
            self.leituras, self.falhar = 0, False

        def producao(self, inicio, fim):
            self.leituras += 1
            if self.falhar:
                raise GestorSaudeError('O Gestor Saúde não respondeu.')
            return {'adulto': [('ANA', inicio + timedelta(minutes=5), 'URGENTE')], 'pediatria': [], 'retornoAdulto': [], 'retornoPediatria': []}

    def test_plantao_em_andamento_relido_a_cada_2_min_e_limites_de_periodo(self):
        agora = [h('2026-09-28T16:40').timestamp()]
        cliente = self.Cliente()
        painel = PainelProducao(cliente, relogio=lambda: agora[0])
        r = painel.obter(h('2026-09-28T07:00'))
        self.assertTrue(r['emAndamento'])
        self.assertEqual(r['registros'][0]['adulto'], 1)
        agora[0] += 60
        painel.obter(h('2026-09-28T07:00'))
        self.assertEqual(cliente.leituras, 1)
        agora[0] += 90
        cliente.falhar = True
        falha = painel.obter(h('2026-09-28T07:00'))
        self.assertFalse(falha['disponivel'])
        self.assertEqual(falha['registros'], r['registros'], 'mantém a última leitura válida')
        with self.assertRaises(ValueError):
            painel.obter(h('2026-01-01T07:00'), h('2026-09-01T07:00'))
        with self.assertRaises(ValueError):
            painel.obter(h('2026-09-28T19:00'), h('2026-09-28T07:00'))


class RotaProducaoTests(unittest.TestCase):
    def setUp(self):
        for p in (patch.dict(os.environ, {'APP_ORIGIN': 'http://127.0.0.1:8001'}), patch('online.remote', side_effect=provider)):
            p.start()
            self.addCleanup(p.stop)
        online.PRODUCAO = PainelProducao(PainelProducaoTests.Cliente(), relogio=lambda: h('2026-09-28T16:40').timestamp())
        self.addCleanup(setattr, online, 'PRODUCAO', None)

    def test_exige_login_valida_datas_e_devolve_contagens(self):
        self.assertEqual(request('/api/producao?inicio=2026-09-28T07:00')['status'], 401)
        self.assertEqual(request('/src/production.js')['status'], 401)
        env_request = lambda q: request('/api/producao?' + q, token='test-token')
        self.assertEqual(env_request('inicio=ontem')['status'], 400)
        ok = env_request('inicio=2026-09-28T07:00&fim=agora')
        self.assertEqual(ok['status'], 200)
        self.assertEqual(json.loads(ok['body'])['registros'][0]['medico'], 'ANA')


if __name__ == '__main__':
    unittest.main()
