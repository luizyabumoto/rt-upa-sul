// Cadastro de médicos: excluir (encerra os dias fixos a partir de uma data e tira das listas), completar o CRM
// "A CONFIRMAR" (à mão, com a busca do CFM, ou sozinho pelo Gestor Saúde quando o relatório trouxer o registro).
// Nada disso mexe em plantões passados, trocas, coberturas nem no histórico.
import {parse, doctorIdentity, recurringRule, MISSING_CRM} from './scheduling.js';

export const CFM_BUSCA = 'https://portal.cfm.org.br/busca-medicos';
const nome = d => String(d || '').split('\n')[0].trim();
const DOCTOR_TEXT = /^([^\n]+)\nCRM\s*(\d+|A CONFIRMAR)?\s*-?\s*(EXTRA\s*SMS|COAPH|SMS)?\s*$/i;

export const excluidos = storage => new Set(parse(storage, 'excluidos', []).map(x => x.id));

// Dias fixos (posto numerado e "Clínico qualquer") do médico em vigor na data.
export function fixosDoMedico(seed, storage, doctor, desde) {
 const id = doctorIdentity(doctor), fixos = [];
 for (let w = 0; w < 7; w++) for (let slot = 0; slot < 16; slot++) {
  const r = recurringRule(seed, storage, desde, w, slot);
  if (r?.doctor && !r.generic && doctorIdentity(r.doctor) === id) fixos.push({weekday: w, slot});
 }
 const genericos = parse(storage, 'clinicoRoster', []).filter(x => doctorIdentity(x.doctor) === id && x.start <= desde);
 const ultimo = new Map();
 for (const x of genericos.sort((a, b) => a.start.localeCompare(b.start))) ultimo.set(`${x.weekday}|${x.turn}`, x);
 return {fixos, genericos: [...ultimo.values()].filter(x => x.active)};
}

// Exclui o médico a partir de "desde": encerra os dias fixos (os postos ficam vagos na escala dali em diante),
// tira do cadastro e das sugestões. Para trazer de volta, basta cadastrar de novo.
export function excluirMedico(seed, storage, doctor, desde) {
 const id = doctorIdentity(doctor);
 const {fixos, genericos} = fixosDoMedico(seed, storage, doctor, desde);
 let roster = parse(storage, 'roster', []);
 for (const {weekday, slot} of fixos) {
  roster = roster.filter(x => !(x.start === desde && x.weekday === weekday && x.slot === slot));
  roster.push({id: globalThis.crypto.randomUUID(), start: desde, weekday, slot, doctor: ''});
 }
 storage.setItem('rt-upa:roster', JSON.stringify(roster));
 if (genericos.length) {
  const linhas = parse(storage, 'clinicoRoster', []);
  for (const g of genericos) linhas.push({id: globalThis.crypto.randomUUID(), start: desde, weekday: g.weekday, turn: g.turn, doctor: g.doctor, active: false});
  storage.setItem('rt-upa:clinicoRoster', JSON.stringify(linhas));
 }
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

