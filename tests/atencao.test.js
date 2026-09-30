import test from 'node:test';
import assert from 'node:assert/strict';
import {comparacaoPlantao, historico, indice, situacao, avaliarPlantao, atualizarAcompanhamento, registrarConversa, lerAcompanhamento} from '../src/atencao.js';
import {MemoryStore} from '../src/online-store.js';

const r = (data, turno, medico, adulto, pediatria = 0) => ({data, turno, medico, adulto, pediatria, retornos: 0, classes: {}});
const escala = [
 {nome: 'ANA LIMA', area: 'adulto', slot: 0, horas: 12}, {nome: 'BRUNO SOUZA', area: 'adulto', slot: 1, horas: 12},
 {nome: 'CAIO MENDES', area: 'adulto', slot: 2, horas: 12}, {nome: 'DORA PEDIATRA', area: 'pediatria', slot: 4, horas: 12}];

test('compara com a média dos colegas da mesma área, sem contar o próprio médico', () => {
 const lista = comparacaoPlantao([r('2026-09-28', 'D', 'ANA LIMA', 30), r('2026-09-28', 'D', 'BRUNO SOUZA', 30), r('2026-09-28', 'D', 'CAIO MENDES', 15), r('2026-09-28', 'D', 'DORA PEDIATRA', 0, 10)], escala);
 const caio = lista.find(x => x.medico === 'CAIO MENDES'), dora = lista.find(x => x.medico === 'DORA PEDIATRA');
 assert.equal(caio.mediaColegas, 30);
 assert.equal(dora.mediaColegas, null);             // pediatria sozinha: sem com quem comparar
});

test('com escala, quem não está nos consultórios (Box, cinderela) fica fora da conta', () => {
 const lista = comparacaoPlantao([r('2026-09-28', 'D', 'ANA LIMA', 30), r('2026-09-28', 'D', 'BRUNO SOUZA', 30), r('2026-09-28', 'D', 'CINDERELA X', 5)], escala);
 assert.equal(lista.length, 2);
 assert.equal(lista[0].mediaColegas, 30);
});

test('cobertura parcial conta pelas horas na escala', () => {
 const parcial = [{nome: 'ANA LIMA', area: 'adulto', horas: 12}, {nome: 'BRUNO SOUZA', area: 'adulto', horas: 6}];
 const lista = comparacaoPlantao([r('2026-09-28', 'D', 'ANA LIMA', 30), r('2026-09-28', 'D', 'BRUNO SOUZA', 15)], parcial);
 assert.equal(lista.find(x => x.medico === 'BRUNO SOUZA').ajustado, 30);
 assert.equal(lista.find(x => x.medico === 'ANA LIMA').mediaColegas, 30);
});

const semana = [];
for (const data of ['2026-09-24', '2026-09-25', '2026-09-26']) semana.push(r(data, 'D', 'ANA LIMA', 30), r(data, 'D', 'BRUNO SOUZA', 30), r(data, 'D', 'CAIO MENDES', 18));

test('índice junta os plantões: 18 contra 30 dos colegas = 60%', () => {
 const hist = historico(semana, () => escala);
 const caio = hist.find(h => h.medico === 'CAIO MENDES');
 assert.equal(caio.plantoes.length, 3);
 assert.equal(indice(caio.plantoes), 0.6);
 assert.equal(indice(caio.plantoes.slice(0, 1)), null);   // 1 plantão só não basta
});

test('entra abaixo de 85% e só sai quando alcança a média', () => {
 assert.equal(situacao(0.7), 'atencao');
 assert.equal(situacao(0.9), 'ok');
 assert.equal(situacao(0.9, 'atencao'), 'atencao');       // melhorou, mas ainda não chegou na média
 assert.equal(situacao(1.0, 'atencao'), 'ok');
 assert.equal(situacao(null), 'poucos');
 assert.equal(situacao(null, 'atencao'), 'atencao');
});

test('acompanhamento guarda quando entrou, a conversa e a saída', () => {
 const storage = new MemoryStore();
 atualizarAcompanhamento(storage, [{nome: 'CAIO MENDES', situacao: 'atencao'}], '2026-09-27');
 registrarConversa(storage, 'CAIO MENDES', '2026-09-27');
 let dados = Object.values(lerAcompanhamento(storage));
 assert.equal(dados[0].emAtencao, true);
 assert.deepEqual(dados[0].conversas, ['2026-09-27']);
 atualizarAcompanhamento(storage, [{nome: 'CAIO MENDES', situacao: 'ok'}], '2026-09-30');
 dados = Object.values(lerAcompanhamento(storage));
 assert.equal(dados[0].emAtencao, false);
 assert.equal(dados[0].saiuEm, '2026-09-30');
});

test('avaliação do plantão: quem está abaixo vem primeiro, com a evolução depois da conversa', () => {
 const storage = new MemoryStore();
 const dados = [...semana, r('2026-09-28', 'D', 'ANA LIMA', 30), r('2026-09-28', 'D', 'BRUNO SOUZA', 30), r('2026-09-28', 'D', 'CAIO MENDES', 27)];
 atualizarAcompanhamento(storage, [{nome: 'CAIO MENDES', situacao: 'atencao'}], '2026-09-26');
 registrarConversa(storage, 'CAIO MENDES', '2026-09-26');
 const agora = [r('2026-09-29', 'D', 'ANA LIMA', 12), r('2026-09-29', 'D', 'BRUNO SOUZA', 12), r('2026-09-29', 'D', 'CAIO MENDES', 4)];
 const lista = avaliarPlantao({escala, hist: historico(dados, () => escala), agora, acompanhamento: lerAcompanhamento(storage), emAndamentoHoras: 5});
 const caio = lista[0];
 assert.equal(caio.nome, 'CAIO MENDES');
 assert.equal(caio.situacao, 'atencao');          // 69% nos 4 plantões
 assert.equal(caio.indiceDepois, 0.9);            // depois da conversa: 27 de 30
 assert.equal(caio.indiceAntes, 0.6);
 assert.equal(caio.abaixoHoje, true);             // 4 contra 12 dos colegas agora
 assert.equal(lista.find(a => a.nome === 'ANA LIMA').situacao, 'ok');
});
