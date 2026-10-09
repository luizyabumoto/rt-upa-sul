import test from 'node:test';
import assert from 'node:assert/strict';
import {rankingProporcional, pesoPlantao} from '../src/production.js';

const reg = (medico, data, turno, adulto, primeiro = `${data}T07:30`, ultimo = `${data}T18:30`) =>
 ({medico, data, turno, adulto, pediatria: 0, retornos: 0, classes: {}, primeiro, ultimo});

test('quem fez mais plantões não ganha só pelo total: vale a média por plantão', () => {
 const registros = [
  ...Array.from({length: 10}, (_, i) => reg('MUITOS PLANTOES', `2026-10-${String(i + 1).padStart(2, '0')}`, 'D', 30)),   // 300 em 10 = 30
  reg('POUCOS PLANTOES', '2026-10-01', 'N', 45), reg('POUCOS PLANTOES', '2026-10-02', 'N', 45),                         // 90 em 2 = 45
 ];
 const {ranking, mediaUnidade} = rankingProporcional(registros);
 assert.deepEqual(ranking.map(m => m.medico), ['POUCOS PLANTOES', 'MUITOS PLANTOES']);
 assert.equal(ranking[0].porPlantao, 45);
 assert.equal(Math.round(mediaUnidade * 10) / 10, 32.5);   // 390 consultas / 12 plantões
});

test('plantão curto (até 7 h de atendimento: cinderela, saiu no meio) conta como meio plantão', () => {
 assert.equal(pesoPlantao(reg('X', '2026-10-01', 'D', 10, '2026-10-01T11:00', '2026-10-01T17:00')), 0.5);
 assert.equal(pesoPlantao(reg('X', '2026-10-01', 'D', 10)), 1);
 const {ranking} = rankingProporcional([
  reg('CINDERELA', '2026-10-01', 'D', 15, '2026-10-01T11:00', '2026-10-01T17:00'),
  reg('CINDERELA', '2026-10-02', 'D', 15, '2026-10-02T11:00', '2026-10-02T17:00'),
  reg('CINDERELA', '2026-10-03', 'D', 15, '2026-10-03T11:00', '2026-10-03T17:00'),
  reg('CINDERELA', '2026-10-04', 'D', 15, '2026-10-04T11:00', '2026-10-04T17:00'),
 ]);
 assert.equal(ranking[0].plantoes, 2);          // 4 meios plantões = 2 plantões
 assert.equal(ranking[0].porPlantao, 30);       // 60 consultas / 2
});

test('menos de 2 plantões fica fora do ranking (um plantão só não diz muito)', () => {
 const {ranking, poucos} = rankingProporcional([reg('UM PLANTAO', '2026-10-01', 'D', 60), reg('B', '2026-10-01', 'D', 20), reg('B', '2026-10-02', 'D', 20)]);
 assert.deepEqual(ranking.map(m => m.medico), ['B']);
 assert.deepEqual(poucos.map(m => m.medico), ['UM PLANTAO']);
});

test('plantão sem consulta (só retorno) não conta', () => {
 const {ranking} = rankingProporcional([reg('A', '2026-10-01', 'D', 20), reg('A', '2026-10-02', 'D', 20), {...reg('A', '2026-10-03', 'D', 0), retornos: 5}]);
 assert.equal(ranking[0].plantoes, 2);
});
