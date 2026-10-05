"""Gera src/light-auto.css: versão clara das cores fixas de dark.css e theme.css.

dark.css/theme.css nasceram para o fundo escuro e têm muitas cores escritas direto (#90a7b8, rgba(7,11,18,.45)…).
No modo claro elas viravam cinza sobre cinza. Este script lê cada regra e, só para <html data-theme="light">,
troca: texto claro → texto escuro (ou a cor de destaque equivalente), fundo escuro → superfície clara,
borda escura → linha clara. Rodar de novo sempre que dark.css ou theme.css mudarem:  py tools/gerar_claro.py
"""
import colorsys
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
FONTES = [RAIZ / 'src' / 'dark.css', RAIZ / 'src' / 'theme.css']
SAIDA = RAIZ / 'src' / 'light-auto.css'
# Ficam de fora: a faixa azul do Painel (texto branco de propósito), impressão e a tela de login.
PULAR = re.compile(r'welcome|painel-hero|eyebrow|login|imprimindo|::-webkit-scrollbar|::selection|^header(?![-\w])|^body|^:root|^html|button|^(input|select|textarea)(?![-\w])|::placeholder')
COR = re.compile(r'#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)')


def rgb(cor):
    """(r, g, b, alfa) de 0 a 1."""
    if cor.startswith('#'):
        h = cor[1:]
        if len(h) in (3, 4):
            h = ''.join(c * 2 for c in h)
        r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
        a = int(h[6:8], 16) / 255 if len(h) == 8 else 1
        return r, g, b, a
    n = [float(x) for x in re.findall(r'[\d.]+', cor)]
    return n[0] / 255, n[1] / 255, n[2] / 255, n[3] if len(n) > 3 else 1


def luz(r, g, b):
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def tom_texto(cor, seletor):
    """Texto claro (feito para fundo escuro) → cor equivalente no tema claro; None se não precisa mudar."""
    r, g, b, a = rgb(cor)
    if luz(r, g, b) < 0.5:
        return None
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    if s < 0.32:   # cinzas, cinza-azulados e brancos
        return 'var(--text)' if re.search(r'strong|h[1-4]\b|valor|value|doctor-name|-num\b', seletor) else 'var(--text-2)'
    graus = h * 360
    if graus < 20 or graus >= 330:
        return 'var(--danger-text)'
    if graus < 65:
        return 'var(--warn-text)'
    if graus < 150:
        return 'var(--ok)'
    return 'var(--accent-text)'


def fundo(cor):
    r, g, b, a = rgb(cor)
    if a < 0.25 or luz(r, g, b) >= 0.3:
        return None
    # Bem escuro = o próprio cartão (branco); escuro médio = algo dentro do cartão (cinza bem claro).
    return 'var(--surface)' if luz(r, g, b) < 0.1 else 'var(--surface-2)'
    return None


def borda(cor):
    r, g, b, a = rgb(cor)
    return 'var(--line-2)' if luz(r, g, b) < 0.35 else None


def converter(seletores, corpo):
    novas = []
    for decl in corpo.split(';'):
        if ':' not in decl:
            continue
        prop, valor = decl.split(':', 1)
        prop, valor = prop.strip().lower(), valor.strip()
        importante = '!important'
        if prop == 'color':
            m = COR.search(valor)
            novo = m and tom_texto(m.group(), seletores)
            if novo:
                novas.append(f'color:{novo}{importante}')
        elif prop in ('background', 'background-color'):
            if 'gradient' in valor or 'url(' in valor:
                continue
            m = COR.search(valor)
            novo = m and fundo(m.group())
            if novo:
                novas.append(f'background:{novo}{importante}')
        elif prop.startswith('border') and 'radius' not in prop and 'width' not in prop and 'style' not in prop:
            def troca(m):
                return borda(m.group()) or m.group()
            novo = COR.sub(troca, valor.replace('!important', '')).strip()
            if novo != valor.replace('!important', '').strip():
                novas.append(f'{prop}:{novo}{importante}')
    return novas


def regras(css):
    """[(contexto @media ou '', seletor, corpo)] — entende um nível de @media."""
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    saida, i = [], 0
    while i < len(css):
        abre = css.find('{', i)
        if abre < 0:
            break
        cab = css[i:abre].strip()
        if cab.startswith('@media') or cab.startswith('@supports'):
            nivel, j = 1, abre + 1
            while nivel and j < len(css):
                nivel += {'{': 1, '}': -1}.get(css[j], 0)
                j += 1
            if 'print' not in cab:
                saida += [(cab, s, c) for _, s, c in regras(css[abre + 1:j - 1])]
            i = j
            continue
        fecha = css.find('}', abre)
        if not cab.startswith('@'):
            saida.append(('', cab, css[abre + 1:fecha]))
        i = fecha + 1
    return saida


def main():
    blocos = {}
    for fonte in FONTES:
        for media, seletor, corpo in regras(fonte.read_text(encoding='utf-8')):
            if ':root' in seletor or 'data-theme' in seletor:
                continue
            partes = [s.strip() for s in seletor.split(',') if s.strip() and not PULAR.search(s)]
            if not partes:
                continue
            decl = converter(' '.join(partes), corpo)
            if decl:
                sel = ','.join(f':root[data-theme="light"] {s}' for s in partes)
                blocos.setdefault(media, []).append(f'{sel}{{{";".join(decl)}}}')
    linhas = ['/* GERADO por tools/gerar_claro.py a partir de dark.css e theme.css — não editar à mão. */']
    for media, lista in blocos.items():
        if media:
            linhas.append(media + '{')
        linhas += lista
        if media:
            linhas.append('}')
    SAIDA.write_text('\n'.join(linhas) + '\n', encoding='utf-8')
    print(f'{sum(len(v) for v in blocos.values())} regras em {SAIDA.name}')


if __name__ == '__main__':
    main()
