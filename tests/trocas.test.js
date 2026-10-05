import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MemoryStore} from '../src/online-store.js';
import {baseDoctor, parse} from '../src/scheduling.js';
import {detectar, postosDoPlantao, outrosDoPlantao, aplicarTrocas, aplicarSugestao, ignorarSugestao, desfazer, manter, plantoesParaVerificar} from '../src/trocas.js';
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
 assert.deepEqual(detectar(postos, [...base, {medico: 'DORA', adulto: 0, pediatria: 2}]), {automaticas: [], suspeitas: []});
 // Com poucas consultas vira sugestão (com o par proposto), não troca automática.
 const pouco = detectar(postos, [...base, {medico: 'DORA', adulto: 0, pediatria: 3}]);
 assert.deepEqual(pouco.automaticas, []);
 assert.deepEqual(pouco.suspeitas[0].pares.map(t => [t.slot, t.entrou]), [[4, 'DORA']]);
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

// Caso real do noturno de 29/09/2026: Clínico 4 vago, Ana Paula (licença) sem consultas, Thaís Koester sem
// consultas na pediatria; atenderam de fora Maria Clara, Marcela (adulto) e Yuris (pediatria, 4 consultas).
const NOITE = {data: '2026-09-29', turno: 'N'};
const producaoNoite = [
 {medico: 'JULIANE ZANINA', adulto: 12, pediatria: 0}, {medico: 'LETICIA ILKIU FRANCELINO', adulto: 4, pediatria: 0},
 {medico: 'THAIS GUIMARAES DE SOUZA', adulto: 0, pediatria: 4}, {medico: 'MARIA CLARA TRETTEL DE OLIVEIRA', adulto: 6, pediatria: 0},
 {medico: 'MARCELA BRINGEL FRANCO', adulto: 5, pediatria: 0}, {medico: 'YURIS CAROLINA RIVERO BRITO', adulto: 0, pediatria: 4},
 // Box e Cinderela atendem nos consultórios e não são "de fora".
 {medico: 'LUCAS DE LA CRUZ MOTA', adulto: 7, pediatria: 0}];

test('posto vago + escalado sem consulta são preenchidos por quem atendeu de fora', () => {
 const store = new MemoryStore();
 assert.equal(baseDoctor(seed, store, NOITE.data, 10), '');
 assert.ok(outrosDoPlantao(seed, store, NOITE.data, 'N').some(d => d.startsWith('LUCAS DE LA CRUZ MOTA')));
 const r = aplicarTrocas(seed, store, NOITE, producaoNoite);
 assert.equal(r.mudou, true);
 // Adulto: 2 postos (vago + Ana Paula) e 2 médicos de fora com 5+ consultas → automático.
 const adulto = [9, 10].map(slot => nome(baseDoctor(seed, store, NOITE.data, slot))).sort();
 assert.deepEqual(adulto, ['MARCELA BRINGEL FRANCO', 'MARIA CLARA TRETTEL DE OLIVEIRA']);
 const historico = parse(store, 'trocas', []);
 assert.equal(historico.find(h => h.slot === 10).saiu, '');
 assert.match(historico.find(h => h.slot === 9).saiu, /^ANA PAULA MACHADO/);
 // Pediatria: Yuris só com 4 consultas → sugestão para o RT aplicar.
 assert.equal(r.suspeitas.length, 1);
 const s = r.suspeitas[0];
 assert.equal(s.area, 'pediatria');
 assert.deepEqual(s.pares.map(t => [t.slot, t.entrou]), [[12, 'YURIS CAROLINA RIVERO BRITO']]);
 assert.equal(aplicarSugestao(seed, store, NOITE, s.pares), 1);
 assert.match(baseDoctor(seed, store, NOITE.data, 12), /^YURIS CAROLINA RIVERO BRITO\nCRM 16442/);
 // Nada novo depois de aplicado.
 const denovo = aplicarTrocas(seed, store, NOITE, producaoNoite);
 assert.equal(denovo.mudou, false);
 assert.deepEqual(denovo.suspeitas, []);
});

test('sugestão ignorada não volta a aparecer', () => {
 const store = new MemoryStore();
 const r = aplicarTrocas(seed, store, NOITE, producaoNoite);
 ignorarSugestao(store, NOITE, r.suspeitas[0].pares);
 assert.deepEqual(aplicarTrocas(seed, store, NOITE, producaoNoite).suspeitas, []);
 assert.match(baseDoctor(seed, store, NOITE.data, 12), /^THAÍS KOESTER/);
});

test('troca no meio do plantão: escalado parou e alguém de fora assumiu logo depois', () => {
 const store = new MemoryStore();
 const postos = postosDoPlantao(seed, store, DATA, 'D');
 const clinico = postos.find(p => p.slot === 0), ped = postos.find(p => p.slot === 4);
 const registros = postos.filter(p => p.doctor).map(p => ({medico: nome(p.doctor), data: DATA, turno: 'D', adulto: p.area === 'adulto' ? 20 : 0, pediatria: p.area === 'pediatria' ? 20 : 0, primeiro: `${DATA}T07:10`, ultimo: `${DATA}T18:40`}));
 // Clínico 1 atendeu só até 09h05; LILIANE (fora da escala) começou às 09h20.
 Object.assign(registros.find(r => r.medico === nome(clinico.doctor)), {adulto: 14, ultimo: `${DATA}T09:05`});
 registros.push({medico: 'LILIANE CRISTINA DA SILVA SOUZA', data: DATA, turno: 'D', adulto: 12, pediatria: 0, primeiro: `${DATA}T09:20`, ultimo: `${DATA}T18:30`});
 const r = detectar(postos, registros, [], Date.parse(`${DATA}T17:00:00-04:00`));
 assert.equal(r.automaticas.length, 1);
 assert.deepEqual({slot: r.automaticas[0].slot, entrou: r.automaticas[0].entrou, desde: r.automaticas[0].desde, parouAs: r.automaticas[0].parouAs}, {slot: 0, entrou: 'LILIANE CRISTINA DA SILVA SOUZA', desde: '09:20', parouAs: '09:05'});
 // Pediatra que fez só a manhã e outra que chegou à tarde (incomum, mas acontece): também é reconhecido.
 Object.assign(registros.find(r => r.medico === nome(ped.doctor)), {pediatria: 17, ultimo: `${DATA}T12:50`});
 registros.push({medico: 'MARIANA MENEZES RONDON', data: DATA, turno: 'D', adulto: 0, pediatria: 12, primeiro: `${DATA}T13:05`, ultimo: `${DATA}T18:50`});
 const r2 = detectar(postos, registros, [], Date.parse(`${DATA}T19:30:00-04:00`));
 assert.ok(r2.automaticas.some(t => t.slot === 4 && t.entrou === 'MARIANA MENEZES RONDON' && t.desde === '13:05'));
 // Quem parou há menos de 2 h (pode estar na sala vermelha) ainda não vira troca.
 const r3 = detectar(postos, registros, [], Date.parse(`${DATA}T10:30:00-04:00`));
 assert.ok(!r3.automaticas.some(t => t.slot === 0));
});

test('cinderela de fora da escala não toma o posto de clínico de 12 h', () => {
 const store = new MemoryStore();
 const postos = postosDoPlantao(seed, store, DATA, 'D');
 const clinico = postos.find(p => p.slot === 2);
 const reg = (medico, adulto, primeiro, ultimo = `${DATA}T18:40`) => ({medico, data: DATA, turno: 'D', adulto, pediatria: 0, primeiro: `${DATA}T${primeiro}`, ultimo});
 const registros = postos.filter(p => p.doctor && p.slot !== 2).map(p => ({medico: nome(p.doctor), data: DATA, turno: 'D', adulto: p.area === 'adulto' ? 20 : 0, pediatria: p.area === 'pediatria' ? 20 : 0, primeiro: `${DATA}T07:10`, ultimo: `${DATA}T18:40`}));
 // Clínico 3 faltou; JOSÉ fez o plantão inteiro; DENIS e LUCAS chegaram ao meio-dia (cinderelas).
 registros.push(reg('JOSE PEDRO TESTE', 30, '07:20'), reg('DENIS TESTE', 25, '12:05'), reg('LUCAS TESTE', 28, '11:10'));
 const r = detectar(postos, registros, [], Date.parse(`${DATA}T19:30:00-04:00`), [{slot: 14, doctor: ''}, {slot: 15, doctor: ''}]);
 const noClinico = [...r.automaticas, ...r.suspeitas.flatMap(s => s.pares)].filter(t => t.slot === clinico.slot);
 assert.deepEqual(noClinico.map(t => t.entrou), ['JOSE PEDRO TESTE']);
 const nasCinderelas = r.automaticas.filter(t => t.slot >= 14).map(t => t.entrou).sort();
 assert.deepEqual(nasCinderelas, ['DENIS TESTE', 'LUCAS TESTE']);
});
