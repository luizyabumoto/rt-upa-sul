import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MemoryStore} from '../src/online-store.js';
import {baseDoctor, doctorChoices, parse} from '../src/scheduling.js';
import {excluirMedico, reincluirMedico, fixosDoMedico, atualizarCrm, completarCrms, excluidos} from '../src/cadastro.js';
const seed = JSON.parse(readFileSync(new URL('../src/seed.json', import.meta.url), 'utf8'));
const MARCELA = 'MARCELA BRINGEL FRANCO\nCRM A CONFIRMAR - COAPH';

test('CRM a confirmar: atualiza em todo lugar e mantém o vínculo de cada registro', () => {
 const store = new MemoryStore({
  'rt-upa:doctors': JSON.stringify([MARCELA]),
  'rt-upa:edits:2026:9:2': JSON.stringify({'2026-09-29|9': MARCELA, '2026-09-29|8': 'MARCELA BRINGEL FRANCO\nCRM A CONFIRMAR - EXTRA SMS'}),
  'rt-upa:trocas': JSON.stringify([{id: 'x', entrou: MARCELA, saiu: 'OUTRA\nCRM 1 - SMS'}])});
 assert.equal(atualizarCrm(store, MARCELA, 'CRM-MT 19.876'), 4);
 assert.equal(baseDoctor(seed, store, '2026-09-29', 9), 'MARCELA BRINGEL FRANCO\nCRM 19876 - COAPH');
 assert.equal(baseDoctor(seed, store, '2026-09-29', 8), 'MARCELA BRINGEL FRANCO\nCRM 19876 - EXTRA SMS');
 assert.equal(parse(store, 'trocas', [])[0].entrou, 'MARCELA BRINGEL FRANCO\nCRM 19876 - COAPH');
 assert.equal(parse(store, 'trocas', [])[0].saiu, 'OUTRA\nCRM 1 - SMS');
 assert.throws(() => atualizarCrm(store, MARCELA, 'abc'));
});

test('CRM pelo Gestor Saúde completa só quem está a confirmar', () => {
 const store = new MemoryStore({'rt-upa:doctors': JSON.stringify([MARCELA])});
 const feitos = completarCrms(store, doctorChoices(seed, store), {'MARCELA BRINGEL FRANCO': '19876', 'JULIANE ZANINA': '99999'});
 assert.deepEqual(feitos, ['MARCELA BRINGEL FRANCO']);
 assert.ok(parse(store, 'doctors', []).includes('MARCELA BRINGEL FRANCO\nCRM 19876 - COAPH'));
 // A Juliane já tinha CRM: não é trocado pelo Gestor.
 assert.ok(doctorChoices(seed, store).some(d => d.startsWith('JULIANE ZANINA\nCRM 15902')));
});

test('excluir médico: encerra os dias fixos a partir da data, some das sugestões e volta ao recadastrar', () => {
 const store = new MemoryStore();
 const juliane = doctorChoices(seed, store).find(d => d.startsWith('JULIANE ZANINA'));
 const {fixos} = fixosDoMedico(seed, store, juliane, '2026-10-05');
 assert.ok(fixos.length > 0);
 const antes = baseDoctor(seed, store, '2026-09-29', 7);                 // dia anterior: não muda
 const r = excluirMedico(seed, store, juliane, '2026-10-05');
 assert.equal(r.fixos, fixos.length);
 assert.equal(baseDoctor(seed, store, '2026-09-29', 7), antes);
 const {weekday, slot} = fixos[0];
 const depois = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'].find(d => new Date(d + 'T12:00:00').getDay() === weekday);
 assert.equal(baseDoctor(seed, store, depois, slot), '');                // posto fica vago dali em diante
 assert.ok(!doctorChoices(seed, store).some(d => d.startsWith('JULIANE ZANINA')));
 assert.ok(excluidos(store).size === 1);
 reincluirMedico(store, juliane);
 assert.ok(doctorChoices(seed, store).some(d => d.startsWith('JULIANE ZANINA')));
});

test('dias fixos não repetem a escala do dia escolhido em todos os dias da semana', () => {
 const store = new MemoryStore(), juliane = 'JULIANE ZANINA\nCRM 15902 - COAPH';
 // 29/09 ela está no Clínico 1 diurno e noturno; o padrão de setembro tem 5 dias fixos dela, não 14.
 assert.equal(fixosDoMedico(seed, store, juliane, '2026-09-29').fixos.length, 5);
 assert.equal(fixosDoMedico(seed, store, juliane, '2026-10-05').fixos.length, 4);
});
