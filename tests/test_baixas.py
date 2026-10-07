import unittest

from baixas import candidatos, minutos_de_espera


class BaixasTest(unittest.TestCase):
    def test_tempo(self):
        self.assertEqual(minutos_de_espera('21/09/2026\n1 dia 03:25'), 1645)
        self.assertEqual(minutos_de_espera('05:12'), 312)

    def test_so_retornos_abertos_alem_do_limite(self):
        itens = [
            {'pacienteAtendimentoId': 1, 'pacienteNome': 'ANA TESTE SILVA', 'atendimentoTipo': 'RETORNO ADULTO', 'descricaoSituacao': 'AGUARDANDO', 'tempo': '3 dias 01:00'},
            {'pacienteAtendimentoId': 2, 'pacienteNome': 'BIA TESTE', 'atendimentoTipo': 'RETORNO PEDIÁTRICO', 'descricaoSituacao': 'ATENDIMENTO', 'tempo': '4 dias 00:00', 'profissionalNome': 'JOSE PEDRO TESTE'},
            {'pacienteAtendimentoId': 3, 'pacienteNome': 'CAIO TESTE', 'atendimentoTipo': 'RETORNO ADULTO', 'descricaoSituacao': 'AGUARDANDO', 'tempo': '10:00'},
            {'pacienteAtendimentoId': 4, 'pacienteNome': 'DANI TESTE', 'atendimentoTipo': 'CONSULTORIO ADULTO', 'descricaoSituacao': 'AGUARDANDO', 'tempo': '5 dias 00:00'},
        ]
        r = candidatos(itens, 72)
        self.assertEqual([c['id'] for c in r], [2, 1])
        self.assertEqual(r[0]['primeiroNome'], 'Bia')
        self.assertEqual(r[0]['tipo'], 'Retorno pediátrico')
        self.assertEqual(r[0]['profissional'], 'Jose Pedro')
        self.assertNotIn('pacienteNome', r[1])


if __name__ == '__main__':
    unittest.main()
