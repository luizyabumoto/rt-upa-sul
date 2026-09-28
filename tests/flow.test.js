import test from 'node:test';
import assert from 'node:assert/strict';
import {formatarEspera, tempoDesde} from '../src/flow.js';

test('tempo de espera em formato humano', () => {
 assert.equal(formatarEspera(0), '0 min');
 assert.equal(formatarEspera(18), '18 min');
 assert.equal(formatarEspera(47), '47 min');
 assert.equal(formatarEspera(72), '1h12');
 assert.equal(formatarEspera(125), '2h05');
 assert.equal(formatarEspera(null), '—');
});

test('"atualizado há" em segundos e minutos', () => {
 const agora = Date.parse('2026-09-28T20:00:00Z');
 assert.equal(tempoDesde('2026-09-28T19:59:48Z', agora), 'há 12 s');
 assert.equal(tempoDesde('2026-09-28T19:55:00Z', agora), 'há 5 min');
 assert.equal(tempoDesde(null, agora), 'nunca');
});
