// Histórico de trocas da escala: manuais (tela do dia, grade, adicionar clínico) e as detectadas pela
// produção. Cada registro guarda data, posto, quem saiu, quem entrou, origem, motivo e quando.
import {parse, slots} from './scheduling.js';
import {fortnight} from './calendar.js';

const JANELA_MS = 2 * 60000;   // trocas seguidas no mesmo posto em 2 min viram um registro só
const novoId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function registrarTroca(storage, {data, slot, saiu = '', entrou = '', origem = 'manual'}, agora = new Date()) {
 if ((saiu || '') === (entrou || '')) return null;
 const lista = parse(storage, 'historico', []);
 const ultimo = [...lista].reverse().find(h => h.data === data && h.slot === slot);
 if (origem === 'manual' && ultimo && ultimo.origem === 'manual' && agora - new Date(ultimo.criadoEm) < JANELA_MS) {
  ultimo.entrou = entrou || '';
  ultimo.criadoEm = agora.toISOString();
  const semMudanca = (ultimo.saiu || '') === (ultimo.entrou || '');
  const final = semMudanca ? lista.filter(h => h !== ultimo) : lista;
  storage.setItem('rt-upa:historico', JSON.stringify(final));
  return semMudanca ? null : ultimo;
 }
 const item = {id: novoId(), data, slot, saiu: saiu || '', entrou: entrou || '', origem, motivo: '', criadoEm: agora.toISOString()};
 lista.push(item);
 storage.setItem('rt-upa:historico', JSON.stringify(lista.slice(-3000)));
 return item;
}

export function definirMotivo(storage, id, motivo) {
 const lista = parse(storage, 'historico', []), item = lista.find(h => h.id === id);
 if (!item) return false;
 item.motivo = String(motivo).slice(0, 300);
 storage.setItem('rt-upa:historico', JSON.stringify(lista));
 return true;
}

export const nomeCurto = d => String(d || '').split('\n')[0] || 'Vago';
const ORIGEM = {manual: 'Manual', 'produção': 'Pela produção', desfeita: 'Troca desfeita'};

export function csvHistorico(lista) {
 const campo = v => `"${String(v).replaceAll('"', '""')}"`;
 const linhas = lista.map(h => [h.data.split('-').reverse().join('/'), slots[h.slot], nomeCurto(h.saiu), nomeCurto(h.entrou), ORIGEM[h.origem] || h.origem, h.motivo, new Date(h.criadoEm).toLocaleString('pt-BR')]);
 return '﻿' + [['Data', 'Posto', 'Saiu', 'Entrou', 'Origem', 'Motivo', 'Registrado em'], ...linhas].map(l => l.map(campo).join(';')).join('\r\n');
}

const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };

export function mountHistorico(storage) {
 const destino = document.querySelector('details.settings');
 if (!destino) return;
 const box = el('details', 'card historico');
 box.innerHTML = '<summary>Histórico de trocas da quinzena <span class="historico-contagem"></span></summary><div class="historico-corpo"><div class="prod-controls"><label>Médico<input type="search" class="historico-busca" placeholder="Filtrar por nome"></label><button type="button" class="secondary historico-csv">Baixar histórico (CSV)</button></div><div class="table-wrap"><table class="prod-table"><thead><tr><th>Data</th><th>Posto</th><th>Saiu</th><th>Entrou</th><th>Origem</th><th>Motivo</th></tr></thead><tbody></tbody></table></div><p class="notice">Registra as trocas feitas na tela do dia, na grade e no "Adicionar clínico", e as detectadas pela produção. Escreva o motivo na própria linha (salva sozinho).</p></div>';
 destino.before(box);
 const $ = s => box.querySelector(s);
 let atual = [];

 function daQuinzena() {
  let dias;
  try { dias = fortnight(Number(document.querySelector('#year').value), Number(document.querySelector('#month').value), Number(document.querySelector('#half').value)).map(d => d.date); } catch { return []; }
  const filtro = $('.historico-busca').value.trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  return parse(storage, 'historico', []).filter(h => dias.includes(h.data))
   .filter(h => !filtro || `${nomeCurto(h.saiu)} ${nomeCurto(h.entrou)}`.normalize('NFD').replace(/[̀-ͯ]/g, '').includes(filtro))
   .sort((a, b) => b.data.localeCompare(a.data) || a.slot - b.slot || b.criadoEm.localeCompare(a.criadoEm));
 }

 function render() {
  atual = daQuinzena();
  $('.historico-contagem').textContent = atual.length ? `· ${atual.length}` : '';
  const corpo = $('tbody'); corpo.replaceChildren();
  if (!atual.length) { const tr = el('tr'); const td = el('td', 'muted', 'Nenhuma troca registrada nesta quinzena.'); td.colSpan = 6; tr.append(td); corpo.append(tr); return; }
  for (const h of atual) {
   const tr = el('tr'), motivo = el('input');
   motivo.value = h.motivo; motivo.placeholder = 'Ex.: troca combinada, atestado…'; motivo.maxLength = 300;
   motivo.setAttribute('aria-label', `Motivo da troca de ${h.data}`);
   motivo.onchange = () => definirMotivo(storage, h.id, motivo.value);
   const tdMotivo = el('td'); tdMotivo.append(motivo);
   tr.append(el('td', '', h.data.split('-').reverse().join('/')), el('td', '', slots[h.slot]), el('td', '', nomeCurto(h.saiu)), el('td', 'strong', nomeCurto(h.entrou)), el('td', 'muted', ORIGEM[h.origem] || h.origem), tdMotivo);
   corpo.append(tr);
  }
 }

 $('.historico-busca').oninput = render;
 $('.historico-csv').onclick = () => {
  if (!atual.length) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csvHistorico(atual)], {type: 'text/csv;charset=utf-8'}));
  a.download = `historico-trocas-${document.querySelector('#year').value}-${String(document.querySelector('#month').value).padStart(2, '0')}-${document.querySelector('#half').value}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
 };
 for (const evento of ['rt-schedule-changed', 'rt-data-restored']) document.addEventListener(evento, render);
 document.querySelector('#generate')?.addEventListener('click', render);
 render();
}
