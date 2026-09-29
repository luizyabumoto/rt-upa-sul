// Proteção contra perda de dados: guarda no navegador retratos periódicos de tudo (escala, fixos,
// coberturas, pendências, trocas...) e permite restaurar uma versão anterior. É um paraquedas local,
// independente do salvamento online — sobrevive a um save que falhe ou a uma alteração errada.
const CHAVE = 'rt-versoes';
const MAX = 25;

const lerVersoes = () => { try { return JSON.parse(localStorage.getItem(CHAVE)) || []; } catch { return []; } };

function retrato(storage) {
 const itens = {};
 for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k && k.startsWith('rt-upa:')) itens[k] = storage.getItem(k); }
 return itens;
}

export function salvarVersao(storage, agora = new Date()) {
 const texto = JSON.stringify(retrato(storage));
 if (texto === '{}') return;
 const lista = lerVersoes();
 if (lista[0] && lista[0].s === texto) return;                 // nada mudou desde a última
 lista.unshift({t: agora.toISOString(), s: texto});
 while (lista.length > MAX) lista.pop();
 try { localStorage.setItem(CHAVE, JSON.stringify(lista)); }
 catch { lista.splice(Math.ceil(MAX / 2)); try { localStorage.setItem(CHAVE, JSON.stringify(lista)); } catch { /* sem espaço */ } }
}

export function restaurarVersao(storage, texto) {
 const itens = JSON.parse(texto);
 const atuais = [];
 for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k && k.startsWith('rt-upa:')) atuais.push(k); }
 for (const k of atuais) if (!(k in itens)) storage.removeItem(k);
 for (const [k, v] of Object.entries(itens)) storage.setItem(k, v);
}

const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };

export function mountVersoes(storage) {
 // Retrato ao abrir e, depois, 1 minuto após cada alteração (sem exagerar na gravação).
 let timer;
 const agendar = () => { clearTimeout(timer); timer = setTimeout(() => salvarVersao(storage), 60000); };
 document.addEventListener('rt-schedule-changed', agendar);
 document.addEventListener('rt-data-restored', agendar);
 setTimeout(() => salvarVersao(storage), 3000);

 const menu = document.querySelector('.backup-options');
 if (!menu) return;
 const bloco = el('div');
 const botao = el('button', 'secondary'); botao.type = 'button'; botao.id = 'versoes'; botao.textContent = 'Restaurar versão anterior';
 bloco.append(botao, Object.assign(el('small'), {textContent: 'Retratos automáticos guardados neste navegador. Use se algo se perdeu ou foi alterado por engano.'}));
 menu.append(bloco);

 const dialog = el('dialog', 'review-dialog'); document.body.append(dialog);
 botao.onclick = () => {
  const menuDetails = document.querySelector('.backup-menu'); if (menuDetails) menuDetails.open = false;
  const versoes = lerVersoes();
  dialog.replaceChildren();
  const form = el('form'); form.method = 'dialog';
  form.append(el('h2', '', 'Versões anteriores'));
  if (!versoes.length) form.append(el('p', 'notice', 'Ainda não há versões guardadas. Elas começam a ser criadas conforme você usa o site.'));
  const lista = el('div', 'versoes-lista');
  versoes.forEach((v, i) => {
   const linha = el('div', 'versao'); let contagem = 0;
   try { const it = JSON.parse(v.s); contagem = Object.keys(it).length; } catch { /* ignora */ }
   const quando = new Date(v.t).toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'});
   linha.append(el('span', '', `${quando}${i === 0 ? ' · mais recente' : ''} · ${contagem} registros`));
   const btn = el('button', 'secondary'); btn.type = 'button'; btn.textContent = 'Restaurar esta';
   btn.onclick = () => {
    if (!confirm(`Restaurar a versão de ${quando}? O estado atual é substituído pelo dessa data. (Um retrato do estado de agora é guardado antes, então dá para voltar.)`)) return;
    salvarVersao(storage);                       // guarda o estado atual antes de sobrescrever
    restaurarVersao(storage, v.s);
    document.dispatchEvent(new Event('rt-data-restored'));
    dialog.close();
   };
   linha.append(btn); lista.append(linha);
  });
  const acoes = el('div', 'actions'); const fechar = el('button', ''); fechar.textContent = 'Fechar'; acoes.append(fechar);
  form.append(lista, acoes); dialog.append(form); dialog.showModal();
 };
}
