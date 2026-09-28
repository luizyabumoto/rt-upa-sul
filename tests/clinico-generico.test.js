import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MemoryStore} from '../src/online-store.js';
import {recurringRule, plannedDoctor} from '../src/scheduling.js';
const seed = JSON.parse(readFileSync(new URL('../src/seed.json', import.meta.url), 'utf8'));

// 2027-03-05 é sexta-feira dentro do padrão vigente do seed: os slots 7 (Tiago) e 9
// (Francisco) já vêm ocupados por padrão; 8 e 10 ficam vagos — cenário real pra testar
// o preenchimento genérico sem inventar dados.
const DATE = '2027-03-05';
const WEEKDAY = 5;

test('médico "Clínico (qualquer)" preenche só os postos vagos, em ordem alfabética, sem mexer nos já fixos', () => {
 const store = new MemoryStore();
 store.setItem('rt-upa:clinicoRoster', JSON.stringify([
  {id: 'g1', start: '2026-12-01', weekday: WEEKDAY, turn: 'noite', doctor: 'ZECA SILVA\nCRM 111 - SMS', active: true},
  {id: 'g2', start: '2026-12-01', weekday: WEEKDAY, turn: 'noite', doctor: 'ANA PEREIRA\nCRM 222 - SMS', active: true},
 ]));
 const result = Object.fromEntries([7, 8, 9, 10].map(slot => [slot, recurringRule(seed, store, DATE, WEEKDAY, slot)?.doctor]));
 assert.match(result[7], /TIAGO/);
 assert.match(result[8], /ANA PEREIRA/);
 assert.match(result[9], /FRANCISCO/);
 assert.match(result[10], /ZECA SILVA/);
 assert.equal(plannedDoctor(seed, store, DATE, 8), result[8]);
});

test('mais médicos genéricos do que vagas: só cabem os primeiros em ordem alfabética, o resto fica de fora sem quebrar nada', () => {
 const store = new MemoryStore();
 store.setItem('rt-upa:clinicoRoster', JSON.stringify([
  {id: 'g1', start: '2026-12-01', weekday: WEEKDAY, turn: 'noite', doctor: 'ZECA SILVA\nCRM 111 - SMS', active: true},
  {id: 'g2', start: '2026-12-01', weekday: WEEKDAY, turn: 'noite', doctor: 'ANA PEREIRA\nCRM 222 - SMS', active: true},
  {id: 'g3', start: '2026-12-01', weekday: WEEKDAY, turn: 'noite', doctor: 'BRUNO EXTRA\nCRM 444 - SMS', active: true},
 ]));
 const result = Object.fromEntries([7, 8, 9, 10].map(slot => [slot, recurringRule(seed, store, DATE, WEEKDAY, slot)?.doctor]));
 assert.match(result[8], /ANA PEREIRA/);
 assert.match(result[10], /BRUNO EXTRA/);
 assert.ok(!Object.values(result).some(doctor => doctor?.includes('ZECA')));
});

test('encerrar (active:false) tira o médico do pool a partir da data informada', () => {
 const store = new MemoryStore();
 store.setItem('rt-upa:clinicoRoster', JSON.stringify([
  {id: 'g1', start: '2026-12-01', weekday: WEEKDAY, turn: 'noite', doctor: 'ZECA SILVA\nCRM 111 - SMS', active: true},
  {id: 'g2', start: '2026-12-01', weekday: WEEKDAY, turn: 'noite', doctor: 'ANA PEREIRA\nCRM 222 - SMS', active: true},
  {id: 'g3', start: '2027-02-01', weekday: WEEKDAY, turn: 'noite', doctor: 'ANA PEREIRA\nCRM 222 - SMS', active: false},
 ]));
 assert.match(recurringRule(seed, store, '2027-01-08', WEEKDAY, 8).doctor, /ANA PEREIRA/);
 assert.match(recurringRule(seed, store, DATE, WEEKDAY, 8).doctor, /ZECA SILVA/);
});

test('escala real importada nunca é sobrescrita por um médico genérico — só preenche vaga de verdade', () => {
 const store = new MemoryStore();
 store.setItem('rt-upa:clinicoRoster', JSON.stringify([
  {id: 'g1', start: '2026-01-01', weekday: 0, turn: 'dia', doctor: 'NOVO GENERICO\nCRM 999 - SMS', active: true},
 ]));
 // 27/09/2026: dado real importado, slot0=GUSTAVO e slot2=THIAGO PAES CONERA; slot3 é vaga de verdade (not-scheduled).
 assert.match(plannedDoctor(seed, store, '2026-09-27', 0), /GUSTAVO/);
 assert.match(plannedDoctor(seed, store, '2026-09-27', 2), /THIAGO PAES CONERA/);
 assert.match(plannedDoctor(seed, store, '2026-09-27', 3), /NOVO GENERICO/);
});
