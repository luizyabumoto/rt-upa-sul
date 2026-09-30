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
