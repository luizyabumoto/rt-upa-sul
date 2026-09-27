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
