"""Resumo da evolução médica (feito no servidor, sem serviço externo). Texto fictício no roteiro usado na UPA."""
import unittest

from resumo_evolucao import resumir_evolucao, secoes

TEXTO = """#DATA INTERNAÇÃO: 01/10/26

#HDA ADMISSAO: PACIENTE TRAZIDA PELA FAMILIA COM QUADRO DE ANURIA, EDEMA DE MMII, FEBRE HÁ 2 DIAS.

#HPP:

COMORBIDADES: AVC PREVIO, DM TIPO 2, HAS, CARDIOPATIA
MED EM USO: NÃO SE RECORDA
ALERGIA MEDICAMENTOSAS: NEGA
#EVOLUÇÃO DIÁRIA: PACIENTE EM LEITO DE ENFERMARIA COMUM, ACOMPANHADA, REG, COM MELHORA APÓS PASSAGEM DE SVD. NO MOMENTO ESTAVEL HEMODINAMICAMENTE, SEM SINAIS DE ESFORÇO RESPIRATÓRIO. FOI INICIADO D0 DE METRONIDAZOL 02/10. MANTENHO INTERNAÇÃO.

EXAME FISICO:

SSVV: PA 117X70 / FC 84 / TAX 35,2 / DEXTRO 170 / SPO2 97% AA

Geral: REG, corada, hidratada
AR: MVUA, SEM RA
#EXAMES LAB:

04/10/2026: HB 7,0/HT 20,3/LEUCO 3.630/PLAQ 308.000/PCR 3,68
HD:

ANEMIA POR DOENÇA CRONICA?
ITU - IRA EM MELHORA?
CD:

MANTENHO INTERNAÇÃO
SOLICITO LABS + NOVO EAS
MANTENHO ATB
AGUARDO UROCULTURA - COLETADA EM 01/10/26
AGUARDO TRANSFERENCIA PARA HOSPITAL DE REFERENCIA
ACIONAR BOX SE INTERCORRENCIAS
"""


class ResumoEvolucaoTest(unittest.TestCase):
    def test_hipoteses_conduta_e_pendencias(self):
        r = resumir_evolucao(TEXTO)
        self.assertEqual(r['hipoteses'], ['Anemia por doença cronica?', 'Itu - ira em melhora?'])
        self.assertIn('Mantenho atb', r['conduta'])
        self.assertEqual(r['pendencias'], ['Solicito labs + novo eas', 'Aguardo urocultura - coletada em 01/10/26', 'Aguardo transferencia para hospital de referencia'])
        self.assertTrue(r['frase'].startswith('HD: Anemia por doença cronica? · Itu - ira em melhora? | Aguarda: '))

    def test_vitais_antibiotico_e_contexto(self):
        r = resumir_evolucao(TEXTO)
        self.assertEqual(r['vitais'], {'PA': '117x70', 'FC': '84', 'SpO2': '97', 'Tax': '35,2', 'Dextro': '170'})
        self.assertEqual(r['antibioticos'], ['Metronidazol (D0)'])
        self.assertTrue(r['comorbidades'].startswith('Avc previo, dm tipo 2'))
        self.assertEqual(r['alergias'], 'Nega')
        self.assertTrue(r['estado'].startswith('Paciente em leito de enfermaria comum'))

    def test_texto_sem_roteiro_nao_quebra(self):
        r = resumir_evolucao('Paciente estável, sem queixas. Mantém conduta.')
        self.assertEqual(r['hipoteses'], [])
        self.assertEqual(r['frase'], 'CD: Mantém conduta')   # sem roteiro, a conduta sai do texto corrido
        self.assertEqual(resumir_evolucao(None)['conduta'], [])
        self.assertEqual(secoes(''), {})


if __name__ == '__main__':
    unittest.main()
