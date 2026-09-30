import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MemoryStore} from '../src/online-store.js';
import {baseDoctor, parse} from '../src/scheduling.js';
import {fixosDoMedico, excluirDiasFixos} from '../src/cadastro.js';
const seed = JSON.parse(readFileSync(new URL('../src/seed.json', import.meta.url), 'utf8'));
const GABRIEL = 'GABRIEL HENRIQUE SALVATORI SILVA\nCRM 15718 - COAPH';
const HOJE = '2026-09-29';                                     // "Válidos em" na tela
const fixo = (start, weekday, slot) => ({id: `${start}${weekday}${slot}`, start, weekday, slot, doctor: GABRIEL});
const gabrielEm = (store, data, slot) => /^GABRIEL/.test(baseDoctor(seed, store, data, slot));

test('Gabriel: fixo já em vigor (terça e quinta noturno) — exclui só a terça, a partir da data', () => {
 const store = new MemoryStore({'rt-upa:roster': JSON.stringify([fixo('2026-09-16', 2, 8), fixo('2026-09-16', 4, 8)])});
 const {fixos} = fixosDoMedico(seed, store, GABRIEL, HOJE);
 assert.deepEqual(fixos.map(f => [f.weekday, f.slot, f.inicio || '']), [[2, 8, ''], [4, 8, '']]);
 excluirDiasFixos(store, {fixos: [fixos[0]]}, HOJE);
 assert.ok(gabrielEm(store, '2026-09-22', 8));                // terça anterior: igual
 assert.ok(!gabrielEm(store, '2026-10-20', 8));               // terça seguinte: sem ele
 assert.ok(gabrielEm(store, '2026-10-22', 8));                // quinta continua
});

test('Gabriel: fixo AGENDADO para depois da data aparece e é excluído sem tirar quem está no posto até lá', () => {
 const store = new MemoryStore({'rt-upa:roster': JSON.stringify([fixo('2026-10-16', 2, 8), fixo('2026-10-16', 4, 8)])});
 const atualNaTerca = baseDoctor(seed, store, '2026-10-06', 8);        // antes de 16/10: quem já estava
 const {fixos} = fixosDoMedico(seed, store, GABRIEL, HOJE);
 assert.deepEqual(fixos.map(f => [f.weekday, f.slot, f.inicio]), [[2, 8, '2026-10-16'], [4, 8, '2026-10-16']]);
 assert.ok(gabrielEm(store, '2026-10-20', 8));
 excluirDiasFixos(store, {fixos: [fixos[0]]}, HOJE);
 assert.ok(!gabrielEm(store, '2026-10-20', 8));               // a terça dele não começa mais
 assert.ok(gabrielEm(store, '2026-10-22', 8));                // a quinta continua agendada
 assert.equal(baseDoctor(seed, store, '2026-10-06', 8), atualNaTerca);  // quem estava no posto não sai
 assert.ok(!parse(store, 'roster', []).some(r => r.weekday === 2 && r.slot === 8 && r.doctor === ''));
});

test('Gabriel como Clínico (qualquer) agendado também é excluído', () => {
 const store = new MemoryStore({'rt-upa:clinicoRoster': JSON.stringify([{id: 'g', start: '2026-10-16', weekday: 2, turn: 'noite', doctor: GABRIEL, active: true}])});
 const {genericos} = fixosDoMedico(seed, store, GABRIEL, HOJE);
 assert.deepEqual(genericos.map(g => [g.weekday, g.turn, g.inicio]), [[2, 'noite', '2026-10-16']]);
 excluirDiasFixos(store, {genericos}, HOJE);
 assert.deepEqual(fixosDoMedico(seed, store, GABRIEL, '2026-10-20').genericos, []);
});
