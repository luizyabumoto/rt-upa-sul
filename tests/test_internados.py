"""Aba Internados: leitura do censo (sem dados de identificação), CID, evolução médica e equipe do plantão."""
import json
import unittest
from datetime import datetime, timedelta

import censo
import internacao

CUIABA = censo.CUIABA
CSV = '\n'.join([
    ',,,,,,,,,,,,',
    'PACIENTES INTERNADOS NA UNIDADE,,,,,,,,,,,,',
    'ENFERMARIA MASCULINA,,,,,,,,,,,,',
    'Nº,NOME PACIENTE,ID,DN,CNS,CPF,DI,HIPÓTESE DIAGNÓSTICA,SISREG,ESPECIALIDADE,DIAS INT.,INDICASUS,DATA/HORA/LOCAL TRANSFERÊNCIA/ OBSERVAÇÕES',
    'M1,FULANO DE TAL,68A,01/01/1958,700000000000001,111.222.333-44,01/10/2026,NEFRITE CRÔNICA - N119,123456789,CLINICA GERAL,4,,',
    'M2,,,,,,,,,,,,',
    'ENFERMARIA FEMININA,,,,,,,,,,,,',
    'Nº,NOME PACIENTE,ID,DN,CNS,CPF,DI,HIPÓTESE DIAGNÓSTICA,SISREG,ESPECIALIDADE,DIAS INT.,INDICASUS,DATA/HORA/LOCAL TRANSFERÊNCIA/ OBSERVAÇÕES',
    'F1,BELTRANA SILVA,59A,02/02/1967,700000000000002,555.666.777-88,23/09/2026,FLEBITE E TROMBOFLEBITE,987654321,CIRURGIA GERAL,12,,HEMODIALISE TER-QUI',
    'BOX DE EMERGÊNCIA,,,,,,,,,,,,',
    'Nº,NOME PACIENTE,ID,DN,CNS,CPF,DI,HIPÓTESE DIAGNÓSTICA,SISREG,ESPECIALIDADE,DIAS INT.,INDICASUS,DATA/HORA/LOCAL TRANSFERÊNCIA/ OBSERVAÇÕES',
    'BX1,CICLANO,42A,,,,04/10/2026,AVC,555555555,UTI ADULTO,1,,18:27 CONT CRUE',
    'BX2,,17A,,,,,OBSERVAÇÃO,,OBSERVAÇÃO,,,',
    'BX3,,,,,,,,,,,,',
    'ALTA HOSPITALAR,,,,,,,,,,,,',
    'Nº,NOME PACIENTE,ID,DN,CNS,CPF,DI,HIPÓTESE DIAGNÓSTICA',
    '1,ALGUEM QUE TEVE ALTA,30A,,,,01/10/2026,DOR',
])
AGORA = datetime(2026, 10, 5, 16, 0, tzinfo=CUIABA)


class CensoTest(unittest.TestCase):
    def setUp(self):
        self.dados = censo.resumir(censo.ler_csv(CSV), AGORA)

    def test_tela_recebe_so_o_primeiro_nome(self):
        # O que vai para o navegador (internados): primeiro nome sim; sobrenome, CPF, CNS, nascimento e SISREG nunca.
        class Fixo:
            def __init__(self, dados): self.dados = dados
            def obter(self): return {'disponivel': True, 'erro': None, 'lidoEm': None, **self.dados}
        texto = json.dumps(internacao.internados(Fixo(self.dados), agora=AGORA), ensure_ascii=False)
        for proibido in ('DE TAL', 'SILVA', '111.222.333-44', '700000000000001', '1958', '123456789', 'ALGUEM', '_nome'):
            self.assertNotIn(proibido, texto)
        nomes = {p['leito']: p['primeiroNome'] for p in json.loads(texto)['pacientes']}
        self.assertEqual(nomes['M1'], 'Fulano')
        self.assertEqual(nomes['BX2'], '')   # leito sem nome na planilha

    def test_leitos_e_ocupacao(self):
        r = self.dados['resumo']
        self.assertEqual(r['internados'], 4)
        self.assertEqual(r['enfermaria']['ocupados'], 2)
        self.assertEqual(r['box'], {'ocupados': 2, 'capacidade': 6, 'bloqueados': 0, 'livres': 4, 'excedente': 0})
        leitos = {l['leito']: l['ocupado'] for l in self.dados['leitos']}
        self.assertEqual(leitos, {'M1': True, 'M2': False, 'F1': True, 'BX1': True, 'BX2': True, 'BX3': False})

    def test_cid_tempo_e_espera(self):
        p = {x['leito']: x for x in self.dados['pacientes']}
        self.assertEqual(p['M1']['cid'], 'N11.9')
        self.assertFalse(p['M1']['cidProvavel'])
        self.assertEqual(p['F1']['cid'], 'I80')          # deduzido do texto
        self.assertTrue(p['F1']['cidProvavel'])
        self.assertEqual(p['F1']['dias'], 12)
        self.assertEqual(p['BX1']['uti'], 'UTI adulto')
        self.assertEqual(p['M1']['idade'], 68)
        r = self.dados['resumo']
        self.assertEqual(r['aguardandoUti'], 1)
        self.assertEqual(r['aguardandoLeito'], 3)        # BX2 só em observação não conta
        self.assertEqual(r['maiorDias'], 12)


class EvolucaoTest(unittest.TestCase):
    def test_casa_evolucao_pela_idade_e_marca_pendentes(self):
        pacientes = censo.resumir(censo.ler_csv(CSV), AGORA)['pacientes']
        nasc = lambda anos: (AGORA.date().replace(year=AGORA.year - anos) - timedelta(days=40)).isoformat()
        evolucoes = [
            {'setor': 'enfermaria', 'nascimento': nasc(68), 'momento': (AGORA - timedelta(hours=5)).isoformat(), 'medico': 'VISITADOR UM'},
            {'setor': 'enfermaria', 'nascimento': nasc(59), 'momento': (AGORA - timedelta(hours=30)).isoformat(), 'medico': 'VISITADOR DOIS'},
            {'setor': 'box', 'nascimento': nasc(42), 'momento': (AGORA - timedelta(hours=2)).isoformat(), 'medico': 'MEDICO BOX'},
        ]
        r = {p['leito']: p for p in internacao.cruzar_evolucoes(pacientes, evolucoes, AGORA)}
        self.assertEqual(r['M1']['evolucao'], 'em-dia')        # visitado hoje às 11h
        self.assertEqual(r['F1']['evolucao'], 'pendente')      # última evolução foi ontem
        self.assertEqual(r['BX1']['evolucao'], 'em-dia')       # Box evoluído há 2 h
        self.assertEqual(r['BX2']['evolucao'], 'pendente')
        self.assertEqual(r['M1']['medicoEvolucao'], 'VISITADOR UM')
        v = internacao.resumir_visitas(list(r.values()))
        self.assertEqual(v['enfermaria'], {'total': 2, 'emDia': 1, 'pendentes': 1, 'semIdade': 0})
        self.assertEqual(v['box']['pendentes'], 1)

    def test_idade_do_relatorio(self):
        self.assertEqual(internacao.nascimento_aprox('76 ano(s) 4 mese(s) 10 dia(s)', AGORA.date()).isoformat(), '1950-05-26')
        self.assertIsNone(internacao.nascimento_aprox('', AGORA.date()))


class EquipeTest(unittest.TestCase):
    def test_area_ativo_cinderela_e_box(self):
        h = lambda hh, mm=0: datetime(2026, 10, 5, hh, mm, tzinfo=CUIABA)
        linhas = {
            'adulto': [('DR CLINICO', h(7, 20)), ('DR CLINICO', h(15, 40)), ('DRA CINDERELA', h(12, 10)), ('DRA CINDERELA', h(15, 50))] + [('DRA CINDERELA', h(13, i)) for i in range(4)],
            'pediatria': [('DRA PEDIATRA', h(8)), ('DRA PEDIATRA', h(14))],
            'box': [('DR BOX', h(9)), ('DR BOX', h(13))],
        }
        eq = {m['medico']: m for m in internacao.resumir_equipe(linhas, h(16), anterior={'DR CLINICO'})}
        self.assertEqual(eq['DR CLINICO']['area'], 'adulto')
        self.assertTrue(eq['DR CLINICO']['ativo'])
        self.assertFalse(eq['DR CLINICO']['restoAnterior'])   # atendeu muito depois das 07h45
        self.assertTrue(eq['DRA CINDERELA']['cinderela'])
        self.assertEqual(eq['DRA PEDIATRA']['area'], 'pediatria')
        self.assertFalse(eq['DRA PEDIATRA']['ativo'])          # parada desde as 14h
        self.assertEqual(eq['DR BOX']['area'], 'box')


if __name__ == '__main__':
    unittest.main()
