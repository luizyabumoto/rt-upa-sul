import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MemoryStore} from '../src/online-store.js';
import {baseDoctor, parse} from '../src/scheduling.js';
import {detectar, postosDoPlantao, aplicarTrocas, desfazer, manter, plantoesParaVerificar} from '../src/trocas.js';
const seed = JSON.parse(readFileSync(new URL('../src/seed.json', import.meta.url), 'utf8'));
const DATA = '2026-10-01', PLANTAO = {data: DATA, turno: 'D'};
const nome = d => d.split('\n')[0];

// Produção simulada: todos os escalados atendem, menos o da Pediatria 1; entra alguém de fora na pediatria.
function cenario(store, quemEntra, consultas = 16) {
 const postos = postosDoPlantao(seed, store, DATA, 'D');
 const saiu = postos.find(p => p.slot === 4).doctor;
 const registros = postos.filter(p => p.slot !== 4 && p.doctor).map(p => ({medico: nome(p.doctor), adulto: p.area === 'adulto' ? 20 : 0, pediatria: p.area === 'pediatria' ? 20 : 0}));
 registros.push({medico: quemEntra, adulto: 0, pediatria: consultas});
 return {saiu, registros};
}

test('troca sem dúvida é aplicada na escala do dia e não se repete', () => {
 const store = new MemoryStore();
 const {saiu, registros} = cenario(store, 'THIAGO KENJI UEDA');
 const r = aplicarTrocas(seed, store, PLANTAO, registros, new Date('2026-10-01T15:00:00Z'));
 assert.equal(r.mudou, true);
 assert.deepEqual(r.suspeitas, []);
 assert.match(baseDoctor(seed, store, DATA, 4), /^THIAGO KENJI UEDA\nCRM 11216/);
 const historico = parse(store, 'trocas', []);
 assert.equal(historico.length, 1);
 assert.equal(historico[0].saiu, saiu);
 assert.equal(historico[0].status, 'aplicada');
 assert.equal(historico[0].consultas, 16);
 // Rodar de novo não duplica.
 assert.equal(aplicarTrocas(seed, store, PLANTAO, registros).mudou, false);
 assert.equal(parse(store, 'trocas', []).length, 1);
});

test('desfazer devolve o médico original e a troca não volta a ser aplicada', () => {
 const store = new MemoryStore();
 const {saiu, registros} = cenario(store, 'THIAGO KENJI UEDA');
 aplicarTrocas(seed, store, PLANTAO, registros);
 const id = parse(store, 'trocas', [])[0].id;
 assert.ok(desfazer(store, id));
 assert.equal(baseDoctor(seed, store, DATA, 4), saiu);
 assert.equal(aplicarTrocas(seed, store, PLANTAO, registros).mudou, false);
 assert.equal(parse(store, 'trocas', [])[0].status, 'desfeita');
 assert.equal(manter(store, id), false);
});

test('médico fora do cadastro entra com o nome do Gestor, o vínculo de quem saiu e CRM a confirmar', () => {
 const store = new MemoryStore();
 const {saiu, registros} = cenario(store, 'MARIANA MENEZES RONDON');
 const r = aplicarTrocas(seed, store, PLANTAO, registros);
 assert.equal(r.mudou, true);
 const vinculo = saiu.split(' - ').at(-1);
 assert.equal(baseDoctor(seed, store, DATA, 4), `MARIANA MENEZES RONDON\nCRM A CONFIRMAR - ${vinculo}`);
 assert.ok(parse(store, 'doctors', []).includes(`MARIANA MENEZES RONDON\nCRM A CONFIRMAR - ${vinculo}`));
});

test('com dúvida (dois de fora ou poucas consultas) não troca sozinho', () => {
 const postos = [{slot: 4, area: 'pediatria', doctor: 'ANA\nCRM 1 - SMS'}, {slot: 5, area: 'pediatria', doctor: 'BIA\nCRM 2 - SMS'}, {slot: 0, area: 'adulto', doctor: 'CARLA\nCRM 3 - SMS'}];
 const base = [{medico: 'BIA', adulto: 0, pediatria: 10}, {medico: 'CARLA', adulto: 20, pediatria: 0}];
 assert.equal(detectar(postos, [...base, {medico: 'DORA', adulto: 0, pediatria: 8}, {medico: 'EVA', adulto: 0, pediatria: 7}]).suspeitas.length, 1);
 assert.deepEqual(detectar(postos, [...base, {medico: 'DORA', adulto: 0, pediatria: 3}]), {automaticas: [], suspeitas: []});
 const certo = detectar(postos, [...base, {medico: 'DORA', adulto: 0, pediatria: 8}]);
 assert.deepEqual(certo.automaticas.map(t => [t.slot, t.entrou, t.consultas]), [[4, 'DORA', 8]]);
 // Clínico ajudando na pediatria não conta como "sem consulta".
 assert.deepEqual(detectar(postos, [{medico: 'ANA', adulto: 12, pediatria: 0}, ...base, {medico: 'DORA', adulto: 0, pediatria: 8}]).automaticas, []);
});

test('plantão em andamento só é verificado depois de 2 horas', () => {
 const cedo = plantoesParaVerificar(new Date('2026-09-28T08:30:00-04:00'));
 assert.deepEqual(cedo.map(p => `${p.data}${p.turno}`), ['2026-09-27N']);
 const depois = plantoesParaVerificar(new Date('2026-09-28T10:00:00-04:00'));
 assert.deepEqual(depois.map(p => `${p.data}${p.turno}`), ['2026-09-27N', '2026-09-28D']);
 assert.deepEqual(depois[0], {data: '2026-09-27', turno: 'N', inicio: '2026-09-27T19:00', fim: '2026-09-28T07:00'});
});
