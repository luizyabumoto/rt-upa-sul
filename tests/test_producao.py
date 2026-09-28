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


class DemandaTests(unittest.TestCase):
    def test_conta_consultas_por_hora_sem_retornos(self):
        from gestor_saude import resumir_demanda
        linhas = {'adulto': [('ANA', h('2026-09-28T08:05'), 'URGENTE'), ('BIA', h('2026-09-28T08:50'), 'URGENTE')],
                  'pediatria': [('CARLA', h('2026-09-28T08:10'), 'URGENTE'), ('CARLA', h('2026-09-29T02:00'), 'URGENTE')]}
        self.assertEqual(resumir_demanda(linhas), {'2026-09-28T08': {'adulto': 2, 'pediatria': 1}, '2026-09-29T02': {'adulto': 0, 'pediatria': 1}})

    def test_cliente_le_so_consultas_e_painel_limita_32_dias(self):
        from gestor_saude import PainelDemanda
        fake = FakeRelatorio([{'tipo': 1, 'medico': 'ANA', 'dataAtendimento': '2026-09-10T09:00:00'},
                              {'tipo': 3, 'medico': 'ROBO', 'dataAtendimento': '2026-09-10T09:30:00'}])
        cliente = GestorSaude({'GESTOR_SAUDE_USUARIO': 'u', 'GESTOR_SAUDE_SENHA': 's'}, abrir=fake, relogio=lambda: 1_900_000_000)
        painel = PainelDemanda(cliente, relogio=lambda: h('2026-09-28T16:40').timestamp())
        r = painel.obter(h('2026-09-01T07:00'), h('2026-10-01T07:00'))
        self.assertEqual(r['horas'], {'2026-09-10T09': {'adulto': 1, 'pediatria': 0}})
        self.assertEqual({p[0] for p in fake.periodos}, {1, 2}, 'retornos (tipos 3 e 4) não são consultados')
        with self.assertRaises(ValueError):
            painel.obter(h('2026-07-01T07:00'), h('2026-09-01T07:00'))

    def test_rota_exige_login(self):
        with patch('online.remote', side_effect=provider):
            self.assertEqual(request('/api/demanda?inicio=2026-09-01T07:00')['status'], 401)
            self.assertEqual(request('/src/demand.js')['status'], 401)


class HistoricoTrocasTests(unittest.TestCase):
    def test_servidor_aceita_historico_valido_e_recusa_invalido(self):
        item = {'id': '2026-10-01D|4|ANA|BIA', 'data': '2026-10-01', 'turno': 'D', 'slot': 4, 'saiu': 'ANA\nCRM 1 - SMS',
                'entrou': 'BIA\nCRM 2 - SMS', 'consultas': 16, 'status': 'aplicada', 'criadoEm': '2026-10-01T15:00:00.000Z'}
        self.assertIn('trocas', online.validate_items({'rt-upa:trocas': json.dumps([item])}))
        for ruim in ({**item, 'status': 'qualquer'}, {**item, 'slot': 20}, {**item, 'extra': 1}, {**item, 'data': 'ontem'}):
            with self.assertRaises(online.ApiError):
                online.validate_items({'rt-upa:trocas': json.dumps([ruim])})


class HistoricoEscalaTests(unittest.TestCase):
    def test_servidor_valida_historico_de_trocas(self):
        item = {'id': 'x1', 'data': '2026-10-01', 'slot': 2, 'saiu': 'ANA\nCRM 1 - SMS', 'entrou': 'BIA\nCRM 2 - SMS',
                'origem': 'manual', 'motivo': '', 'criadoEm': '2026-10-01T10:00:00.000Z'}
        self.assertIn('historico', online.validate_items({'rt-upa:historico': json.dumps([item])}))
        for ruim in ({**item, 'origem': 'robô'}, {**item, 'slot': 16}, {**item, 'motivo': 'x' * 301}, {k: v for k, v in item.items() if k != 'motivo'}):
            with self.assertRaises(online.ApiError):
                online.validate_items({'rt-upa:historico': json.dumps([ruim])})


class PerfilMedicoHoraTests(unittest.TestCase):
    def test_pacientes_por_hora_pico_e_vale_por_medico(self):
        from gestor_saude import resumir_medicos_hora, CUIABA
        from datetime import datetime
        def at(medico, iso):
            return (medico, datetime.fromisoformat(iso).replace(tzinfo=CUIABA), 'URGENTE')
        linhas = {
            'adulto': [
                at('ANA', '2026-10-06T08:10'), at('ANA', '2026-10-06T08:40'), at('ANA', '2026-10-06T08:55'),  # 3 numa hora
                at('ANA', '2026-10-06T14:00'),                                                                  # 1 às 14h
                at('ANA', '2026-10-13T08:20'),                                                                  # 1 às 8h de outro dia
                at('BIA', '2026-10-06T09:00'),
            ],
            'retornoAdulto': [at('ANA', '2026-10-06T23:00')],   # retorno não conta
        }
        perfil = {m['medico']: m for m in resumir_medicos_hora(linhas)}
        ana = perfil['ANA']
        self.assertEqual(ana['total'], 5)          # sem o retorno
        self.assertEqual(ana['maxHora'], 3)        # 3 pacientes entre 08h-09h de 06/10
        self.assertEqual(ana['porHora'], round(5 / 3, 1))   # 3 horas-relógio ativas (08h e 14h dia 06, 08h dia 13)
        self.assertEqual(ana['horaPico'], 8)       # média 8h = (3+1)/2 = 2 pacientes
        self.assertEqual(ana['mediaPico'], 2.0)
        self.assertEqual(ana['horaVale'], 14)      # 14h = 1 paciente em 1 dia
        self.assertEqual(perfil['BIA']['total'], 1)
