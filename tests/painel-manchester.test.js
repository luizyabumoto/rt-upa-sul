import test from 'node:test';
import assert from 'node:assert/strict';
import {coresDoPainel, situacaoRisco} from '../src/flow.js';

test('as cinco cores aparecem sempre, na ordem de gravidade, mesmo com zero', () => {
 const cores = coresDoPainel([{chave: 'verde', nome: 'Verde', aguardando: 4, maiorEspera: 30, adulto: 3, pediatria: 1}]);
 assert.deepEqual(cores.map(c => c.chave), ['vermelho', 'laranja', 'amarelo', 'verde', 'azul']);
 assert.equal(cores[3].aguardando, 4);
 assert.equal(cores[0].aguardando, 0);
});

test('situação: vazio, ok, atenção (75% do alvo) e alerta (passou do alvo)', () => {
 assert.equal(situacaoRisco({chave: 'amarelo', aguardando: 0, maiorEspera: null}), 'vazio');
 assert.equal(situacaoRisco({chave: 'amarelo', aguardando: 2, maiorEspera: 20}), 'ok');
 assert.equal(situacaoRisco({chave: 'amarelo', aguardando: 2, maiorEspera: 50}), 'atencao');
 assert.equal(situacaoRisco({chave: 'amarelo', aguardando: 2, maiorEspera: 61}), 'alerta');
 assert.equal(situacaoRisco({chave: 'vermelho', aguardando: 1, maiorEspera: 1}), 'alerta');
});

test('cor fora de Manchester só aparece se tiver alguém', () => {
 const cores = coresDoPainel([{chave: 'roxo', nome: 'Roxo', aguardando: 0}, {chave: 'cinza', nome: 'Cinza', aguardando: 1, maiorEspera: 5}]);
 assert.deepEqual(cores.slice(5).map(c => c.chave), ['cinza']);
});
