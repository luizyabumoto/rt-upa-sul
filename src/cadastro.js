// Cadastro de médicos: excluir (encerra os dias fixos a partir de uma data e tira das listas), completar o CRM
// "A CONFIRMAR" (à mão, com a busca do CFM, ou sozinho pelo Gestor Saúde quando o relatório trouxer o registro).
// Nada disso mexe em plantões passados, trocas, coberturas nem no histórico.
import {parse, doctorIdentity, recurringRule, bounds, vacationConflicts, MISSING_CRM} from './scheduling.js';

export const CFM_BUSCA = 'https://portal.cfm.org.br/busca-medicos';
const nome = d => String(d || '').split('\n')[0].trim();
const DOCTOR_TEXT = /^([^\n]+)\nCRM\s*(\d+|A CONFIRMAR)?\s*-?\s*(EXTRA\s*SMS|COAPH|SMS)?\s*$/i;

export const excluidos = storage => new Set(parse(storage, 'excluidos', []).map(x => x.id));

// Dias fixos (posto numerado e "Clínico qualquer") do médico em vigor na data.
// Inclui também os dias fixos já AGENDADOS para depois da data (inicio = quando passam a valer): sem isso, um fixo
// cadastrado "a partir de 16/10" não aparecia para excluir enquanto a tela estava em 29/09.
export function fixosDoMedico(seed, storage, doctor, desde) {
 const id = doctorIdentity(doctor), fixos = [];
 for (let w = 0; w < 7; w++) for (let slot = 0; slot < 16; slot++) {
  const r = recurringRule(seed, storage, desde, w, slot);
  if (r?.doctor && !r.generic && doctorIdentity(r.doctor) === id) fixos.push({weekday: w, slot, doctor: r.doctor});
 }
 for (const x of parse(storage, 'roster', []).filter(x => x.start > desde && x.doctor && doctorIdentity(x.doctor) === id).sort((a, b) => a.start.localeCompare(b.start))) {
  if (!fixos.some(f => f.weekday === x.weekday && f.slot === x.slot)) fixos.push({weekday: x.weekday, slot: x.slot, doctor: x.doctor, inicio: x.start});
 }
 const linhas = parse(storage, 'clinicoRoster', []).filter(x => doctorIdentity(x.doctor) === id).sort((a, b) => a.start.localeCompare(b.start) || String(a.id).localeCompare(String(b.id)));
 const genericos = [];
 for (const chave of new Set(linhas.map(x => `${x.weekday}|${x.turn}`))) {
  const doTurno = linhas.filter(x => `${x.weekday}|${x.turn}` === chave);
  const vigente = doTurno.filter(x => x.start <= desde).at(-1), agendado = doTurno.find(x => x.start > desde && x.active);
  if (vigente?.active) genericos.push(vigente);
  else if (agendado) genericos.push({...agendado, inicio: agendado.start});
 }
 return {fixos, genericos};
}

// Encerra dias fixos a partir de "desde" (inclusive): o posto fica sem fixo dali em diante e a escala já mostra a
// mudança. Dias anteriores, edições do dia e coberturas não mudam. fixos: [{weekday, slot}]; genericos: linhas do
// "Clínico (qualquer)" [{weekday, turn, doctor}].
export function excluirDiasFixos(storage, {fixos = [], genericos = []}, desde) {
 if (!/^\d{4}-\d{2}-\d{2}$/.test(desde || '')) throw new Error('Escolha a data a partir da qual os dias fixos deixam de valer.');
 if (fixos.length) {
  let roster = parse(storage, 'roster', []);
  for (const {weekday, slot, doctor, inicio} of fixos) {
   // Fixos DESTE médico agendados para depois da data também saem (senão, o de data mais recente voltava a valer).
   const dele = x => doctor && x.start > desde && x.doctor && doctorIdentity(x.doctor) === doctorIdentity(doctor);
   if (inicio) {
    // Só agendado: apaga o agendamento dele e não mexe em quem está no posto até lá.
    roster = roster.filter(x => !(x.weekday === weekday && x.slot === slot && dele(x)));
    continue;
   }
   roster = roster.filter(x => !(x.weekday === weekday && x.slot === slot && (x.start === desde || dele(x))));
   roster.push({id: globalThis.crypto.randomUUID(), start: desde, weekday, slot, doctor: ''});
  }
  storage.setItem('rt-upa:roster', JSON.stringify(roster));
 }
 if (genericos.length) {
  let linhas = parse(storage, 'clinicoRoster', []);
  for (const g of genericos) {
   linhas = linhas.filter(x => !(x.weekday === g.weekday && x.turn === g.turn && doctorIdentity(x.doctor) === doctorIdentity(g.doctor) && x.start >= desde));
   linhas.push({id: globalThis.crypto.randomUUID(), start: desde, weekday: g.weekday, turn: g.turn, doctor: g.doctor, active: false});
  }
  storage.setItem('rt-upa:clinicoRoster', JSON.stringify(linhas));
 }
 return fixos.length + genericos.length;
}

// Exclui o médico a partir de "desde": encerra os dias fixos (os postos ficam vagos na escala dali em diante),
// tira do cadastro e das sugestões. Para trazer de volta, basta cadastrar de novo.
export function excluirMedico(seed, storage, doctor, desde) {
 const id = doctorIdentity(doctor);
 const {fixos, genericos} = fixosDoMedico(seed, storage, doctor, desde);
 excluirDiasFixos(storage, {fixos, genericos}, desde);
 storage.setItem('rt-upa:doctors', JSON.stringify(parse(storage, 'doctors', []).filter(d => doctorIdentity(d) !== id)));
 const lista = parse(storage, 'excluidos', []).filter(x => x.id !== id);
 lista.push({id, nome: nome(doctor), desde, em: new Date().toISOString()});
 storage.setItem('rt-upa:excluidos', JSON.stringify(lista));
 return {fixos: fixos.length + genericos.length};
}

export function reincluirMedico(storage, doctor) {
 const id = doctorIdentity(doctor), lista = parse(storage, 'excluidos', []);
 if (lista.some(x => x.id === id)) storage.setItem('rt-upa:excluidos', JSON.stringify(lista.filter(x => x.id !== id)));
}

// Troca o CRM do médico em tudo o que está salvo (cadastro, fixos, escala editada, trocas...), mantendo o vínculo
// de cada registro. Devolve quantos textos mudaram.
export function atualizarCrm(storage, doctor, crm) {
 const numero = String(crm || '').replace(/\D/g, '');
 if (!numero) throw new Error('Informe só os números do CRM.');
 const id = doctorIdentity(doctor);
 let mudou = 0;
 const troca = valor => {
  if (typeof valor === 'string') {
   const m = valor.match(DOCTOR_TEXT);
   if (!m || doctorIdentity(m[1]) !== id) return valor;
   const novo = `${m[1].trim()}\nCRM ${numero} - ${(m[3] || 'SMS').toUpperCase().replace(/\s+/g, ' ')}`;
   if (novo !== valor) mudou++;
   return novo;
  }
  if (Array.isArray(valor)) return valor.map(troca);
  if (valor && typeof valor === 'object') return Object.fromEntries(Object.entries(valor).map(([k, v]) => [troca(k), troca(v)]));
  return valor;
 };
 const chaves = [];
 for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k?.startsWith('rt-upa:')) chaves.push(k); }
 for (const k of chaves) {
  let valor; try { valor = JSON.parse(storage.getItem(k)); } catch { continue; }
  const antes = mudou, novo = troca(valor);
  if (mudou !== antes) storage.setItem(k, JSON.stringify(novo));
 }
 // Garante que o médico fique no cadastro com o CRM novo, mesmo que só existisse na escala importada.
 const cadastro = parse(storage, 'doctors', []);
 if (!cadastro.some(d => doctorIdentity(d) === id)) {
  const vinculo = (String(doctor).match(DOCTOR_TEXT)?.[3] || 'SMS').toUpperCase().replace(/\s+/g, ' ');
  storage.setItem('rt-upa:doctors', JSON.stringify([...cadastro, `${nome(doctor)}\nCRM ${numero} - ${vinculo}`]));
 }
 return mudou;
}

export const crmAConfirmar = doctor => String(doctor || '').includes(MISSING_CRM);

// CRMs lidos do Gestor Saúde ({nome do profissional: número}): completa só quem está "A CONFIRMAR".
export function completarCrms(storage, medicos, mapa) {
 const feitos = [];
 for (const doctor of medicos.filter(crmAConfirmar)) {
  const achado = Object.entries(mapa || {}).find(([n]) => doctorIdentity(n) === doctorIdentity(doctor));
  if (achado && /^\d+$/.test(String(achado[1]))) { atualizarCrm(storage, doctor, achado[1]); feitos.push(nome(doctor)); }
 }
 return feitos;
}


// Quadro da semana dos fixos em vigor na data: posto × dia da semana, com postos sem fixo, choques de horário
// do mesmo médico no mesmo dia, mudanças já agendadas e a carga semanal de cada médico.
export const ORDEM_SEMANA = [1, 2, 3, 4, 5, 6, 0];
const proximoDia = (data, weekday) => { const d = new Date(data + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + ((weekday - d.getUTCDay() + 7) % 7)); return d.toISOString().slice(0, 10); };
export function quadroFixos(seed, storage, data) {
 const futuros = parse(storage, 'roster', []).filter(x => x.start > data).sort((a, b) => a.start.localeCompare(b.start));
 const afastamentos = parse(storage, 'absences', []);
 const celulas = new Map(), carga = new Map(), conflitos = [];
 for (const w of ORDEM_SEMANA) for (let slot = 0; slot < 16; slot++) {
  const r = recurringRule(seed, storage, data, w, slot);
  const futuro = futuros.find(x => x.weekday === w && x.slot === slot);
  // Férias (Pendências) ou afastamento (Médicos e fixos) no próximo dia da semana a partir da data.
  const dia = proximoDia(data, w), doctor = r?.doctor || '';
  const ausente = doctor && (vacationConflicts(storage, doctor, dia, slot).length ? 'férias' : afastamentos.some(a => doctorIdentity(a.doctor) === doctorIdentity(doctor) && a.start <= dia && dia <= a.end) ? 'afastado' : '');
  celulas.set(`${w}|${slot}`, {weekday: w, slot, doctor, generic: !!r?.generic, revisar: r?.status === 'review', futuro: futuro ? {start: futuro.start, doctor: futuro.doctor} : null, conflito: false, ausente: ausente || '', dia});
 }
 for (const w of ORDEM_SEMANA) {
  const doDia = [...celulas.values()].filter(c => c.weekday === w && c.doctor);
  for (const c of doDia) {
   const [a, b] = bounds(c.slot, data), id = doctorIdentity(c.doctor);
   const m = carga.get(id) || {doctor: c.doctor, plantoes: 0, horas: 0};
   m.plantoes += 1; m.horas += b - a; carga.set(id, m);
   for (const o of doDia) {
    if (o.slot <= c.slot || doctorIdentity(o.doctor) !== id) continue;
    const [x, y] = bounds(o.slot, data);
    if (a < y && x < b) { c.conflito = o.conflito = true; conflitos.push({weekday: w, doctor: c.doctor, slots: [c.slot, o.slot]}); }
   }
  }
 }
 // Cinderelas não costumam existir no fim de semana: posto vazio ali não conta como pendência.
 const semFixo = [...celulas.values()].filter(c => !c.doctor && !(c.slot >= 14 && (c.weekday === 0 || c.weekday === 6)));
 return {celulas, semFixo, conflitos, carga};
}
