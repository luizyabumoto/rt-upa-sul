// Escala › Férias: lançar uma vez (médico, de tal data a tal data, substituto opcional).
// O médico sai sozinho de todos os plantões do período (entra o substituto ou o posto fica vago para escolher
// no dia), um lembrete é criado 10 dias antes e, quando as férias acabam, ele volta sozinho aos dias fixos.
// Usa o mesmo registro de férias das Pendências (tipo "Férias"), então as férias já lançadas continuam valendo.
import {parse, slots, doctorChoices, doctorLabel, doctorIdentity, periodKey, plantoesNoPeriodo} from './scheduling.js';
import {doctorPicker} from './doctor-picker.js';

const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
const br = iso => iso ? iso.split('-').reverse().join('/') : '';
const nome = d => String(d || '').split('\n')[0];
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const somarDias = (data, n) => { const d = new Date(data + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
export const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
const hoje = () => new Date(Date.now() - 4 * 3600000).toISOString().slice(0, 10);   // dia em Cuiabá

export function lerFerias(storage) {
 return parse(storage, 'organizer', []).filter(x => x.kind === 'task' && x.type === 'Férias' && x.date && x.endDate);
}

// Situação das férias hoje: 'agora' | 'proxima' | 'encerrada'.
export function situacaoFerias(f, dia = hoje()) {
 if (f.endDate < dia) return 'encerrada';
 return f.date <= dia ? 'agora' : 'proxima';
}

// Lembrete 10 dias antes do início (ou hoje, se já estiver em cima).
export function dataLembrete(inicio, dia = hoje()) {
 const l = somarDias(inicio, -10);
 return l < dia ? dia : l;
}

// Grava as férias (nova ou editada) e tira o médico das trocas feitas à mão no período (as do previsto saem sozinhas).
export function salvarFerias(seed, storage, {id, doctor, inicio, fim, substituto = '', obs = ''}, dia = hoje()) {
 const lista = parse(storage, 'organizer', []);
 const anterior = id ? lista.find(x => x.id === id) : null;
 const item = {
  ...(anterior || {}), id: id || crypto.randomUUID(), kind: 'task', type: 'Férias', title: `Férias · ${nome(doctor)}`.slice(0, 160),
  doctor, date: inicio, endDate: fim, reminder: dataLembrete(inicio, dia), shift: '', needed: 1,
  status: substituto ? 'Em acompanhamento' : 'Precisa de cobertura',
  cover: substituto ? `Substituto: ${nome(substituto)}`.slice(0, 500) : '', substituto,
  body: String(obs || anterior?.body || '').slice(0, 10000),
 };
 // Ajustes à mão que punham o médico no período: apagados, para valer a regra das férias (substituto ou vago).
 for (const p of plantoesNoPeriodo(seed, storage, doctor, inicio, fim).filter(p => p.manual)) {
  const chave = periodKey(p.date), edits = parse(storage, chave, {});
  delete edits[`${p.date}|${p.slot}`];
  storage.setItem('rt-upa:' + chave, JSON.stringify(edits));
 }
 storage.setItem('rt-upa:organizer', JSON.stringify(anterior ? lista.map(x => x.id === item.id ? item : x) : [item, ...lista]));
 return item;
}

export function mountFerias(storage, seed) {
 const destino = document.querySelector('#schedule-panel .daily-schedule');
 if (!destino) return;
 const box = el('section', 'ferias-box');
 destino.before(box);
 const dialog = el('dialog', 'ferias-dialog');
 document.body.append(dialog);
 let verEncerradas = false;

 function linha(f) {
  const sit = situacaoFerias(f), dia = hoje();
  const card = el('article', `ferias-item ${sit}`);
  const topo = el('div', 'ferias-item-topo');
  topo.append(el('strong', '', nome(f.doctor)), el('span', `ferias-pill ${sit}`,
   sit === 'agora' ? `Em férias · volta ${br(somarDias(f.endDate, 1))}` : sit === 'proxima' ? `Começa em ${diasEntre(dia, f.date)} ${diasEntre(dia, f.date) === 1 ? 'dia' : 'dias'}` : 'Encerrada'));
  const total = diasEntre(f.date, f.endDate) + 1;
  const plantoes = sit === 'encerrada' ? null : plantoesNoPeriodo(seed, storage, f.doctor, f.date < dia ? dia : f.date, f.endDate).length;
  card.append(topo, el('p', 'ferias-periodo', `${br(f.date)} a ${br(f.endDate)} · ${total} ${total === 1 ? 'dia' : 'dias'}`),
   el('p', 'muted', f.substituto ? `Substituto: ${nome(f.substituto)}` : plantoes === null ? 'Plantões já liberados' : `${plantoes} ${plantoes === 1 ? 'plantão fica vago' : 'plantões ficam vagos'} — escolha quem cobre no dia`));
  if (sit === 'proxima' && f.reminder) card.append(el('small', 'muted', `🔔 Lembrete em ${br(f.reminder)}`));
  const b = el('button', 'secondary', 'Editar');
  b.type = 'button'; b.onclick = () => abrir(f);
  card.append(b);
  return card;
 }

 function render() {
  const todas = lerFerias(storage).sort((a, b) => a.date.localeCompare(b.date));
  const ativas = todas.filter(f => situacaoFerias(f) !== 'encerrada'), encerradas = todas.filter(f => situacaoFerias(f) === 'encerrada');
  box.replaceChildren();
  const cab = el('div', 'ferias-cab');
  const titulo = el('div');
  titulo.append(el('p', 'eyebrow', 'FÉRIAS DOS MÉDICOS'), el('h2', '', 'Férias'),
   el('p', 'muted', 'Lance uma vez: o médico sai da escala no período, entra o substituto (ou o posto fica vago) e ele volta sozinho no fim. Lembrete 10 dias antes.'));
  const novo = el('button', '', '+ Lançar férias');
  novo.type = 'button'; novo.onclick = () => abrir(null);
  cab.append(titulo, novo);
  box.append(cab);
  const grade = el('div', 'ferias-grade');
  for (const f of ativas) grade.append(linha(f));
  if (!ativas.length) grade.append(el('p', 'empty-state', 'Nenhum médico em férias agora ou nas próximas semanas.'));
  box.append(grade);
  if (encerradas.length) {
   const t = el('button', 'secondary ferias-toggle', verEncerradas ? 'Esconder férias encerradas' : `Ver férias encerradas (${encerradas.length})`);
   t.type = 'button'; t.onclick = () => { verEncerradas = !verEncerradas; render(); };
   box.append(t);
   if (verEncerradas) { const g = el('div', 'ferias-grade encerradas'); for (const f of encerradas.reverse()) g.append(linha(f)); box.append(g); }
  }
 }

 function abrir(f) {
  dialog.replaceChildren();
  const form = el('form', 'ferias-form');
  form.method = 'dialog';
  form.append(el('h2', '', f ? `Férias · ${nome(f.doctor)}` : 'Lançar férias'));
  const opcoes = (vazio) => { const s = document.createElement('select'); s.add(new Option(vazio, '')); for (const d of doctorChoices(seed, storage)) s.add(new Option(doctorLabel(d), d)); return s; };
  const medico = opcoes('— Escolha o médico —'); medico.name = 'doctor'; medico.required = true;
  const inicio = el('input'); inicio.type = 'date'; inicio.name = 'inicio'; inicio.required = true;
  const fim = el('input'); fim.type = 'date'; fim.name = 'fim'; fim.required = true;
  const sub = opcoes('— Ninguém fixo: escolho quem cobre no dia —'); sub.name = 'substituto';
  const obs = el('input'); obs.name = 'obs'; obs.maxLength = 500; obs.placeholder = 'Opcional (ex.: férias regulamentares)';
  const campo = (rotulo, input, cls = '') => { const l = el('label', cls, rotulo); l.append(input); return l; };
  const grade = el('div', 'ferias-form-grade');
  grade.append(campo('Médico', medico, 'largo'), campo('Início das férias', inicio), campo('Último dia de férias', fim), campo('Substituto no período (opcional)', sub, 'largo'), campo('Observação', obs, 'largo'));
  const previa = el('div', 'ferias-previa');
  const acoes = el('div', 'actions');
  const salvar = el('button', '', f ? 'Salvar alterações' : 'Lançar férias'); salvar.value = 'salvar';
  const cancelar = el('button', 'secondary', 'Cancelar'); cancelar.value = 'cancelar'; cancelar.formNoValidate = true;
  acoes.append(salvar, cancelar);
  if (f) {
   const excluir = el('button', 'secondary danger', 'Cancelar estas férias'); excluir.type = 'button';
   excluir.onclick = () => {
    if (!confirm(`Cancelar as férias de ${nome(f.doctor)} (${br(f.date)} a ${br(f.endDate)})?\n\nEle volta para os dias fixos dele nesse período.`)) return;
    storage.setItem('rt-upa:organizer', JSON.stringify(parse(storage, 'organizer', []).filter(x => x.id !== f.id)));
    dialog.close(); document.dispatchEvent(new Event('rt-schedule-changed'));
   };
   acoes.append(excluir);
  }
  form.append(grade, previa, acoes);
  dialog.append(form);
  if (f) { medico.value = f.doctor; inicio.value = f.date; fim.value = f.endDate; sub.value = f.substituto || ''; obs.value = f.body || ''; }

  // Prévia: quais plantões o médico perde e quando chega o lembrete.
  function atualizar() {
   previa.replaceChildren();
   fim.setCustomValidity(inicio.value && fim.value && fim.value < inicio.value ? 'O último dia precisa ser igual ou depois do início.' : '');
   sub.setCustomValidity(sub.value && medico.value && doctorIdentity(sub.value) === doctorIdentity(medico.value) ? 'O substituto não pode ser o próprio médico.' : '');
   if (!medico.value || !inicio.value || !fim.value || fim.value < inicio.value) { previa.append(el('p', 'muted', 'Escolha o médico e as datas para ver os plantões que serão liberados.')); return; }
   const lista = plantoesNoPeriodo(seed, storage, medico.value, inicio.value, fim.value);
   const total = diasEntre(inicio.value, fim.value) + 1;
   previa.append(el('p', 'ferias-previa-titulo', `${total} ${total === 1 ? 'dia' : 'dias'} de férias · ${lista.length} ${lista.length === 1 ? 'plantão' : 'plantões'} na escala ${sub.value ? `vão para ${nome(sub.value)}` : 'ficam vagos'}`));
   if (lista.length) {
    const ul = el('ul');
    for (const p of lista.slice(0, 14)) ul.append(el('li', '', `${br(p.date)} · ${slots[p.slot].replace(/Clínico \d/, 'Clínico')}`));
    if (lista.length > 14) ul.append(el('li', 'muted', `… e mais ${lista.length - 14}`));
    previa.append(ul);
   }
   previa.append(el('p', 'muted', `🔔 Lembrete nas Pendências em ${br(dataLembrete(inicio.value))} (10 dias antes). Em ${br(somarDias(fim.value, 1))} ele volta sozinho aos dias fixos.`));
  }
  for (const x of [medico, inicio, fim, sub]) x.addEventListener('change', atualizar);
  atualizar();
  form.onsubmit = e => {
   if (e.submitter?.value === 'cancelar') return;
   e.preventDefault();
   atualizar();
   if (!form.reportValidity()) return;
   salvarFerias(seed, storage, {id: f?.id, doctor: medico.value, inicio: inicio.value, fim: fim.value, substituto: sub.value, obs: obs.value});
   dialog.close();
   document.dispatchEvent(new Event('rt-schedule-changed'));
  };
  dialog.showModal();
  queueMicrotask(() => { doctorPicker(medico); doctorPicker(sub); });
 }

 for (const ev of ['rt-schedule-changed', 'rt-data-restored']) document.addEventListener(ev, render);
 render();
}
