// Botões do topo: alternar modo claro/escuro (guardado neste aparelho, em todas as abas)
// e imprimir / salvar em PDF a aba aberta, sempre em fundo claro para economizar tinta.
const CHAVE = 'rt-upa-tema';
const COR_BARRA = {dark: '#070b12', light: '#f4f6fb'};
// Ícones das abas (traço simples, herdam a cor do texto).
const ICONES = {
 overview: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>',
 internados: '<path d="M3 18v-7M3 14h18v4M21 18v-4a3 3 0 0 0-3-3h-7v3"/><circle cx="7" cy="11" r="2"/>',
 flow: '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
 production: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
 schedule: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
 roster: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M17 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
 lotacao: '<path d="M3 21V8l9-5 9 5v13M9 21v-6h6v6M3 21h18"/>',
 documentos: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
 tasks: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>',
 notes: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
 assistant: '<path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>',
};
export function decorarAbas() {
 for (const b of document.querySelectorAll('.workspace-nav [data-view]')) {
  if (b.querySelector('svg') || !ICONES[b.dataset.view]) continue;
  b.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONES[b.dataset.view]}</svg>`);
 }
}

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

// Marca do RT: cruz médica com o batimento cardíaco se desenhando por dentro (CSS em visual.css).
export const MARCA = '<svg class="marca-svg" viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="marca-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f6bff"/><stop offset=".55" stop-color="#3d8bff"/><stop offset="1" stop-color="#13b5b1"/></linearGradient></defs><rect x="2" y="2" width="44" height="44" rx="14" fill="url(#marca-grad)"/><path class="marca-cruz" d="M19.5 10.5h9v9h9v9h-9v9h-9v-9h-9v-9h9z"/><path class="marca-ecg" pathLength="100" d="M5 26.5h10l2.6-5.5 4 11 4.2-15 3.4 9.5H43"/><circle class="marca-ponto" cx="43" cy="26.5" r="1.8"/></svg>';

export function mountTopo() {
 decorarAbas();
 const titulo = document.querySelector('body > header h1');
 if (titulo && !titulo.querySelector('.marca')) { titulo.insertAdjacentHTML('afterbegin', `<span class="marca">${MARCA}</span>`); titulo.closest('header').classList.add('com-marca'); }
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
