import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryStore} from '../src/online-store.js';

test('os dados de duas contas não compartilham armazenamento no navegador', () => {
  const alice = new MemoryStore({'rt-upa:doctors':'["A"]'});
  const bob = new MemoryStore();
  alice.setItem('rt-upa:fixed', '[]');
  assert.equal(bob.length, 0);
  assert.equal(bob.getItem('rt-upa:doctors'), null);
});

test('backup conserva o formato original e remoção sinaliza alterações pendentes', () => {
  let changes = 0;
  const store = new MemoryStore({}, () => changes++);
  store.setItem('rt-upa:doctors', '["A"]');
  assert.deepEqual(store.snapshot(), {'rt-upa:doctors':'["A"]'});
  store.removeItem('rt-upa:doctors');
  assert.equal(changes, 2);
  assert.deepEqual(store.snapshot(), {});
});

import {mergeItems} from '../src/online-store.js';

test('junção com outro aparelho: registro mudado só de um lado fica com esse lado', () => {
 const base = {'rt-upa:fixed': '[]', 'rt-upa:doctors': '["A"]'};
 const local = {'rt-upa:fixed': '[1]', 'rt-upa:doctors': '["A"]'};
 const remoto = {'rt-upa:fixed': '[]', 'rt-upa:doctors': '["A","B"]'};
 assert.deepEqual(mergeItems(base, local, remoto), {'rt-upa:fixed': '[1]', 'rt-upa:doctors': '["A","B"]'});
});

test('junção: a mesma quinzena editada nos dois aparelhos junta posto a posto', () => {
 const k = 'rt-upa:edits:2026:10:1';
 const base = {[k]: JSON.stringify({'2026-10-01|0': 'ANA'})};
 const local = {[k]: JSON.stringify({'2026-10-01|0': 'ANA', '2026-10-02|1': 'BRUNO'})};
 const remoto = {[k]: JSON.stringify({'2026-10-01|0': 'ANA', '2026-10-03|2': 'CAIO'})};
 assert.deepEqual(JSON.parse(mergeItems(base, local, remoto)[k]), {'2026-10-01|0': 'ANA', '2026-10-02|1': 'BRUNO', '2026-10-03|2': 'CAIO'});
});

test('junção: listas com id juntam item a item, respeitando o que foi apagado aqui', () => {
 const k = 'rt-upa:organizer';
 const base = {[k]: JSON.stringify([{id: 'a', t: 1}, {id: 'b', t: 1}])};
 const local = {[k]: JSON.stringify([{id: 'a', t: 2}, {id: 'c', t: 1}])};           // mudou a, apagou b, criou c
 const remoto = {[k]: JSON.stringify([{id: 'a', t: 1}, {id: 'b', t: 1}, {id: 'd', t: 1}])};  // outro criou d
 assert.deepEqual(JSON.parse(mergeItems(base, local, remoto)[k]).map(x => `${x.id}${x.t}`).sort(), ['a2', 'c1', 'd1']);
});

test('junção: registro novo dos dois lados e registro apagado aqui', () => {
 assert.deepEqual(mergeItems({'rt-upa:x': '1'}, {}, {'rt-upa:x': '1', 'rt-upa:y': '2'}), {'rt-upa:y': '2'});
});
