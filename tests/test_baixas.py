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


class ClienteFalso:
    """Imita o Gestor: guarda as chamadas feitas, nada sai do computador."""
    token = 'x.eyJ1c2VybmFtZSI6IkxVSVogVEVTVEUifQ.y'   # {"username": "LUIZ TESTE"}

    def __init__(self, fila, atual):
        self.fila, self.atual, self.chamadas = fila, atual, []

    @staticmethod
    def _claims(token):
        return {'username': 'LUIZ TESTE', 'profissionalId': '3351'}

    def _com_token(self, acao):
        return acao()

    def _chamar(self, caminho, corpo=None, token=None, metodo='POST'):
        self.chamadas.append((metodo, caminho, corpo))
        if 'Pagination' in caminho:
            return {'items': self.fila, 'recordCount': len(self.fila)}
        if 'FindAtendimentoEncaminhamento' in caminho:
            return self.atual
        return None


ITEM = {'pacienteAtendimentoId': 12180479, 'pacienteNome': 'ANA TESTE', 'atendimentoTipo': 'RETORNO ADULTO', 'atendimentoTipoId': 248,
        'descricaoSituacao': 'AGUARDANDO', 'tempo': '3 dias 01:00'}
ATUAL = {'pacienteAtendimentoId': 12180479, 'cidId': 3779, 'cidFilter': 'M545 - DOR LOMBAR BAIXA', 'motivoEncerramentoId': 3}


class EncerrarTest(unittest.TestCase):
    def painel(self, fila, atual=ATUAL):
        from baixas import PainelBaixas
        c = ClienteFalso(fila, atual)
        return PainelBaixas(cliente=c), c

    def test_conferir_nao_altera_nada(self):
        p, c = self.painel([ITEM])
        r = p.encerrar(12180479, simular=True)
        self.assertTrue(r['ok'] and r['simulado'])
        self.assertFalse([x for x in c.chamadas if 'Funcao' in x[1] or x[1] == 'api/AtendimentoEncaminhamento'])

    def test_encerra_igual_a_tela_do_gestor(self):
        p, c = self.painel([ITEM])
        r = p.encerrar(12180479, simular=False)
        self.assertTrue(r['ok'])
        caminhos = [x[1] for x in c.chamadas]
        self.assertIn('api/PacienteAtendimento/Funcao/12180479/1/0', caminhos)
        corpo = next(x[2] for x in c.chamadas if x[1] == 'api/AtendimentoEncaminhamento')
        self.assertEqual({k: corpo[k] for k in ('pacienteAtendimentoId', 'encaminhamentoId', 'motivoEncerramentoId', 'cidId', 'atendimentoTipoId')},
                         {'pacienteAtendimentoId': 12180479, 'encaminhamentoId': 194, 'motivoEncerramentoId': 3, 'cidId': 3779, 'atendimentoTipoId': 248})
        self.assertNotIn('Funcao/12180479/4', ' '.join(caminhos))   # não estava preso com ninguém: não libera

    def test_preso_com_outro_profissional_libera_antes(self):
        p, c = self.painel([{**ITEM, 'descricaoSituacao': 'ATENDIMENTO', 'profissionalNome': 'OUTRO MEDICO'}])
        p.encerrar(12180479, simular=False)
        caminhos = [x[1] for x in c.chamadas]
        self.assertTrue(any('Funcao/12180479/4/' in x for x in caminhos))

    def test_sem_cid_registra_z000_antes_como_o_robo(self):
        p, c = self.painel([ITEM], {'pacienteAtendimentoId': 12180479})
        self.assertIn('Z000', p.encerrar(12180479, simular=True)['mensagem'])
        self.assertFalse([x for x in c.chamadas if x[0] == 'POST' and 'Pagination' not in x[1]])   # conferir não altera
        r = p.encerrar(12180479, simular=False)
        self.assertTrue(r['ok'])
        caminhos = [x[1] for x in c.chamadas if x[0] == 'POST' and 'Pagination' not in x[1]]
        self.assertEqual(caminhos, ['api/PacienteAtendimento/Funcao/12180479/1/0', 'api/PacienteAtendimentoDiagnostico', 'api/AtendimentoEncaminhamento'])
        diag = next(x[2] for x in c.chamadas if x[1] == 'api/PacienteAtendimentoDiagnostico')
        self.assertEqual(diag, {'cidId': 4870, 'pacienteAtendimentoId': 12180479, 'profissionalId': 3351, 'tipoDiagnostico': 'SuspeitaDiagnostico'})
        corpo = next(x[2] for x in c.chamadas if x[1] == 'api/AtendimentoEncaminhamento')
        self.assertEqual((corpo['cidId'], corpo['encaminhamentoId'], corpo['motivoEncerramentoId']), (4870, 194, 5))

    def test_cid_na_lista_de_diagnosticos_nao_registra_z000(self):
        p, c = self.painel([ITEM], {'pacienteAtendimentoId': 12180479})
        original = c._chamar
        c._chamar = lambda caminho, corpo=None, token=None, metodo='POST': (
            {'items': [{'cidId': 3779, 'cidFilter': 'M545 - DOR LOMBAR BAIXA'}]} if 'PacienteAtendimentoDiagnostico/Pagination' in caminho
            else original(caminho, corpo, token, metodo))
        p.encerrar(12180479, simular=False)
        caminhos = [x[1] for x in c.chamadas]
        self.assertNotIn('api/PacienteAtendimentoDiagnostico', caminhos)
        corpo = next(x[2] for x in c.chamadas if x[1] == 'api/AtendimentoEncaminhamento')
        self.assertEqual(corpo['cidId'], 3779)

    def test_recusa_o_que_nao_e_retorno_esquecido(self):
        for item in ({**ITEM, 'tempo': '10:00'}, {**ITEM, 'atendimentoTipo': 'CONSULTORIO ADULTO'}):
            p, c = self.painel([item])
            self.assertFalse(p.encerrar(12180479, simular=False)['ok'])
            self.assertFalse([x for x in c.chamadas if x[0] == 'POST' and 'Pagination' not in x[1]])
        p, c = self.painel([])
        self.assertFalse(p.encerrar(12180479, simular=False)['ok'])


if __name__ == '__main__':
    unittest.main()
