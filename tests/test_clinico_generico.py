import unittest
from export_excel import planned_doctor


class ClinicoGenericoTests(unittest.TestCase):
    """Espelha tests/clinico-generico.test.js — mesma lógica em Python (usada na exportação
    do Excel), pra garantir que o arquivo baixado bate com o que aparece na tela."""

    DATE = '2027-03-05'  # sexta-feira dentro do padrão vigente: slot7=Tiago, slot9=Francisco (fixos), 8 e 10 vagos
    WEEKDAY = 5

    def test_preenche_so_vagas_em_ordem_alfabetica(self):
        backup = {'clinicoRoster': [
            dict(id='g1', start='2026-12-01', weekday=self.WEEKDAY, turn='noite', doctor='ZECA SILVA\nCRM 111 - SMS', active=True),
            dict(id='g2', start='2026-12-01', weekday=self.WEEKDAY, turn='noite', doctor='ANA PEREIRA\nCRM 222 - SMS', active=True),
        ]}
        result = {slot: planned_doctor(self.DATE, slot, backup) for slot in (7, 8, 9, 10)}
        self.assertIn('TIAGO', result[7])
        self.assertIn('ANA PEREIRA', result[8])
        self.assertIn('FRANCISCO', result[9])
        self.assertIn('ZECA SILVA', result[10])

    def test_mais_genericos_que_vagas_deixa_o_resto_de_fora(self):
        backup = {'clinicoRoster': [
            dict(id='g1', start='2026-12-01', weekday=self.WEEKDAY, turn='noite', doctor='ZECA SILVA\nCRM 111 - SMS', active=True),
            dict(id='g2', start='2026-12-01', weekday=self.WEEKDAY, turn='noite', doctor='ANA PEREIRA\nCRM 222 - SMS', active=True),
            dict(id='g3', start='2026-12-01', weekday=self.WEEKDAY, turn='noite', doctor='BRUNO EXTRA\nCRM 444 - SMS', active=True),
        ]}
        result = {slot: planned_doctor(self.DATE, slot, backup) for slot in (7, 8, 9, 10)}
        self.assertIn('ANA PEREIRA', result[8])
        self.assertIn('BRUNO EXTRA', result[10])
        self.assertFalse(any('ZECA' in v for v in result.values()))

    def test_encerrar_tira_do_pool_a_partir_da_data(self):
        backup = {'clinicoRoster': [
            dict(id='g1', start='2026-12-01', weekday=self.WEEKDAY, turn='noite', doctor='ZECA SILVA\nCRM 111 - SMS', active=True),
            dict(id='g2', start='2026-12-01', weekday=self.WEEKDAY, turn='noite', doctor='ANA PEREIRA\nCRM 222 - SMS', active=True),
            dict(id='g3', start='2027-02-01', weekday=self.WEEKDAY, turn='noite', doctor='ANA PEREIRA\nCRM 222 - SMS', active=False),
        ]}
        self.assertIn('ANA PEREIRA', planned_doctor('2027-01-08', 8, backup))
        self.assertIn('ZECA SILVA', planned_doctor(self.DATE, 8, backup))

    def test_escala_importada_nunca_e_sobrescrita_por_generico(self):
        backup = {'clinicoRoster': [
            dict(id='g1', start='2026-01-01', weekday=0, turn='dia', doctor='NOVO GENERICO\nCRM 999 - SMS', active=True),
        ]}
        # 27/09/2026: dado real importado — slot0=GUSTAVO, slot2=THIAGO PAES CONERA, slot3 vaga de verdade.
        self.assertIn('GUSTAVO', planned_doctor('2026-09-27', 0, backup))
        self.assertIn('THIAGO PAES CONERA', planned_doctor('2026-09-27', 2, backup))
        self.assertIn('NOVO GENERICO', planned_doctor('2026-09-27', 3, backup))


if __name__ == '__main__':
    unittest.main()
