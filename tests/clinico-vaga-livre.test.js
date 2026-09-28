import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MemoryStore} from '../src/online-store.js';
import {clinicoOccupancy, baseDoctor, periodKey} from '../src/scheduling.js';
const seed = JSON.parse(readFileSync(new URL('../src/seed.json', import.meta.url), 'utf8'));

// 2027-03-05 (sexta): no noturno, Clínico 1 (slot 7) e Clínico 3 (slot 9) vêm do padrão; 2 e 4 estão vagos.
const DATE = '2027-03-05';

test('incluir clínico usa a primeira posição livre, qualquer que seja o número', () => {
 const store = new MemoryStore();
 const before = clinicoOccupancy(seed, store, DATE, 'noite');
 assert.deepEqual(before.free, [8, 10]);
 assert.equal(before.doctors.length, 2);
 store.setItem('rt-upa:' + periodKey(DATE), JSON.stringify({[`${DATE}|8`]: 'ANA PEREIRA\nCRM 222 - SMS'}));
 const after = clinicoOccupancy(seed, store, DATE, 'noite');
 assert.deepEqual(after.free, [10]);
 assert.equal(after.doctors.length, 3);
 assert.match(baseDoctor(seed, store, DATE, 8), /ANA PEREIRA/);
});

test('posição vaga com cobertura confirmada não conta como livre; com 4 médicos o turno está completo', () => {
 const store = new MemoryStore();
 store.setItem('rt-upa:coverages', JSON.stringify([{id: 'c1', confirmed: true, date: DATE, slot: 10, start: 19, end: 31, doctor: 'ZECA SILVA\nCRM 111 - SMS'}]));
 assert.deepEqual(clinicoOccupancy(seed, store, DATE, 'noite').free, [8]);
 store.setItem('rt-upa:' + periodKey(DATE), JSON.stringify({[`${DATE}|8`]: 'ANA PEREIRA\nCRM 222 - SMS', [`${DATE}|10`]: 'BIA LIMA\nCRM 333 - SMS'}));
 const full = clinicoOccupancy(seed, store, DATE, 'noite');
 assert.deepEqual(full.free, []);
 assert.equal(full.doctors.length, 4);
});
