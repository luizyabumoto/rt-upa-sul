// Vagas abertas nos próximos dias (Painel) e carga de plantões por médico no mês (Escala).
import {periodReview, segments, slots, doctorIdentity} from './scheduling.js';
import {fortnight} from './calendar.js';

const DIA_MS = 86400000;
const iso = d => d.toISOString().slice(0, 10);

// Datas de hoje até o fim da quinzena atual; se a próxima começa em até 7 dias, inclui a próxima inteira.
export function datasParaVigiar(hoje) {
 const [ano, mes, dia] = hoje.split('-').map(Number), metade = dia <= 15 ? 1 : 2;
 const atual = fortnight(ano, mes, metade).map(d => d.date).filter(d => d >= hoje);
 const proxima = metade === 1 ? fortnight(ano, mes, 2) : fortnight(mes === 12 ? ano + 1 : ano, mes === 12 ? 1 : mes + 1, 1);
 const diasAteProxima = (Date.parse(proxima[0].date) - Date.parse(hoje)) / DIA_MS;
 return diasAteProxima <= 7 ? [...atual, ...proxima.map(d => d.date)] : atual;
}

export function vagasProximas(seed, storage, hoje) {
 return periodReview(seed, storage, datasParaVigiar(hoje)).vacancies;
}

// Horas por médico no mês, a partir da escala (com coberturas): plantões de 12 h e cinderelas de 6 h.
export function cargaDoMes(seed, storage, ano, mes) {
 const datas = [...fortnight(ano, mes, 1), ...fortnight(ano, mes, 2)].map(d => d.date), porMedico = new Map();
 for (const data of datas) for (let slot = 0; slot < 16; slot++) for (const parte of segments(seed, storage, data, slot)) {
  if (!parte.doctor) continue;
  const chave = doctorIdentity(parte.doctor);
  const m = porMedico.get(chave) || {medico: parte.doctor.split('\n')[0], horas: 0, diurnos: 0, noturnos: 0, cinderelas: 0, plantoes: new Set()};
  m.horas += parte.end - parte.start;
  m.plantoes.add(`${data}|${slot}`);
  if (slot >= 14) m.cinderelas += 1; else if (slot < 7) m.diurnos += 1; else m.noturnos += 1;
  porMedico.set(chave, m);
 }
 return [...porMedico.values()].map(m => ({...m, plantoes: m.plantoes.size})).sort((a, b) => b.horas - a.horas || a.medico.localeCompare(b.medico, 'pt-BR'));
}

const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
const hojeCuiaba = () => new Date(Date.now() - 4 * 3600000).toISOString().slice(0, 10);
const dataBR = d => d.split('-').reverse().slice(0, 2).join('/');
const LIMITE_PADRAO = 240;

function abrirDia(data) {
 document.querySelector('[data-view="schedule"]')?.click();
 const campo = document.querySelector('#schedule-date');
 if (!campo) return;
 campo.value = data;
 campo.dispatchEvent(new Event('change'));
}

export function mountAlertasEscala(storage, seed) {
 // Item: vagas abertas no Painel.
 const overview = document.querySelector('#overview-panel');
 const vagas = el('section', 'vagas-alerta'); vagas.hidden = true;
 const lugar = overview?.querySelector('[data-slot="alertas"]');
 if (lugar) lugar.append(vagas);
 else if (overview) { const antes = overview.querySelector('.trocas-alerta') || overview.querySelector('.flow-summary'); if (antes) antes.after(vagas); else overview.prepend(vagas); }

 function renderVagas() {
  const lista = vagasProximas(seed, storage, hojeCuiaba());
  vagas.replaceChildren(); vagas.hidden = !lista.length;
  if (!lista.length) return;
  const porDia = new Map();
  for (const v of lista) porDia.set(v.date, [...(porDia.get(v.date) || []), v.slot]);
  vagas.append(el('h3', '', `Vagas na escala · ${lista.length} ${lista.length === 1 ? 'posto vago' : 'postos vagos'} de hoje até ${dataBR(lista.at(-1).date)}`));
  const ul = el('ul');
  for (const [data, postos] of [...porDia].slice(0, 10)) {
   const li = el('li'), botao = el('button', 'secondary', 'Abrir');
   botao.type = 'button'; botao.onclick = () => abrirDia(data);
   li.append(el('strong', '', dataBR(data)), el('span', '', ` ${postos.map(s => slots[s]).join(', ')}`), botao);
   ul.append(li);
  }
  vagas.append(ul);
  if (porDia.size > 10) vagas.append(el('p', 'muted', `… e mais ${porDia.size - 10} dias com vagas.`));
 }

 // Item: carga por médico no mês, dentro da Escala.
 const destino = document.querySelector('details.historico') || document.querySelector('details.settings');
 const carga = el('details', 'card carga');
 carga.innerHTML = '<summary>Carga de plantões no mês <span class="carga-resumo"></span></summary><div class="carga-corpo"><div class="prod-controls"><label>Alertar acima de (horas no mês)<input type="number" class="carga-limite" min="12" max="720" step="12"></label></div><div class="table-wrap"><table class="prod-table"><thead><tr><th>Médico</th><th class="num">Horas</th><th class="num">Plantões</th><th class="num">Diurnos</th><th class="num">Noturnos</th><th class="num">Cinderelas</th></tr></thead><tbody></tbody></table></div><p class="notice">Conta a escala do mês inteiro da quinzena aberta, com coberturas confirmadas: plantão de 12 h e cinderela de 6 h. O limite fica salvo só neste navegador.</p></div>';
 destino?.before(carga);
 const campoLimite = carga.querySelector('.carga-limite');
 let limite = LIMITE_PADRAO;
 try { limite = Number(localStorage.getItem('rt-carga-limite')) || LIMITE_PADRAO; } catch { /* sem armazenamento local */ }
 campoLimite.value = limite;

 function renderCarga() {
  const ano = Number(document.querySelector('#year')?.value), mes = Number(document.querySelector('#month')?.value);
  if (!ano || !mes) return;
  const lista = cargaDoMes(seed, storage, ano, mes), acima = lista.filter(m => m.horas > limite);
  carga.querySelector('.carga-resumo').textContent = `· ${String(mes).padStart(2, '0')}/${ano}${acima.length ? ` · ${acima.length} acima de ${limite} h` : ''}`;
  const corpo = carga.querySelector('tbody'); corpo.replaceChildren();
  for (const m of lista) {
   const tr = el('tr', m.horas > limite ? 'carga-acima' : '');
   tr.append(el('td', 'strong', m.medico), el('td', 'num strong', `${m.horas} h`), el('td', 'num', String(m.plantoes)), el('td', 'num', String(m.diurnos)), el('td', 'num', String(m.noturnos)), el('td', 'num', String(m.cinderelas)));
   corpo.append(tr);
  }
 }
 campoLimite.onchange = () => { limite = Number(campoLimite.value) || LIMITE_PADRAO; try { localStorage.setItem('rt-carga-limite', String(limite)); } catch { /* ignora */ } renderCarga(); };

 const tudo = () => { renderVagas(); if (carga.open) renderCarga(); else carga.querySelector('.carga-resumo').textContent = ''; };
 carga.addEventListener('toggle', () => { if (carga.open) renderCarga(); });
 for (const evento of ['rt-schedule-changed', 'rt-data-restored']) document.addEventListener(evento, tudo);
 document.querySelector('#generate')?.addEventListener('click', tudo);
 tudo();
}
