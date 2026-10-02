// Botões do topo: alternar modo claro/escuro (guardado neste aparelho, em todas as abas)
// e imprimir / salvar em PDF a aba aberta, sempre em fundo claro para economizar tinta.
const CHAVE = 'rt-upa-tema';
const COR_BARRA = {dark: '#070b12', light: '#f4f6f9'};

export const temaAtual = () => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';

export function aplicarTema(tema, guardar = true) {
 document.documentElement.dataset.theme = tema;
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COR_BARRA[tema]);
 if (guardar) try { localStorage.setItem(CHAVE, tema); } catch {}
 document.dispatchEvent(new CustomEvent('rt-tema', {detail: tema}));
}

// Imprime o que está na tela (a aba aberta), sem o topo e as abas, sempre no tema claro.
export function imprimirPagina() {
 const antes = temaAtual(), tituloAntes = document.title;
 const aba = document.querySelector('.workspace-nav [aria-current="page"]')?.textContent?.trim() || 'Página';
 document.title = `RT UPA Sul - ${aba} - ${new Date().toLocaleDateString('pt-BR').replaceAll('/', '-')}`;
 aplicarTema('light', false);
 document.body.classList.add('imprimindo-pagina');
 let feito = false;
 const fim = () => { if (feito) return; feito = true; document.body.classList.remove('imprimindo-pagina'); aplicarTema(antes, false); document.title = tituloAntes; };
 window.addEventListener('afterprint', fim, {once: true});
 window.print();
 setTimeout(fim, 1500);
}

export function mountTopo() {
 const header = document.querySelector('body > header');
 if (!header || header.querySelector('.topo-acoes')) return;
 const caixa = document.createElement('div');
 caixa.className = 'topo-acoes';
 const imprimir = document.createElement('button');
 imprimir.type = 'button'; imprimir.className = 'topo-botao';
 imprimir.title = 'Imprimir ou salvar em PDF a aba aberta';
 imprimir.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9V3h10v6M7 18H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 14h10v7H7z"/></svg><span>Imprimir / PDF</span>';
 imprimir.onclick = imprimirPagina;
 const tema = document.createElement('button');
 tema.type = 'button'; tema.className = 'topo-botao topo-tema';
 const atualizar = () => {
  const claro = temaAtual() === 'light';
  tema.setAttribute('aria-pressed', String(claro));
  tema.title = claro ? 'Mudar para o modo escuro' : 'Mudar para o modo claro';
  tema.innerHTML = claro
   ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg><span>Modo escuro</span>'
   : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><span>Modo claro</span>';
 };
 tema.onclick = () => { aplicarTema(temaAtual() === 'light' ? 'dark' : 'light'); atualizar(); };
 atualizar();
 caixa.append(imprimir, tema);
 const selo = header.querySelector('.badge');
 if (selo) caixa.append(selo);
 header.append(caixa);
 // A cor da barra do celular acompanha o tema já aplicado por tema.js.
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COR_BARRA[temaAtual()]);
}
