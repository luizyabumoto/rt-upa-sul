import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as E

from export_excel import Q, export_cinderela, slot_bounds, hours_label, fortnight_of


def celulas(caminho):
    with ZipFile(caminho) as z:
        arvore = E.fromstring(z.read('xl/worksheets/sheet1.xml'))
        compartilhados = [''.join(si.itertext()) for si in E.fromstring(z.read('xl/sharedStrings.xml'))]
    texto = lambda c: compartilhados[int(c.find(Q('v')).text)] if c.get('t') == 's' else ''.join(c.itertext())
    return {c.get('r'): texto(c) for c in arvore.iter(Q('c'))}, arvore


class CinderelaQuinzenalTests(unittest.TestCase):
    def test_horarios_mudam_em_outubro(self):
        self.assertEqual((slot_bounds(14, '2026-09-30'), slot_bounds(15, '2026-09-30')), ((12, 18), (18, 24)))
        self.assertEqual((slot_bounds(14, '2026-10-01'), slot_bounds(15, '2026-10-01')), ((11, 17), (12, 18)))
        self.assertEqual((hours_label(14, '2026-10-01'), hours_label(15, '2026-10-01')), ('11h às 17h', '12h às 18h'))
        self.assertEqual(hours_label(15, '2026-09-30'), '18h às 00h')

    def test_quinzena_de_outubro_com_cabecalho_da_upa_sul_e_blocos_semanais(self):
        self.assertEqual(fortnight_of('2026-10-20')[:3], (2026, 10, 2))
        with tempfile.TemporaryDirectory() as pasta:
            saida = Path(pasta) / 'c.xlsx'
            info = export_cinderela('2026-10-05', {}, saida)
            self.assertEqual(info, {'ano': 2026, 'mes': 10, 'quinzena': 1, 'semanas': 3})
            c, arvore = celulas(saida)
        self.assertIn('YABUMOTO', c['D1'])
        self.assertIn('UPA  SUL', c['D2'])
        self.assertEqual(c['A2'], 'COMPETÊNCIA: 1 a 15 de Outubro de 2026')
        # 01/10/2026 é quinta: o 1º bloco começa na coluna F (quinta) com o dia 1.
        self.assertEqual([c['C3'], c['F4'], c['I4']], ['SEGUNDA', '1', '4'])
        self.assertEqual([c['B5'], c['B6']], ['11h às 17h', '12h às 18h'])
        self.assertEqual(c['H5'], 'X')                           # sábado sem cinderela
        self.assertTrue(c['F5'] and c['F5'] != 'VAGO')           # padrão semanal fixo preenche o dia
        self.assertEqual([c['C12'], c['F12']], ['12', '15'])     # último bloco termina no dia 15
        self.assertEqual(c.get('G13', ''), '')                  # 16/10 já é da outra quinzena
        # Sem visitas (ficam na escala de 12 horas): o aviso de trocas vem logo depois do último bloco.
        self.assertIn('ESCALA SUJEITA', c['A15'])
        self.assertNotIn('VISITA', ' '.join(c.values()))
        merges = [m.get('ref') for m in arvore.find(Q('mergeCells'))]
        self.assertIn('A15:I15', merges)

    def test_carga_horaria_atual_mesmo_em_quinzena_anterior(self):
        with tempfile.TemporaryDirectory() as pasta:
            saida = Path(pasta) / 'c.xlsx'
            export_cinderela('2026-09-29', {}, saida)
            c, _ = celulas(saida)
        self.assertEqual({c[k] for k in c if k.startswith('B') and 'às' in c[k]}, {'11h às 17h', '12h às 18h'})

    def test_medico_de_ferias_fica_fora_do_preenchimento_automatico(self):
        from export_excel import planned_doctor
        ferias = {'organizer': [{'kind': 'task', 'type': 'Férias', 'doctor': 'JULIANE ZANINA\nCRM 15902 - COAPH', 'date': '2026-10-16', 'endDate': '2026-10-31'}]}
        sem = [d for d in ('2026-10-17', '2026-10-20') for s in range(14) if 'JULIANE' in planned_doctor(d, s, {})]
        self.assertTrue(sem)                                     # sem férias ela aparece
        self.assertFalse([d for d in ('2026-10-17', '2026-10-20') for s in range(14) if 'JULIANE' in planned_doctor(d, s, ferias)])

    def test_nomes_dos_arquivos(self):
        from export_excel import nome_arquivo, content_disposition
        self.assertEqual(nome_arquivo('regular', 2026, 10, 1), 'ESCALA MÉDICA 1 QUINZENA DE OUTUBRO DE 2026- UPA SUL.xlsx')
        self.assertEqual(nome_arquivo('cinderela', 2026, 10, 2), 'CINDERELAS 2 QUINZENA DE OUTUBRO- UPA SUL.xlsx')
        cabecalho = content_disposition(nome_arquivo('regular', 2026, 3, 1))
        cabecalho.encode('latin-1')                               # cabeçalho HTTP válido
        self.assertIn("filename*=UTF-8''ESCALA%20M%C3%89DICA%201%20QUINZENA%20DE%20MAR%C3%87O", cabecalho)

    def test_quinzena_que_toca_quatro_semanas(self):
        # 16/08/2026 é domingo: 16 | 17-23 | 24-30 | 31.
        with tempfile.TemporaryDirectory() as pasta:
            info = export_cinderela('2026-08-20', {}, Path(pasta) / 'c.xlsx')
        self.assertEqual(info['semanas'], 4)


if __name__ == '__main__':
    unittest.main()
