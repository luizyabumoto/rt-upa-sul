import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryStore} from '../src/online-store.js';

// localStorage falso para os testes (o módulo usa o global).
globalThis.localStorage = {_m: {}, getItem(k) { return k in this._m ? this._m[k] : null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; }};
const {salvarVersao, restaurarVersao} = await import('../src/versoes.js');

test('guarda versões sem duplicar e restaura o estado antigo', () => {
 localStorage._m = {};
 const s = new MemoryStore();
 s.setItem('rt-upa:edits:2026:10:1', JSON.stringify({'2026-10-01|0': 'DR ORIGINAL'}));
 s.setItem('rt-upa:roster', JSON.stringify([{id: 'a'}]));
 salvarVersao(s, new Date('2026-10-01T10:00'));
 salvarVersao(s, new Date('2026-10-01T10:01'));           // idêntico: não cria nova versão
 s.setItem('rt-upa:edits:2026:10:1', JSON.stringify({'2026-10-01|0': 'DR NOVO'}));
 s.removeItem('rt-upa:roster');
 salvarVersao(s, new Date('2026-10-01T10:05'));
 const v = JSON.parse(localStorage.getItem('rt-versoes'));
 assert.equal(v.length, 2);
 restaurarVersao(s, v[v.length - 1].s);                   // a mais antiga
 assert.equal(JSON.parse(s.getItem('rt-upa:edits:2026:10:1'))['2026-10-01|0'], 'DR ORIGINAL');
 assert.equal(s.getItem('rt-upa:roster'), '[{"id":"a"}]');   // chave removida volta ao restaurar
});

test('não guarda retrato vazio', () => {
 localStorage._m = {};
 salvarVersao(new MemoryStore(), new Date());
 assert.equal(localStorage.getItem('rt-versoes'), null);
});
