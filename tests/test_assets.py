"""Todo módulo importado pelo app precisa estar na lista de arquivos que o servidor online entrega."""
import re
import unittest
from pathlib import Path

import online

ROOT = Path(__file__).resolve().parent.parent


class AssetsTest(unittest.TestCase):
    def test_modulos_importados_estao_liberados(self):
        faltando, vistos, fila = [], set(), ['/src/app.js']
        while fila:
            caminho = fila.pop()
            if caminho in vistos:
                continue
            vistos.add(caminho)
            if caminho not in online.ASSETS:
                faltando.append(caminho)
            texto = (ROOT / caminho.lstrip('/')).read_text(encoding='utf-8')
            for alvo in re.findall(r"""from\s+['"]\./([\w-]+\.js)['"]""", texto):
                fila.append(f'/src/{alvo}')
        self.assertEqual(faltando, [])


if __name__ == '__main__':
    unittest.main()


class RegistrosAceitosTest(unittest.TestCase):
    """Todo registro que o app grava precisa ser aceito ao salvar online (senão nenhum salvamento passa)."""
    def test_registros_do_app_sao_aceitos(self):
        chaves = set()
        for arquivo in (ROOT / 'src').glob('*.js'):
            texto = arquivo.read_text(encoding='utf-8')
            chaves |= set(re.findall(r"""['"`]rt-upa:([a-zA-Z]+)['"`]""", texto))
            chaves |= set(re.findall(r"""(?:put|parse\(storage,\s*)\(?'([a-zA-Z:]+)'""", texto))
        chaves -= {'edits'}
        self.assertIn('atencao', chaves)
        for chave in sorted(chaves):
            with self.subTest(chave=chave):
                try:
                    online.validate_items({f'rt-upa:{chave}': 'null'})
                except online.ApiError as erro:
                    self.assertNotEqual(erro.message, 'Registro desconhecido no backup.')

    def test_acompanhamento_de_medicos_valido(self):
        valor = '{"CAIO MENDES":{"nome":"CAIO MENDES","emAtencao":true,"desde":"2026-09-30","conversas":["2026-09-30"],"saiuEm":null}}'
        online.validate_items({'rt-upa:atencao': valor})
        with self.assertRaises(online.ApiError):
            online.validate_items({'rt-upa:atencao': '{"X":{"nome":"X","conversas":["ontem"]}}'})
