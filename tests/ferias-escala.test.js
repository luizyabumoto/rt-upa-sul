import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MemoryStore} from '../src/online-store.js';
import {plannedDoctor, baseDoctor, periodKey, definirPosto, plantoesNoPeriodo, doctorIdentity} from '../src/scheduling.js';
import {salvarFerias, dataLembrete, situacaoFerias, lerFerias} from '../src/ferias.js';
const seed = JSON.parse(readFileSync(new URL('../src/seed.json', import.meta.url), 'utf8'));
const ANA = 'ANA KELLEN PADILHA CORREIA DE LIMA\nCRM 14083 - SMS';
const SUB = 'MEDICO SUBSTITUTO TESTE\nCRM 99999 - SMS';
// Um plantão da escala importada (para ver que as férias também tiram o médico dela).
const importado = seed.assignments.find(a => a.slot === 0 && a.doctor);
const mesmo = (a, b) => doctorIdentity(a) === doctorIdentity(b);

test('férias tiram o médico também da escala importada; com substituto, ele entra no lugar', () => {
 const s = new MemoryStore();
 const fim = importado.date;
 s.setItem('rt-upa:organizer', JSON.stringify([{kind: 'task', type: 'Férias', doctor: importado.doctor, date: importado.date, endDate: fim}]));
 assert.equal(plannedDoctor(seed, s, importado.date, 0), '');
 s.setItem('rt-upa:organizer', JSON.stringify([{kind: 'task', type: 'Férias', doctor: importado.doctor, date: importado.date, endDate: fim, substituto: SUB}]));
 assert.equal(plannedDoctor(seed, s, importado.date, 0), SUB);
});

test('lançar férias: lembrete 10 dias antes, apaga ajustes à mão do período e o médico volta depois', () => {
 const s = new MemoryStore();
 s.setItem('rt-upa:roster', JSON.stringify([{id: 'r1', start: '2026-11-01', weekday: 4, slot: 0, doctor: ANA}]));
 s.setItem('rt-upa:' + periodKey('2026-11-07'), JSON.stringify({'2026-11-07|8': ANA}));   // extra posto à mão no período
 assert.equal(plantoesNoPeriodo(seed, s, ANA, '2026-11-05', '2026-11-12').length, 3);   // quintas 05 e 12 + o extra
 const f = salvarFerias(seed, s, {doctor: ANA, inicio: '2026-11-05', fim: '2026-11-12', substituto: SUB}, '2026-10-05');
 assert.equal(f.reminder, '2026-10-26');
 assert.equal(f.status, 'Em acompanhamento');
 assert.equal(baseDoctor(seed, s, '2026-11-05', 0), SUB);
 assert.notEqual(baseDoctor(seed, s, '2026-11-07', 8), ANA);   // o ajuste à mão saiu
 assert.match(plannedDoctor(seed, s, '2026-11-19', 0), /^ANA KELLEN/);   // acabou: volta sozinha
 assert.equal(lerFerias(s).length, 1);
 // Editar mantém o mesmo registro.
 salvarFerias(seed, s, {id: f.id, doctor: ANA, inicio: '2026-11-05', fim: '2026-11-06'}, '2026-10-05');
 assert.equal(lerFerias(s).length, 1);
 assert.match(plannedDoctor(seed, s, '2026-11-12', 0), /^ANA KELLEN/);
});

test('lembrete e situação das férias', () => {
 assert.equal(dataLembrete('2026-11-05', '2026-10-01'), '2026-10-26');
 assert.equal(dataLembrete('2026-10-08', '2026-10-05'), '2026-10-05');   // em cima da hora: hoje
 assert.equal(situacaoFerias({date: '2026-10-01', endDate: '2026-10-10'}, '2026-10-05'), 'agora');
 assert.equal(situacaoFerias({date: '2026-10-20', endDate: '2026-10-30'}, '2026-10-05'), 'proxima');
 assert.equal(situacaoFerias({date: '2026-09-01', endDate: '2026-09-10'}, '2026-10-05'), 'encerrada');
});

test('clínicos 1 a 4 são iguais: pôr num posto quem está em outro troca os dois de lugar', () => {
 const s = new MemoryStore();
 const data = importado.date;
 const c1 = baseDoctor(seed, s, data, 0), c2 = baseDoctor(seed, s, data, 1);
 assert.ok(c1 && c2 && !mesmo(c1, c2));
 const r = definirPosto(seed, s, data, 0, c2);
 assert.equal(r.trocouDeLugar, true);
 assert.equal(baseDoctor(seed, s, data, 0), c2);
 assert.equal(baseDoctor(seed, s, data, 1), c1);
 // Desfazer a troca volta tudo ao previsto, sem sobrar ajuste.
 definirPosto(seed, s, data, 0, c1);
 assert.deepEqual(JSON.parse(s.getItem('rt-upa:' + periodKey(data)) || '{}'), {});
 // Médico de fora do turno: troca normal (não mexe no outro posto).
 const r2 = definirPosto(seed, s, data, 0, SUB);
 assert.equal(r2.trocouDeLugar, false);
 assert.equal(baseDoctor(seed, s, data, 1), c2);
});
