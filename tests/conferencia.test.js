import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MemoryStore} from '../src/online-store.js';
import {periodReview, periodKey} from '../src/scheduling.js';
import {fortnight} from '../src/calendar.js';
const seed = JSON.parse(readFileSync(new URL('../src/seed.json', import.meta.url), 'utf8'));
const OCTOBER = fortnight(2026, 10, 1).map(day => day.date);

test('conferência da 1ª quinzena de outubro aponta as vagas do Box noturno e o CRM a confirmar', () => {
 const review = periodReview(seed, new MemoryStore(), OCTOBER);
 assert.deepEqual(review.vacancies.map(v => `${v.date}|${v.slot}`), ['2026-10-03|13', '2026-10-06|13', '2026-10-07|13', '2026-10-10|13', '2026-10-14|13']);
 assert.deepEqual(review.sharedCrm, []);
 assert.deepEqual(review.missingCrm.map(d => d.split('\n')[0]), ['JOSÉ PEDRO MARCHRY VACARI']);
 assert.equal(review.total, review.vacancies.length + review.vacations.length + review.absences.length + review.overlaps.length + review.sharedCrm.length + review.missingCrm.length);
});

test('preencher a vaga tira da lista; afastamento e férias do médico escalado aparecem', () => {
 const store = new MemoryStore();
 const doctor = 'ZECA SILVA\nCRM 111 - SMS';
 store.setItem('rt-upa:' + periodKey('2026-10-03'), JSON.stringify({'2026-10-03|13': doctor, '2026-10-06|13': doctor}));
 store.setItem('rt-upa:absences', JSON.stringify([{doctor, start: '2026-10-06', end: '2026-10-06'}]));
 store.setItem('rt-upa:organizer', JSON.stringify([{kind: 'task', type: 'Férias', doctor, date: '2026-10-03', endDate: '2026-10-03'}]));
 const review = periodReview(seed, store, OCTOBER);
 assert.equal(review.vacancies.some(v => v.date === '2026-10-03' && v.slot === 13), false);
 assert.equal(review.vacancies.length, 3);
 assert.deepEqual(review.absences.map(a => a.date), ['2026-10-06']);
 assert.ok(review.vacations.some(v => v.date === '2026-10-03' && v.slot === 13));
});

test('posto marcado como não previsto (X) na planilha importada não conta como vaga', () => {
 const notPlanned = seed.assignments.find(a => a.availability === 'not-scheduled' && a.slot < 14);
 if (!notPlanned) return;
 const review = periodReview(seed, new MemoryStore(), [notPlanned.date]);
 assert.equal(review.vacancies.some(v => v.slot === notPlanned.slot), false);
});
