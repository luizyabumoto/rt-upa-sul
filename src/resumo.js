// Capa do Painel: números do dia que o RT mais consulta — consultas do plantão atual, vagas na escala,
// trocas detectadas e pendências — cada um levando à aba correspondente.
import {plantaoAtual} from './production.js';
import {vagasProximas} from './escala-alertas.js';
import {parse} from './scheduling.js';
import {urgency} from './organizer.js';

const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
const hojeCuiaba = () => new Date(Date.now() - 4 * 3600000).toISOString().slice(0, 10);

// Leitura da produção compartilhada pelo Painel: o mesmo período pedido em menos de 1 min usa a mesma resposta.
const leituras = new Map();
export function lerProducao(inicio, fim = 'agora') {
 const chave = `${inicio}|${fim}`, guardada = leituras.get(chave);
 if (guardada && Date.now() - guardada.em < 60000) return guardada.promessa;
 const promessa = fetch(`/api/producao?inicio=${encodeURIComponent(inicio)}&fim=${encodeURIComponent(fim)}`, {cache: 'no-store'})
  .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'O servidor não respondeu.'); return d; });
 promessa.catch(() => leituras.delete(chave));
 if (leituras.size > 20) leituras.clear();
 leituras.set(chave, {em: Date.now(), promessa});
 return promessa;
}

export function mountResumo(storage, seed) {
 const overview = document.querySelector('#overview-panel');
 if (!overview) return;
 const strip = el('div', 'resumo-dia');
 const slot = overview.querySelector('[data-slot="resumo"]');
 if (slot) slot.append(strip); else overview.prepend(strip);

 function tile(rotulo, valor, detalhe, aba, tom = '') {
  const box = el(aba ? 'button' : 'div', `resumo-tile ${tom}`);
  if (aba) { box.type = 'button'; box.onclick = () => document.querySelector(`[data-view="${aba}"]`)?.click(); }
  box.append(el('span', 'resumo-label', rotulo), el('strong', 'resumo-valor', String(valor)), el('small', '', detalhe || ''));
  return box;
 }

 let consultas = '—', detalheProd = 'lendo o Gestor Saúde…';
 function desenhar() {
  const vagas = vagasProximas(seed, storage, hojeCuiaba()).length;
  const trocas = parse(storage, 'trocas', []).filter(t => t.status === 'aplicada').length;
  const abertas = parse(storage, 'organizer', []).filter(x => x.kind === 'task' && x.status !== 'Resolvido');
  const atrasadas = abertas.filter(x => urgency(x) === 'Atrasado').length, deHoje = abertas.filter(x => urgency(x) === 'Hoje').length;
  strip.replaceChildren(
   tile('CONSULTAS NO PLANTÃO', consultas, detalheProd, 'production'),
   tile('VAGAS NA ESCALA', vagas, vagas ? 'até o fim da quinzena · abrir' : 'nenhuma nos próximos dias', 'schedule', vagas ? 'aviso' : 'ok'),
   tile('TROCAS DETECTADAS', trocas, trocas ? 'confira abaixo' : 'nenhuma pendente', '', trocas ? 'aviso' : ''),
   tile('PENDÊNCIAS', abertas.length, abertas.length ? `${atrasadas} atrasada${atrasadas === 1 ? '' : 's'} · ${deHoje} para hoje` : 'tudo em dia', 'tasks', atrasadas ? 'alerta' : deHoje ? 'aviso' : ''));
 }

 async function render() {
  desenhar();
  const p = plantaoAtual();
  try {
   const d = await lerProducao(p.inicio, 'agora');
   if (d.disponivel) {
    consultas = (d.registros || []).reduce((s, x) => s + x.adulto + x.pediatria, 0);
    const horas = Math.max(0.25, (Date.now() - Date.parse(p.inicio + ':00-04:00')) / 3600000);
    detalheProd = `${p.turno === 'D' ? 'diurno' : 'noturno'} desde ${p.inicio.slice(11)} · ${(consultas / horas).toFixed(1).replace('.', ',')} por hora`;
   } else { consultas = '—'; detalheProd = 'Gestor Saúde indisponível'; }
  } catch { consultas = '—'; detalheProd = 'Gestor Saúde indisponível'; }
  desenhar();
 }

 for (const evento of ['rt-schedule-changed', 'rt-data-restored', 'rt-trocas-changed']) document.addEventListener(evento, desenhar);
 document.querySelector('[data-view="overview"]')?.addEventListener('click', render);
 render();
 // Atualiza o número de consultas do plantão a cada 3 min enquanto o Painel está aberto.
 setInterval(() => { if (!document.hidden && !overview.hidden) render(); }, 180000);
}
