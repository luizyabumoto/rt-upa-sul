// Campos de data sempre em dia/mês/ano (e hora em 24 h), qualquer que seja o idioma do navegador.
// O campo nativo continua por baixo (o calendário de escolher e o valor guardado, AAAA-MM-DD, não mudam):
// só o texto que aparece é trocado pelo formato brasileiro.
const FORMATOS = {
 date: v => v.split('-').reverse().join('/'),
 'datetime-local': v => { const [d, t = ''] = v.split('T'); return `${FORMATOS.date(d)} ${t.slice(0, 5)}`; },
 month: v => { const [a, m] = v.split('-'); return `${m}/${a}`; },
};
const VAZIO = {date: 'dd/mm/aaaa', 'datetime-local': 'dd/mm/aaaa --:--', month: 'mm/aaaa'};
const valorNativo = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

export const formatoBR = (tipo, valor) => valor ? FORMATOS[tipo](valor) : '';

function envolver(input) {
 if (input.dataset.br || !FORMATOS[input.type]) return;
 input.dataset.br = '1';
 const caixa = document.createElement('span');
 caixa.className = 'data-br';
 input.before(caixa);
 caixa.append(input);
 const texto = document.createElement('span');
 texto.className = 'data-br-texto';
 texto.setAttribute('aria-hidden', 'true');
 caixa.append(texto);
 const atualizar = () => {
  const v = valorNativo.get.call(input);
  texto.textContent = v ? FORMATOS[input.type](v) : VAZIO[input.type];
  caixa.classList.toggle('vazio', !v);
 };
 // Valor posto pelo próprio site (input.value = …) também atualiza o texto.
 Object.defineProperty(input, 'value', {configurable: true, get() { return valorNativo.get.call(this); }, set(v) { valorNativo.set.call(this, v); atualizar(); }});
 for (const ev of ['input', 'change']) input.addEventListener(ev, atualizar);
 input.form?.addEventListener('reset', () => setTimeout(atualizar));
 // Clicar em qualquer parte do campo abre o calendário.
 input.addEventListener('click', () => { try { input.showPicker(); } catch {} });
 atualizar();
}

export function mountDatasBR(raiz = document.body) {
 const tratar = no => {
  if (!(no instanceof Element)) return;
  if (no.matches('input')) envolver(no);
  for (const i of no.querySelectorAll('input[type="date"],input[type="datetime-local"],input[type="month"]')) envolver(i);
 };
 tratar(raiz);
 new MutationObserver(mudancas => { for (const m of mudancas) for (const n of m.addedNodes) tratar(n); }).observe(raiz, {childList: true, subtree: true});
}
