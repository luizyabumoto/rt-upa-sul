"""Última evolução médica de cada internado (Gestor Saúde simulado; textos fictícios)."""
import unittest

from evolucao_texto import cruzar_resumos, eh_medica, internados_na_fila, ler_resumos, texto_de_html, ultima_medica

MEDICA = '<p><strong>#EVOLUÇÃO DIÁRIA:</strong> PACIENTE ESTÁVEL.</p><p><strong>HD:</strong></p><ul><li>PNEUMONIA</li><li>DPOC</li></ul><p><strong>CD:</strong></p><ul><li>MANTENHO ATB</li><li>AGUARDO VAGA EM HOSPITAL</li></ul>'
ENFERMAGEM = '<p>PACIENTE ACAMADA, ACEITANDO DIETA, SEM INTERCORRENCIAS NO PLANTAO. SINAIS VITAIS ESTÁVEIS.</p>'
ITENS = [
    {'pacienteAtendimentoEvolucaoId': 3, 'dataEvolucao': '2026-10-05T18:19:46', 'descricao': ENFERMAGEM, 'hipoteseDiagnostica': 'EVOLUÇÃO - ENFERMEIRO', 'profissional': {'nome': 'ENFERMEIRA TESTE'}},
    {'pacienteAtendimentoEvolucaoId': 2, 'dataEvolucao': '2026-10-05T10:05:00', 'descricao': MEDICA, 'hipoteseDiagnostica': 'PNEUMONIA', 'profissional': {'nome': 'MEDICO VISITADOR TESTE'}, 'cboId': 455},
    {'pacienteAtendimentoEvolucaoId': 1, 'dataEvolucao': '2026-10-04T09:00:00', 'descricao': MEDICA.replace('PNEUMONIA', 'ITU'), 'profissional': {'nome': 'OUTRO MEDICO'}, 'cboId': 455},
]


class Cliente:
    token = 't'
    configurado = True

    def _com_token(self, acao):
        return acao()

    def fila(self):
        return [{'atendimentoTipo': 'ENFERMARIA', 'pacienteId': 11, 'idadeMeses': '68 ano(s) 2 mese(s) 1 dia(s)', 'chegada': '2026-10-01T10:00:00'},
                {'atendimentoTipo': 'CONSULTÓRIO ADULTO', 'pacienteId': 99, 'idadeMeses': '30 ano(s)', 'chegada': '2026-10-05T10:00:00'}]

    def _chamar(self, caminho, corpo=None, token=None, metodo='POST'):
        assert caminho == 'api/PacienteAtendimentoEvolucao/Pagination/11' and corpo['sort'][0]['direction'] == 'desc'
        return {'items': ITENS}


class EvolucaoTextoTest(unittest.TestCase):
    def test_html_vira_texto(self):
        self.assertIn('HD:\n- PNEUMONIA\n- DPOC', texto_de_html(MEDICA))

    def test_pega_a_ultima_evolucao_de_medico(self):
        e = ultima_medica(ITENS)
        self.assertEqual(e['medico'], 'MEDICO VISITADOR TESTE')
        self.assertEqual(e['resumo']['hipoteses'], ['Pneumonia', 'Dpoc'])
        self.assertEqual(e['resumo']['pendencias'], ['Aguardo vaga em hospital'])

    def test_enfermagem_nao_conta_e_nome_da_unidade_conta(self):
        self.assertFalse(eh_medica(ITENS[0], texto_de_html(ENFERMAGEM)))
        sem_cbo = {'profissional': {'nome': 'LAURA THAYNA GELATI'}, 'descricao': 'Paciente estável'}
        self.assertTrue(eh_medica(sem_cbo, 'Paciente estável', medicos={'LAURA THAYNA GELATI'}))
        self.assertFalse(eh_medica(sem_cbo, 'Paciente estável'))

    def test_liga_ao_leito_pela_idade_e_data_de_internacao(self):
        resumos = ler_resumos(Cliente())
        self.assertEqual(len(resumos), 1)   # só o internado (consultório fica de fora)
        pacientes = [{'leito': 'M1', 'categoria': 'enfermaria', 'idade': 68, 'internacao': '2026-10-01'},
                     {'leito': 'F2', 'categoria': 'enfermaria', 'idade': 59, 'internacao': '2026-09-23'}]
        r = {p['leito']: p for p in cruzar_resumos(pacientes, resumos)}
        self.assertEqual(r['M1']['resumo']['hipoteses'], ['Pneumonia', 'Dpoc'])
        self.assertEqual(r['M1']['resumoMedico'], 'MEDICO VISITADOR TESTE')
        self.assertNotIn('resumo', r['F2'])
        self.assertNotIn('pacienteId', r['M1'])

    def test_formato_real_do_gestor(self):
        # Campos confirmados no diagnóstico de 05/10/2026: data, dataEvolucao, evolucao, hipotese,
        # pacienteAtendimentoEvolucaoId e profisionalResponsavel (com um "s" só, como vem do Gestor).
        itens = [
            {'pacienteAtendimentoEvolucaoId': 9, 'data': None, 'dataEvolucao': '2026-10-05T18:00:00', 'hipotese': 'EVOLUÇÃO - ENFERMEIRO',
             'evolucao': ENFERMAGEM, 'profisionalResponsavel': 'CARLA ENFERMEIRA TESTE'},
            {'pacienteAtendimentoEvolucaoId': 8, 'data': None, 'dataEvolucao': '2026-10-05T16:00:00', 'hipotese': 'EVOLUÇÃO - NIR',
             'evolucao': '<p>PACIENTE EVOLUIDO NO SISREG, AGUARDANDO VAGA. CONTATO COM A CENTRAL REALIZADO.</p>', 'profisionalResponsavel': 'NIR TESTE'},
            {'pacienteAtendimentoEvolucaoId': 7, 'data': None, 'dataEvolucao': '2026-10-05T10:45:00', 'hipotese': 'EVOLUÇÃO DIARIA',
             'evolucao': MEDICA, 'profisionalResponsavel': 'LUIZ FERNANDO TESTE'},
        ]
        e = ultima_medica(itens)
        self.assertEqual(e['medico'], 'LUIZ FERNANDO TESTE')
        self.assertEqual(e['data'][:16], '2026-10-05T10:45')
        self.assertEqual(e['resumo']['hipoteses'], ['Pneumonia', 'Dpoc'])
        # Médico da unidade reconhecido pelo nome mesmo sem o roteiro HD/CD.
        curto = {'dataEvolucao': '2026-10-05T19:00:00', 'hipotese': 'PIELONEFRITE', 'evolucao': '<p>PACIENTE ESTÁVEL, SEM QUEIXAS, MANTÉM CONDUTA E ANTIBIOTICOTERAPIA.</p>', 'profisionalResponsavel': 'LORENI MEDICA TESTE'}
        self.assertEqual(ultima_medica([curto] + itens, medicos={'LORENI MEDICA TESTE'})['medico'], 'LORENI MEDICA TESTE')

    def test_fila_so_internados(self):
        self.assertEqual([p['anos'] for p in internados_na_fila(Cliente().fila())], [68])


if __name__ == '__main__':
    unittest.main()
