import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MemoryStore} from '../src/online-store.js';
import {baseDoctor} from '../src/scheduling.js';
import {postoClinicoParaFixo, quadroFixos} from '../src/cadastro.js';
const seed = JSON.parse(readFileSync(new URL('../src/seed.json', import.meta.url), 'utf8'));
const INGRID = 'INGRID TAVARES DE PAULA TELES\nCRM 17422 - COAPH';
const nome = d => (d || '').split('\n')[0];
// Segunda 19/10/2026, diurno: Clínico 1 = Luís Eduardo, Clínico 2 livre, Clínico 3 e 4 ocupados.

test('fixar alguém num clínico ocupado vai para o clínico livre: ninguém sai', () => {
 const store = new MemoryStore();
 const pos = postoClinicoParaFixo(seed, store, '2026-10-16', 1, 0, INGRID);
 assert.deepEqual([pos.livre, pos.movido, pos.slot], [true, true, 1]);
 store.setItem('rt-upa:roster', JSON.stringify([{id: 'i', start: '2026-10-16', weekday: 1, slot: pos.slot, doctor: INGRID}]));
 const dia = [0, 1, 2, 3].map(s => nome(baseDoctor(seed, store, '2026-10-19', s)));
 assert.ok(dia.includes('LUÍS EDUARDO BRESCANCIM'));             // quem era fixo continua
 assert.ok(dia.includes('INGRID TAVARES DE PAULA TELES'));
});

test('com os 4 clínicos ocupados é preciso escolher quem sai; quem já é fixo no turno não muda', () => {
 const store = new MemoryStore();
 // Sexta diurno: 4 fixos (Caio, José Pedro, Ingrid, Luís Eduardo).
 const outro = postoClinicoParaFixo(seed, store, '2026-10-16', 5, 0, 'JULIANE ZANINA\nCRM 15902 - COAPH');
 assert.equal(outro.livre, false);
 assert.equal(outro.ocupados.filter(o => o.doctor).length, 4);
 const ja = postoClinicoParaFixo(seed, store, '2026-10-16', 5, 0, INGRID);
 assert.deepEqual([ja.livre, ja.jaEsta], [true, true]);
});

test('posto fora dos clínicos (pediatria, box, cinderela) continua no número escolhido', () => {
 const pos = postoClinicoParaFixo(seed, new MemoryStore(), '2026-10-16', 1, 4, INGRID);
 assert.deepEqual([pos.slot, pos.turno], [4, null]);
});

test('"a partir de" só aparece quando muda de médico: fixar de novo quem já é fixo não vira agendamento', () => {
 const q0 = quadroFixos(seed, new MemoryStore(), '2026-10-13'), atual = q0.celulas.get('1|0').doctor;
 const mesmo = new MemoryStore({'rt-upa:roster': JSON.stringify([{id: 'a', start: '2026-10-19', weekday: 1, slot: 0, doctor: atual}])});
 assert.equal(quadroFixos(seed, mesmo, '2026-10-13').celulas.get('1|0').futuro, null);
 const outro = new MemoryStore({'rt-upa:roster': JSON.stringify([{id: 'a', start: '2026-10-19', weekday: 1, slot: 0, doctor: INGRID}])});
 assert.deepEqual(quadroFixos(seed, outro, '2026-10-13').celulas.get('1|0').futuro, {start: '2026-10-19', doctor: INGRID});
});

test('quadro de fixos não confunde a escala importada do dia com fixo', () => {
 // 01/10/2026 (quinta) tem escala importada; o quadro deve mostrar o padrão, igual a qualquer outra quinta.
 const store = new MemoryStore();
 const a = quadroFixos(seed, store, '2026-10-01'), b = quadroFixos(seed, store, '2026-10-02');
 for (const s of [0, 1, 2, 3, 7, 8, 9, 10]) assert.equal(a.celulas.get(`4|${s}`).doctor, b.celulas.get(`4|${s}`).doctor);
});
