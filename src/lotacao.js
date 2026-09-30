// Lotacionograma: quem são os médicos da unidade em cada área (clínico, infantil, box, visita, cinderela),
// por vínculo (SMS, COAPH, EXTRA SMS), a partir da escala do período. Responde na hora o que a Secretaria pede:
// "médico clínico para toda a escala" (quantos seriam necessários) e "médico clínico atual SMS" (quantos há hoje).
import {segments, parse, periodReview, doctorIdentity, affiliation, doctorChoices} from './scheduling.js';
import {fortnight} from './calendar.js';

export const AREAS = [
 {chave: 'clinico', nome: 'Médico clínico', curto: 'Clínico', slots: [0, 1, 2, 3, 7, 8, 9, 10], porDia: 8, unidade: 12, detalhe: '4 no dia + 4 na noite'},
 {chave: 'infantil', nome: 'Médico infantil', curto: 'Infantil', slots: [4, 5, 11, 12], porDia: 4, unidade: 12, detalhe: '2 no dia + 2 na noite'},
 {chave: 'box', nome: 'Box de emergência', curto: 'Box', slots: [6, 13], porDia: 2, unidade: 12, detalhe: '1 no dia + 1 na noite'},
 {chave: 'visita', nome: 'Visitador da enfermaria', curto: 'Visita', visita: true, porDia: 2, unidade: 6, detalhe: '2 visitas de 6 h por dia'},
 {chave: 'cinderela', nome: 'Cinderela', curto: 'Cinderela', slots: [14, 15], unidade: 6, detalhe: 'plantões de 6 h'},
];
export const VINCULOS = ['SMS', 'COAPH', 'EXTRA SMS'];
const nomeDe = d => String(d || '').split('\n')[0].trim();
const crmDe = d => (String(d || '').match(/CRM\D*(\d+)/i) || [])[1] || '';

// Datas do período: mês inteiro ou uma quinzena ('mes' | '1' | '2').
export function datasDoPeriodo(ano, mes, parte = 'mes') {
 const q = h => fortnight(ano, mes, h).map(d => d.date);
 return parte === '1' ? q(1) : parte === '2' ? q(2) : [...q(1), ...q(2)];
}

// Visitador do dia: ajuste semanal salvo (visits:weekly) ou o padrão importado.
function visitador(seed, storage, data, linha) {
 const dia = new Date(data + 'T12:00:00Z').getUTCDay(), ajustes = parse(storage, 'visits:weekly', {}), chave = `${dia}|${linha}`;
 return Object.hasOwn(ajustes, chave) ? ajustes[chave] : seed.visits.find(v => v.weekday === dia && v.line === linha)?.doctor || '';
}

// Levantamento do período: cada médico com plantões e horas por área e vínculo, e o que a escala pede em cada área.
export function levantamento(seed, storage, datas) {
 const medicos = new Map();
 const areas = Object.fromEntries(AREAS.map(a => [a.chave, {necessarios: a.porDia ? a.porDia * datas.length : null, vagos: 0}]));
 const somar = (doctor, area, horas, unidade) => {
  if (!doctor) return;
  const id = doctorIdentity(doctor), vinculo = affiliation(doctor);
  let m = medicos.get(id);
  if (!m) { m = {id, nome: nomeDe(doctor), crm: crmDe(doctor), doctor, areas: {}}; medicos.set(id, m); }
  if (!m.crm) m.crm = crmDe(doctor);
  if (affiliation(m.doctor) !== 'SMS' && vinculo === 'SMS') m.doctor = doctor;      // representa a pessoa pelo vínculo efetivo
  const a = m.areas[area] ||= {};
  const v = a[vinculo] ||= {plantoes: 0, horas: 0};
  v.horas += horas; v.plantoes += horas / unidade;
 };
 for (const data of datas) {
  for (const area of AREAS.filter(a => a.slots)) for (const slot of area.slots) for (const parte of segments(seed, storage, data, slot)) somar(parte.doctor, area.chave, parte.end - parte.start, area.unidade);
  for (const linha of [0, 1]) { const d = visitador(seed, storage, data, linha); if (d) somar(d, 'visita', 6, 6); else areas.visita.vagos += 1; }
 }
 for (const v of periodReview(seed, storage, datas).vacancies) {
  const area = AREAS.find(a => a.slots?.includes(v.slot));
  if (area) areas[area.chave].vagos += 1;
 }
 return {datas, areas, medicos: [...medicos.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))};
}

// Resumo de uma área considerando só os vínculos escolhidos.
export function resumoArea(dados, chave, vinculos = VINCULOS, cargaPorMedico = 10) {
 const area = AREAS.find(a => a.chave === chave), base = dados.areas[chave];
 const porVinculo = Object.fromEntries(VINCULOS.map(v => [v, {medicos: 0, plantoes: 0}]));
 const lista = [];
 for (const m of dados.medicos) {
  const a = m.areas[chave];
  if (!a) continue;
  let plantoes = 0, horas = 0;
  for (const v of VINCULOS) if (a[v]) { porVinculo[v].medicos += 1; porVinculo[v].plantoes += a[v].plantoes; if (vinculos.includes(v)) { plantoes += a[v].plantoes; horas += a[v].horas; } }
  if (plantoes) lista.push({...m, plantoes, horas, vinculosArea: VINCULOS.filter(v => a[v] && vinculos.includes(v))});
 }
 const plantoes = lista.reduce((s, m) => s + m.plantoes, 0);
 return {
  ...area, medicos: lista.sort((a, b) => b.plantoes - a.plantoes || a.nome.localeCompare(b.nome, 'pt-BR')), totalMedicos: lista.length, plantoes,
  necessarios: base.necessarios, vagos: base.vagos, porVinculo,
  cobertura: base.necessarios ? plantoes / base.necessarios : null,
  // "Para toda a escala": médicos necessários para cobrir todos os plantões do período com a carga de referência.
  paraTodaEscala: area.unidade === 12 && base.necessarios && cargaPorMedico ? Math.ceil(base.necessarios / cargaPorMedico) : null,
 };
}

const fmt = n => Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
const pct = v => `${Math.round(v * 100)}%`;
const medicosTxt = n => `${n} ${n === 1 ? 'médico' : 'médicos'}`;

// Texto pronto para o WhatsApp, no formato em que a Secretaria costuma pedir.
export function textoWhatsApp(dados, rotuloPeriodo, cargaPorMedico, noPeriodo = 'no mês') {
 const linhas = [`*Lotação médica · UPA Sul – Pascoal Ramos*`, `${rotuloPeriodo} · conforme a escala`, ''];
 for (const chave of ['clinico', 'infantil', 'box']) {
  const todos = resumoArea(dados, chave, VINCULOS, cargaPorMedico), sms = resumoArea(dados, chave, ['SMS'], cargaPorMedico);
  const nome = todos.nome.replace('Médico ', 'médico ');
  linhas.push(`*${todos.nome}*`,
   `- ${nome.charAt(0).toUpperCase() + nome.slice(1)} para toda a escala: ${medicosTxt(todos.paraTodaEscala)} (${todos.necessarios} plantões de 12 h ${noPeriodo} · ${todos.porDia} por dia · ${fmt(cargaPorMedico)} plantões por médico)`,
   `- ${nome.charAt(0).toUpperCase() + nome.slice(1)} atual SMS: ${medicosTxt(sms.totalMedicos)} (cobrem ${fmt(sms.plantoes)} plantões · ${pct(sms.cobertura || 0)} da escala)`,
   `- Hoje na escala: ${medicosTxt(todos.totalMedicos)} · SMS ${todos.porVinculo.SMS.medicos} · COAPH ${todos.porVinculo.COAPH.medicos} · Extra SMS ${todos.porVinculo['EXTRA SMS'].medicos}${todos.vagos ? ` · ${todos.vagos} plantões vagos` : ''}`, '');
 }
 linhas.push('_Médico que faz plantão como SMS e como extra conta nos dois vínculos._');
 return linhas.join('\n');
}

export function csvLotacao(dados, vinculos) {
 const cab = ['Médico', 'CRM-MT', 'Vínculo(s)', ...AREAS.map(a => `${a.curto} (plantões)`), 'Horas no período'];
 const linhas = [];
 for (const m of dados.medicos) {
  const vs = VINCULOS.filter(v => vinculos.includes(v) && Object.values(m.areas).some(a => a[v]));
  if (!vs.length) continue;
  const porArea = AREAS.map(a => vs.reduce((s, v) => s + (m.areas[a.chave]?.[v]?.plantoes || 0), 0));
  const horas = AREAS.reduce((s, a) => s + vs.reduce((t, v) => t + (m.areas[a.chave]?.[v]?.horas || 0), 0), 0);
  linhas.push([m.nome, m.crm || 'a confirmar', vs.join(' / '), ...porArea.map(fmt), fmt(horas)]);
 }
 const campo = v => `"${String(v).replaceAll('"', '""')}"`;
 return '﻿' + [cab, ...linhas].map(l => l.map(campo).join(';')).join('\r\n');
}

// ---------------------------------------------------------------- tela
const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const CLASSE = {'SMS': 'sms', 'COAPH': 'coaph', 'EXTRA SMS': 'extra'};
const titulo = s => s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, e, l) => e + l.toUpperCase()).replace(/\b(Da|De|Do|Das|Dos|E)\b/g, p => p.toLowerCase());
const lerLocal = (k, padrao) => { try { return localStorage.getItem(k) ?? padrao; } catch { return padrao; } };
const gravarLocal = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento local */ } };

export function mountLotacao(storage, seed) {
 const root = document.querySelector('#lotacao-panel');
 if (!root) return;
 const hoje = new Date(Date.now() - 4 * 3600000);
 let ano = hoje.getUTCFullYear(), mes = hoje.getUTCMonth() + 1, parte = 'mes', dados = null, busca = '';
 let vinculos = VINCULOS.filter(v => lerLocal(`rt-lotacao-${v}`, '1') === '1');
 let carga = Number(lerLocal('rt-lotacao-carga', '10')) || 10;
 root.innerHTML = `<div class="section-heading"><div><p class="eyebrow">LOTACIONOGRAMA · CONFORME A ESCALA</p><h2>Lotação médica da unidade</h2><p>Quantos médicos a escala pede e quantos existem hoje em cada área, por vínculo. Muda sozinho quando a escala muda.</p></div>
  <div class="actions"><button type="button" class="lot-copiar">Copiar para WhatsApp</button><button type="button" class="secondary lot-csv">Baixar planilha (CSV)</button><button type="button" class="secondary lot-imprimir">Imprimir</button></div></div>
  <div class="lot-controles"><div class="lot-periodo"><button type="button" class="secondary icone lot-ant" aria-label="Período anterior">‹</button><strong class="lot-rotulo"></strong><button type="button" class="secondary icone lot-prox" aria-label="Próximo período">›</button>
  <select class="lot-parte" aria-label="Parte do mês"><option value="mes">Mês inteiro</option><option value="1">1ª quinzena</option><option value="2">2ª quinzena</option></select></div>
  <div class="lot-filtro" role="group" aria-label="Vínculos considerados"><span>Mostrar</span>${VINCULOS.map(v => `<button type="button" class="lot-chip ${CLASSE[v]}" data-vinculo="${v}" aria-pressed="true">${v === 'SMS' ? 'SMS efetivo' : v === 'EXTRA SMS' ? 'Extra SMS' : v}</button>`).join('')}<button type="button" class="lot-so-sms secondary">Só SMS</button></div>
  <label class="lot-carga">Carga de referência<span><input type="number" min="1" max="31" step="1" class="lot-carga-input"> plantões de 12 h por médico no mês</span></label></div>
  <p class="lot-copiado" role="status" aria-live="polite"></p>
  <div class="lot-cards"></div><div class="lot-cards lot-cards-menores"></div>
  <div class="section-heading lot-quadro-cab"><div><h2>Quadro de lotação</h2><p>Cada médico na área em que trabalha, separado por vínculo. A barra mostra os plantões no período.</p></div><label class="lot-busca-label">Buscar médico<input type="search" class="lot-busca" placeholder="Nome ou CRM"></label></div>
  <div class="lot-quadro"></div>
  <details class="lot-tabela-box"><summary>Tabela de todos os médicos do período</summary><div class="table-wrap"><table class="prod-table lot-tabela"></table></div></details>
  <details class="lot-sem-plantao"><summary>Médicos cadastrados sem plantão no período</summary><p class="muted lot-sem-lista"></p></details>
  <p class="notice">Conta a escala com ajustes, dias fixos e coberturas confirmadas. Médico que faz plantão como SMS e também como extra aparece nos dois vínculos. "Para toda a escala" = plantões do período ÷ carga de referência (ajuste a carga acima; fica salva neste aparelho).</p>`;
 const $ = s => root.querySelector(s);
 $('.lot-carga-input').value = carga;

 const cargaPeriodo = () => parte === 'mes' ? carga : carga / 2;
 const resumos = () => AREAS.map(a => resumoArea(dados, a.chave, vinculos, cargaPeriodo()));
 function rotuloPeriodo() {
  const m = `${MESES[mes - 1]} de ${ano}`;
  return parte === 'mes' ? m.charAt(0).toUpperCase() + m.slice(1) : `${parte}ª quinzena de ${m}`;
 }

 function cartaoArea(r, grande) {
  const card = el('article', `lot-card${grande ? '' : ' menor'}`);
  const cab = el('div', 'lot-card-cab');
  cab.append(el('h3', '', r.nome), el('span', 'muted', r.detalhe));
  card.append(cab);
  const numeros = el('div', 'lot-numeros');
  const bloco = (valor, rotulo, cls = '') => { const b = el('div', `lot-num ${cls}`); b.append(el('strong', '', valor), el('span', '', rotulo)); return b; };
  if (r.paraTodaEscala) numeros.append(bloco(String(r.paraTodaEscala), 'para toda a escala', 'meta'));
  numeros.append(bloco(String(r.totalMedicos), vinculos.length === 3 ? 'médicos hoje' : `hoje · ${vinculos.map(v => v === 'EXTRA SMS' ? 'extra' : v).join(' + ')}`, 'atual'));
  if (r.paraTodaEscala) {
   const falta = r.paraTodaEscala - r.totalMedicos;
   numeros.append(bloco(falta > 0 ? `−${falta}` : `+${-falta}`, falta > 0 ? 'faltam' : 'sobram', falta > 0 ? 'falta' : 'ok'));
  }
  card.append(numeros);
  // Barra: plantões do período por vínculo e vagos, sobre o total que a escala pede.
  if (r.necessarios) {
   const barra = el('div', 'lot-barra'), total = Math.max(r.necessarios, 1);
   barra.setAttribute('role', 'img');
   barra.setAttribute('aria-label', `${r.necessarios} plantões: ` + VINCULOS.map(v => `${v} ${fmt(r.porVinculo[v].plantoes)}`).join(', ') + `, vagos ${r.vagos}`);
   for (const v of VINCULOS) {
    const seg = el('span', `${CLASSE[v]}${vinculos.includes(v) ? '' : ' apagado'}`);
    seg.style.width = `${r.porVinculo[v].plantoes / total * 100}%`; seg.title = `${v}: ${fmt(r.porVinculo[v].plantoes)} plantões`;
    barra.append(seg);
   }
   if (r.vagos) { const seg = el('span', 'vago'); seg.style.width = `${r.vagos / total * 100}%`; seg.title = `Vagos: ${r.vagos}`; barra.append(seg); }
   card.append(barra);
  }
  const legenda = el('ul', 'lot-legenda');
  for (const v of VINCULOS) {
   const li = el('li', vinculos.includes(v) ? '' : 'apagado');
   li.append(el('i', CLASSE[v]), el('span', '', v === 'SMS' ? 'SMS efetivo' : v === 'EXTRA SMS' ? 'Extra SMS' : v), el('strong', '', `${r.porVinculo[v].medicos} méd.`), el('small', '', `${fmt(r.porVinculo[v].plantoes)} pl.`));
   legenda.append(li);
  }
  if (r.vagos) { const li = el('li', 'vago'); li.append(el('i', 'vago'), el('span', '', 'Vagos'), el('strong', '', `${r.vagos} pl.`)); legenda.append(li); }
  card.append(legenda);
  if (r.necessarios) card.append(el('p', 'lot-rodape', `${r.necessarios} plantões no período · ${vinculos.length === 3 ? 'todos os vínculos' : vinculos.join(' + ')} cobrem ${pct(r.cobertura)}`));
  return card;
 }

 function colunaQuadro(r) {
  const col = el('section', 'lot-coluna');
  const cab = el('header', '');
  cab.append(el('h3', '', r.curto), el('span', 'lot-coluna-num', `${r.totalMedicos}`));
  col.append(cab);
  const max = Math.max(1, ...r.medicos.map(m => m.plantoes));
  for (const v of VINCULOS.filter(x => vinculos.includes(x))) {
   const doGrupo = r.medicos.filter(m => m.areas[r.chave][v]).map(m => ({...m, pv: m.areas[r.chave][v].plantoes}));
   if (!doGrupo.length) continue;
   const grupo = el('div', `lot-grupo ${CLASSE[v]}`);
   grupo.append(el('h4', '', `${v === 'SMS' ? 'SMS efetivo' : v === 'EXTRA SMS' ? 'Extra SMS' : v} · ${doGrupo.length}`));
   for (const m of doGrupo.sort((a, b) => b.pv - a.pv || a.nome.localeCompare(b.nome, 'pt-BR'))) {
    const achou = busca && (m.nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(busca) || m.crm.includes(busca));
    const item = el('div', `lot-medico${achou ? ' achado' : ''}${busca && !achou ? ' fora' : ''}`);
    item.title = `${m.nome} · CRM-MT ${m.crm || 'a confirmar'} · ${v}: ${fmt(m.pv)} plantões no período`;
    const txt = el('div', 'lot-medico-txt');
    txt.append(el('strong', '', titulo(m.nome)), el('small', '', `CRM-MT ${m.crm || 'a confirmar'}`));
    const n = el('span', 'lot-medico-n', fmt(m.pv));
    const barra = el('i', 'lot-medico-barra'); barra.style.width = `${m.pv / max * 100}%`;
    item.append(txt, n, barra);
    grupo.append(item);
   }
   col.append(grupo);
  }
  if (!r.totalMedicos) col.append(el('p', 'muted', 'Ninguém com esses vínculos.'));
  return col;
 }

 function tabela() {
  const t = $('.lot-tabela'); t.replaceChildren();
  const cab = el('tr');
  for (const [txt, cls] of [['Médico'], ['CRM-MT'], ['Vínculo(s)'], ...AREAS.map(a => [a.curto, 'num']), ['Horas', 'num']]) cab.append(el('th', cls || '', txt));
  const thead = el('thead'); thead.append(cab); t.append(thead);
  const corpo = el('tbody');
  for (const m of dados.medicos) {
   const vs = VINCULOS.filter(v => vinculos.includes(v) && Object.values(m.areas).some(a => a[v]));
   if (!vs.length) continue;
   const tr = el('tr');
   tr.append(el('td', 'strong', m.nome), el('td', '', m.crm || 'a confirmar'), el('td', '', vs.join(' / ')));
   let horas = 0;
   for (const a of AREAS) { const n = vs.reduce((s, v) => s + (m.areas[a.chave]?.[v]?.plantoes || 0), 0); horas += vs.reduce((s, v) => s + (m.areas[a.chave]?.[v]?.horas || 0), 0); tr.append(el('td', n ? 'num' : 'num muted', n ? fmt(n) : '—')); }
   tr.append(el('td', 'num strong', `${fmt(horas)} h`));
   corpo.append(tr);
  }
  t.append(corpo);
 }

 function render() {
  if (root.hidden) return;
  $('.lot-rotulo').textContent = rotuloPeriodo();
  $('.lot-parte').value = parte;
  for (const b of root.querySelectorAll('.lot-chip')) b.setAttribute('aria-pressed', String(vinculos.includes(b.dataset.vinculo)));
  dados = levantamento(seed, storage, datasDoPeriodo(ano, mes, parte));
  const lista = resumos();
  $('.lot-cards').replaceChildren(...lista.slice(0, 3).map(r => cartaoArea(r, true)));
  $('.lot-cards-menores').replaceChildren(...lista.slice(3).map(r => cartaoArea(r, false)));
  $('.lot-quadro').replaceChildren(...lista.map(colunaQuadro));
  tabela();
  const ativos = new Set(dados.medicos.map(m => m.id));
  const sem = doctorChoices(seed, storage).filter(d => !ativos.has(doctorIdentity(d))).map(d => `${titulo(nomeDe(d))} (${affiliation(d)})`);
  $('.lot-sem-plantao summary').textContent = `Médicos cadastrados sem plantão no período · ${sem.length}`;
  $('.lot-sem-lista').textContent = sem.join(' · ') || 'Todos os médicos cadastrados têm plantão no período.';
 }

 function mudarMes(passo) { mes += passo; if (mes < 1) { mes = 12; ano -= 1; } if (mes > 12) { mes = 1; ano += 1; } render(); }
 // Setas: um mês por vez, ou uma quinzena por vez quando o período é uma quinzena.
 $('.lot-ant').onclick = () => { if (parte === '2') { parte = '1'; render(); } else if (parte === '1') { parte = '2'; mudarMes(-1); } else mudarMes(-1); };
 $('.lot-prox').onclick = () => { if (parte === '1') { parte = '2'; render(); } else if (parte === '2') { parte = '1'; mudarMes(1); } else mudarMes(1); };
 $('.lot-parte').onchange = e => { parte = e.target.value; render(); };
 for (const b of root.querySelectorAll('.lot-chip')) b.onclick = () => {
  const v = b.dataset.vinculo;
  vinculos = vinculos.includes(v) ? vinculos.filter(x => x !== v) : VINCULOS.filter(x => x === v || vinculos.includes(x));
  if (!vinculos.length) vinculos = [v];
  for (const x of VINCULOS) gravarLocal(`rt-lotacao-${x}`, vinculos.includes(x) ? '1' : '0');
  render();
 };
 $('.lot-so-sms').onclick = () => { vinculos = vinculos.length === 1 && vinculos[0] === 'SMS' ? [...VINCULOS] : ['SMS']; for (const x of VINCULOS) gravarLocal(`rt-lotacao-${x}`, vinculos.includes(x) ? '1' : '0'); render(); };
 $('.lot-carga-input').onchange = e => { carga = Math.min(31, Math.max(1, Number(e.target.value) || 10)); e.target.value = carga; gravarLocal('rt-lotacao-carga', String(carga)); render(); };
 $('.lot-busca').oninput = e => { busca = e.target.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); $('.lot-quadro').replaceChildren(...resumos().map(colunaQuadro)); };
 $('.lot-copiar').onclick = async () => {
  const texto = textoWhatsApp(dados, rotuloPeriodo(), cargaPeriodo(), parte === 'mes' ? 'no mês' : 'na quinzena');
  try { await navigator.clipboard.writeText(texto); $('.lot-copiado').textContent = '✓ Copiado. Cole na conversa do WhatsApp.'; }
  catch { window.prompt('Copie o texto abaixo:', texto); }
  setTimeout(() => { $('.lot-copiado').textContent = ''; }, 5000);
 };
 $('.lot-csv').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csvLotacao(dados, vinculos)], {type: 'text/csv;charset=utf-8'}));
  a.download = `lotacao-medica-${ano}-${String(mes).padStart(2, '0')}${parte === 'mes' ? '' : `-q${parte}`}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
 };
 $('.lot-imprimir').onclick = () => { document.body.classList.add('imprimindo-lotacao'); window.print(); setTimeout(() => document.body.classList.remove('imprimindo-lotacao'), 500); };
 window.addEventListener('afterprint', () => document.body.classList.remove('imprimindo-lotacao'));
 document.querySelector('[data-view="lotacao"]')?.addEventListener('click', () => setTimeout(render));
 for (const evento of ['rt-schedule-changed', 'rt-data-restored']) document.addEventListener(evento, () => { if (!root.hidden) render(); });
}
