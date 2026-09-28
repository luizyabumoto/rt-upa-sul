import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryStore} from '../src/online-store.js';
import {parse} from '../src/scheduling.js';
import {registrarTroca, definirMotivo, csvHistorico} from '../src/historico.js';

const ANA = 'ANA LIMA\nCRM 1 - SMS', BIA = 'BIA COSTA\nCRM 2 - COAPH', CAIO = 'CAIO REIS\nCRM 3 - SMS';

test('registra troca manual, junta trocas seguidas no mesmo posto e ignora quando nada muda', () => {
 const store = new MemoryStore(), t0 = new Date('2026-10-01T10:00:00Z');
 registrarTroca(store, {data: '2026-10-01', slot: 2, saiu: ANA, entrou: BIA}, t0);
 registrarTroca(store, {data: '2026-10-01', slot: 2, saiu: BIA, entrou: CAIO}, new Date(t0.getTime() + 60000));
 let lista = parse(store, 'historico', []);
 assert.equal(lista.length, 1);
 assert.deepEqual([lista[0].saiu, lista[0].entrou, lista[0].origem], [ANA, CAIO, 'manual']);
 // Voltar ao original dentro da janela desfaz o registro.
 registrarTroca(store, {data: '2026-10-01', slot: 2, saiu: CAIO, entrou: ANA}, new Date(t0.getTime() + 90000));
 assert.equal(parse(store, 'historico', []).length, 0);
 assert.equal(registrarTroca(store, {data: '2026-10-01', slot: 2, saiu: ANA, entrou: ANA}), null);
 // Depois de 2 minutos, é outra troca.
 registrarTroca(store, {data: '2026-10-01', slot: 2, saiu: ANA, entrou: BIA}, t0);
 registrarTroca(store, {data: '2026-10-01', slot: 2, saiu: BIA, entrou: CAIO}, new Date(t0.getTime() + 5 * 60000));
 assert.equal(parse(store, 'historico', []).length, 2);
});

test('trocas pela produção não se juntam com as manuais; motivo e CSV', () => {
 const store = new MemoryStore();
 registrarTroca(store, {data: '2026-10-01', slot: 4, saiu: ANA, entrou: BIA, origem: 'produção'});
 registrarTroca(store, {data: '2026-10-01', slot: 4, saiu: BIA, entrou: ANA, origem: 'desfeita'});
 const lista = parse(store, 'historico', []);
 assert.deepEqual(lista.map(h => h.origem), ['produção', 'desfeita']);
 assert.ok(definirMotivo(store, lista[0].id, 'Troca combinada entre as duas'));
 const csv = csvHistorico(parse(store, 'historico', []));
 assert.match(csv, /"01\/10\/2026";"Diurno · Pediatria 1";"ANA LIMA";"BIA COSTA";"Pela produção";"Troca combinada entre as duas"/);
});
