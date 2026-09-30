import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MemoryStore} from '../src/online-store.js';
import {faltasETrocas} from '../src/production.js';
import {aplicarTrocas} from '../src/trocas.js';
const seed = JSON.parse(readFileSync(new URL('../src/seed.json', import.meta.url), 'utf8'));

// Noturno de 29/09/2026: Ana Paula (licença) e Thaís Koester sem consultas, Clínico 4 vago;
// Maria Clara e Marcela atenderam no adulto, Yuris na pediatria.
const NOITE = {data: '2026-09-29', turno: 'N'};
const reg = (medico, adulto, pediatria) => ({data: NOITE.data, turno: 'N', medico, adulto, pediatria, retornos: 0, classes: {}});
const registros = [reg('JULIANE ZANINA', 12, 0), reg('LETICIA ILKIU FRANCELINO', 4, 0), reg('THAIS GUIMARAES DE SOUZA', 0, 4),
 reg('MARIA CLARA TRETTEL DE OLIVEIRA', 6, 0), reg('MARCELA BRINGEL FRANCO', 5, 0), reg('YURIS CAROLINA RIVERO BRITO', 0, 4)];
const DEPOIS = Date.parse('2026-09-30T07:00:00-04:00');
const resumo = linhas => linhas.map(l => [l.slot, l.tipo, l.escalado.split(' ')[0], l.substituto.split(' ')[0]]);

test('antes das trocas: faltas aparecem com a sugestão de quem atendeu no lugar', () => {
 const linhas = faltasETrocas(seed, new MemoryStore(), registros, [NOITE], DEPOIS);
 assert.deepEqual(resumo(linhas), [[9, 'falta', 'ANA', 'MARCELA'], [10, 'vaga', '', 'MARIA'], [12, 'falta', 'THAÍS', 'YURIS']]);
 assert.ok(linhas.every(l => l.sugestao));
});

test('depois da troca automática a falta continua aparecendo, como troca detectada pela produção', () => {
 const store = new MemoryStore();
 aplicarTrocas(seed, store, NOITE, registros);
 const linhas = faltasETrocas(seed, store, registros, [NOITE], DEPOIS);
 const adulto = linhas.filter(l => l.slot < 11);
 assert.deepEqual(adulto.map(l => [l.slot, l.tipo]), [[9, 'producao'], [10, 'vaga']]);
 assert.match(adulto[0].escalado, /^ANA PAULA/);
 // Quem entrou aparece com as consultas que fez no plantão.
 assert.deepEqual(adulto.map(l => [l.substituto.split(' ')[0], l.consultasSubstituto]), [['MARCELA', 5], ['MARIA', 6]]);
 assert.equal(linhas.find(l => l.slot === 12).tipo, 'falta');
});

test('cobertura confirmada justifica; plantão com menos de 2 horas não entra', () => {
 const store = new MemoryStore({'rt-upa:coverages': JSON.stringify([{id: 'c', date: NOITE.data, slot: 12, start: 19, end: 31, doctor: 'YURIS CAROLINA RIVERO BRITO\nCRM 16442 - COAPH', original: 'THAÍS KOESTER CONCEIÇÃO\nCRM 17281 - COAPH', confirmed: true}])});
 const linha = faltasETrocas(seed, store, registros, [NOITE], DEPOIS).find(l => l.slot === 12);
 assert.equal(linha.tipo, 'cobertura');
 assert.deepEqual(faltasETrocas(seed, store, registros, [NOITE], Date.parse('2026-09-29T20:00:00-04:00')), []);
});

test('Escala × produção usa a escala original: quem faltou continua lá depois da troca automática', async () => {
 const {escaladosOriginais} = await import('../src/production.js');
 const store = new MemoryStore();
 aplicarTrocas(seed, store, NOITE, registros);
 const nomes = escaladosOriginais(seed, store, NOITE.data, 'N');
 assert.ok(nomes.some(n => n.startsWith('ANA PAULA')));
 assert.ok(!nomes.some(n => n.startsWith('MARCELA')));
});
