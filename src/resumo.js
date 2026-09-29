// Capa do Painel: resumo do dia com o que o RT mais consulta — consultas do plantão atual,
// vagas na escala dos próximos dias e trocas detectadas — cada um levando à aba correspondente.
import {plantaoAtual} from './production.js';
import {vagasProximas} from './escala-alertas.js';
import {parse} from './scheduling.js';

const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
const hojeCuiaba = () => new Date(Date.now() - 4 * 3600000).toISOString().slice(0, 10);

export function mountResumo(storage, seed) {
 const overview = document.querySelector('#overview-panel');
 if (!overview) return;
 const strip = el('div', 'resumo-dia');
 overview.prepend(strip);

 function tile(rotulo, valor, detalhe, aba) {
  const box = el(aba ? 'button' : 'div', 'resumo-tile');
  if (aba) { box.type = 'button'; box.onclick = () => document.querySelector(`[data-view="${aba}"]`)?.click(); }
  box.append(el('span', 'resumo-label', rotulo), el('strong', 'resumo-valor', String(valor)), el('small', '', detalhe || ''));
  return box;
 }

 async function render() {
  const p = plantaoAtual();
  const vagas = vagasProximas(seed, storage, hojeCuiaba()).length;
  const trocas = parse(storage, 'trocas', []).filter(t => t.status === 'aplicada').length;
  let consultas = '—', detalheProd = 'Gestor Saúde indisponível';
  try {
   const r = await fetch(`/api/producao?inicio=${encodeURIComponent(p.inicio)}&fim=agora`, {cache: 'no-store'});
   const d = await r.json();
   if (r.ok && d.disponivel) { consultas = (d.registros || []).reduce((s, x) => s + x.adulto + x.pediatria, 0); detalheProd = `${p.turno === 'D' ? 'diurno' : 'noturno'} · desde ${p.inicio.slice(11)}`; }
  } catch { /* mantém traço */ }
  strip.replaceChildren(
   tile('CONSULTAS NO PLANTÃO', consultas, detalheProd, 'production'),
   tile('VAGAS NA ESCALA', vagas, vagas ? 'clique para ver' : 'nenhuma nos próximos dias', 'schedule'),
   tile('TROCAS DETECTADAS', trocas, trocas ? 'confira no painel' : 'nenhuma pendente'));
 }

 for (const evento of ['rt-schedule-changed', 'rt-data-restored']) document.addEventListener(evento, render);
 document.querySelector('[data-view="overview"]')?.addEventListener('click', render);
 render();
 // Atualiza o número de consultas do plantão a cada 3 min enquanto o Painel está aberto.
 setInterval(() => { if (!document.hidden && !overview.hidden) render(); }, 180000);
}
