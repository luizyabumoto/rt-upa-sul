import test from 'node:test';
import assert from 'node:assert/strict';
import {templateMap} from '../src/template-map.js';

test('outubro primeira quinzena reproduz posição dos dias no Excel recebido',()=>{
 const rows=templateMap(2026,10,1);
 assert.deepEqual([rows[0].dayCell,rows[0].shiftCells[0],rows[0].shiftCells[13]],['F4','F5','F18']);
 assert.equal(rows[4].dayCell,'C20');
 assert.equal(rows[11].dayCell,'C36');
 assert.equal(rows.at(-1).dayCell,'F36');
});
test('segunda quinzena de setembro começa quarta, dia 16',()=>{
 assert.equal(templateMap(2026,9,2)[0].dayCell,'E4');
});
test('segunda quinzena de outubro termina sábado, dia 31',()=>{
 assert.equal(templateMap(2026,10,2).at(-1).dayCell,'H36');
});
