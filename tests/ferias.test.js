import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MemoryStore} from '../src/online-store.js';
import {plannedDoctor, baseDoctor, periodKey} from '../src/scheduling.js';
const seed = JSON.parse(readFileSync(new URL('../src/seed.json', import.meta.url), 'utf8'));
const ANA = 'ANA KELLEN PADILHA CORREIA DE LIMA\nCRM 14083 - SMS';

test('plantão fixo não coloca médico de férias; volta depois; manual permanece', () => {
 const s = new MemoryStore();
 s.setItem('rt-upa:roster', JSON.stringify([{id: 'r1', start: '2026-11-01', weekday: 4, slot: 0, doctor: ANA}]));
 s.setItem('rt-upa:organizer', JSON.stringify([{kind: 'task', type: 'Férias', doctor: ANA, date: '2026-11-05', endDate: '2026-11-12'}]));
 assert.equal(plannedDoctor(seed, s, '2026-11-05', 0), '');            // quinta em férias: vago
 assert.equal(plannedDoctor(seed, s, '2026-11-12', 0), '');            // último dia de férias: vago
 assert.match(plannedDoctor(seed, s, '2026-11-19', 0), /^ANA KELLEN/); // fora das férias: volta sozinha
 // Edição manual num dia de férias NÃO some (fica para o alerta vermelho).
 s.setItem('rt-upa:' + periodKey('2026-11-05'), JSON.stringify({'2026-11-05|1': ANA}));
 assert.match(baseDoctor(seed, s, '2026-11-05', 1), /^ANA KELLEN/);
});
