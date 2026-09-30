import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MemoryStore} from '../src/online-store.js';
import {quadroFixos, excluirDiasFixos} from '../src/cadastro.js';
const seed = JSON.parse(readFileSync(new URL('../src/seed.json', import.meta.url), 'utf8'));
const DATA = '2026-10-20', LUCAS = 'LUCAS DE LA CRUZ MOTA\nCRM 17505 - COAPH';

test('quadro da semana: cada posto × dia, postos sem fixo e cinderela de fim de semana fora da conta', () => {
 const q = quadroFixos(seed, new MemoryStore(), DATA);
 assert.equal(q.celulas.size, 7 * 16);
 assert.ok(q.semFixo.every(c => !c.doctor));
 assert.ok(!q.semFixo.some(c => c.slot >= 14 && (c.weekday === 0 || c.weekday === 6)));
 const antes = q.semFixo.length;
 // Excluir um fixo abre mais um posto sem fixo.
 const ocupado = [...q.celulas.values()].find(c => c.doctor && c.slot < 14);
 const store = new MemoryStore();
 excluirDiasFixos(store, {fixos: [{weekday: ocupado.weekday, slot: ocupado.slot}]}, DATA);
 assert.equal(quadroFixos(seed, store, DATA).semFixo.length, antes + 1);
});

test('quadro da semana aponta choque de horário do mesmo médico no mesmo dia e soma a carga', () => {
 const q0 = quadroFixos(seed, new MemoryStore(), DATA);
 const segundaCinderela = q0.celulas.get('1|14');
 assert.match(segundaCinderela.doctor, /^LUCAS DE LA CRUZ MOTA/);
 // Lucas também fixo no Clínico 1 diurno de segunda (07h–19h) cruza com a cinderela (11h–17h).
 const store = new MemoryStore({'rt-upa:roster': JSON.stringify([{id: 'x', start: DATA, weekday: 1, slot: 0, doctor: LUCAS}])});
 const q = quadroFixos(seed, store, DATA);
 assert.ok(q.celulas.get('1|0').conflito && q.celulas.get('1|14').conflito);
 assert.deepEqual(q.conflitos.map(c => [c.weekday, c.slots]), [[1, [0, 14]]]);
 const carga = q.carga.get('lucasdelacruzmota');
 assert.equal(carga.horas, q0.carga.get('lucasdelacruzmota').horas + 12);
 // Mudança agendada para depois aparece na célula.
 const futuro = quadroFixos(seed, store, '2026-10-13').celulas.get('1|0').futuro;
 assert.deepEqual(futuro, {start: DATA, doctor: LUCAS});
});

test('quadro avisa fixo de férias ou afastado nos próximos 7 dias', () => {
 const q0 = quadroFixos(seed, new MemoryStore(), DATA), alvo = q0.celulas.get('1|14');
 const store = new MemoryStore({'rt-upa:organizer': JSON.stringify([{kind: 'task', type: 'Férias', doctor: alvo.doctor, date: '2026-10-26', endDate: '2026-10-30'}]),
  'rt-upa:absences': JSON.stringify([{doctor: q0.celulas.get('2|0').doctor, start: '2026-10-20', end: '2026-10-20'}])});
 const q = quadroFixos(seed, store, DATA);
 assert.equal(q.celulas.get('1|14').ausente, 'férias');            // segunda 26/10
 assert.equal(q.celulas.get('1|14').dia, '2026-10-26');
 assert.equal(q.celulas.get('2|0').ausente, 'afastado');           // terça 20/10 é o próprio dia
 assert.equal(q.celulas.get('3|0').ausente, '');
});
