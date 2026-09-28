import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MemoryStore} from '../src/online-store.js';
import {canonicalDoctor, canonicalizeDeep, canonicalizeStorage, doctorChoices, doctorOptions, withAffiliation, doctorIdentity, periodKey} from '../src/scheduling.js';
const seed = JSON.parse(readFileSync(new URL('../src/seed.json', import.meta.url), 'utf8'));

test('padroniza espaços, vínculo e as correções confirmadas de nome e CRM', () => {
 assert.equal(canonicalDoctor('CAIO LIMA RIBEIRO  DE ALMEIDA\nCRM 11030-  SMS'), 'CAIO LIMA RIBEIRO DE ALMEIDA\nCRM 11030 - SMS');
 assert.equal(canonicalDoctor('SILVIA CORREIA RAMOS RIBEIRO\nCRM  7438 - SMS'), 'SILVIA CORREIA RAMOS RIBEIRO\nCRM 7438 - SMS');
 assert.equal(canonicalDoctor('DHYEILLEN AYLLEN WEBER\nCRM 16798 -EXTRA SMS'), 'DHYEILLEN AYLLEN WEBER\nCRM 16798 - EXTRA SMS');
 assert.equal(canonicalDoctor('GUSTAVO LUIZ SILA CAMPOS\nCRM 11745 - SMS'), 'GUSTAVO LUIZ SILVA CAMPOS\nCRM 11745 - SMS');
 assert.equal(canonicalDoctor('BLAYRA BORGES\nCRM 13940 -EXTRA  SMS'), 'BLAYRA BORGES BARBOSA\nCRM 13940 - EXTRA SMS');
 assert.equal(canonicalDoctor('INGRID TAVARES DE PAULA TELES\nCRM 17422 - COAPH'), 'INGRID TAVARES DE PAULA TELES\nCRM 17422 - COAPH');
 assert.equal(canonicalDoctor('JOSÉ PEDRO MARCHRY VACARI\nCRM 17422 - COAPH'), 'JOSÉ PEDRO MARCHRY VACARI\nCRM A CONFIRMAR - COAPH');
 // Quando o CRM certo do José Pedro for cadastrado, ele é mantido.
 assert.equal(canonicalDoctor('JOSÉ PEDRO MARCHRY VACARI\nCRM 12345 - COAPH'), 'JOSÉ PEDRO MARCHRY VACARI\nCRM 12345 - COAPH');
 assert.equal(canonicalDoctor(''), '');
 assert.equal(canonicalDoctor('Cobertura combinada por telefone'), 'Cobertura combinada por telefone');
});

test('os dados importados já estão padronizados e cada médico aparece uma vez na lista', () => {
 assert.deepEqual(canonicalizeDeep(seed), seed);
 const choices = doctorChoices(seed, new MemoryStore());
 assert.equal(new Set(choices.map(doctorIdentity)).size, choices.length);
 assert.equal(choices.filter(d => d.startsWith('JULIANE ZANINA')).length, 1);
 assert.equal(choices.some(d => d.startsWith('GUSTAVO LUIZ SILA ')), false);
});

test('o médico atual aparece no seletor com o vínculo do plantão; trocar o vínculo mantém nome e CRM', () => {
 const choices = doctorChoices(seed, new MemoryStore());
 const juliane = choices.find(d => d.startsWith('JULIANE ZANINA'));
 const extra = withAffiliation(juliane, 'EXTRA SMS');
 assert.equal(extra, 'JULIANE ZANINA\nCRM 15902 - EXTRA SMS');
 const options = doctorOptions(choices, extra);
 assert.equal(options.length, choices.length);
 assert.ok(options.includes(extra));
 assert.equal(options.includes(juliane) && juliane !== extra, false);
});

test('dados já salvos na conta são padronizados uma vez, sem mexer em textos que não são médicos', () => {
 const store = new MemoryStore();
 const key = 'rt-upa:' + periodKey('2026-10-03');
 store.setItem(key, JSON.stringify({'2026-10-03|13': 'GUSTAVO LUIZ SILA CAMPOS\nCRM 11745 - SMS', '2026-10-03|6': ''}));
 store.setItem('rt-upa:organizer', JSON.stringify([{kind: 'note', body: 'Ligar para\nCRM amanhã e depois', doctor: 'BLAYRA BORGES\nCRM 13940 -EXTRA  SMS'}]));
 assert.equal(canonicalizeStorage(store), 2);
 assert.equal(JSON.parse(store.getItem(key))['2026-10-03|13'], 'GUSTAVO LUIZ SILVA CAMPOS\nCRM 11745 - SMS');
 const note = JSON.parse(store.getItem('rt-upa:organizer'))[0];
 assert.equal(note.doctor, 'BLAYRA BORGES BARBOSA\nCRM 13940 - EXTRA SMS');
 assert.equal(note.body, 'Ligar para\nCRM amanhã e depois');
 assert.equal(canonicalizeStorage(store), 0);
});
