import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {levantamento, resumoArea, textoWhatsApp, datasDoPeriodo, csvLotacao} from '../src/lotacao.js';
import {MemoryStore} from '../src/online-store.js';

const seed = JSON.parse(readFileSync(new URL('../src/seed.json', import.meta.url)));

test('período: mês inteiro e quinzenas', () => {
 assert.equal(datasDoPeriodo(2026, 10).length, 31);
 assert.equal(datasDoPeriodo(2026, 10, '1').length, 15);
 assert.equal(datasDoPeriodo(2026, 10, '2')[0], '2026-10-16');
});

test('lotação da 1ª quinzena de outubro: plantões por área somam com os vagos o que a escala pede', () => {
 const dados = levantamento(seed, new MemoryStore(), datasDoPeriodo(2026, 10, '1'));
 for (const area of ['clinico', 'infantil', 'box']) {
  const r = resumoArea(dados, area);
  const soma = Object.values(r.porVinculo).reduce((s, v) => s + v.plantoes, 0);
  assert.equal(Math.round(soma) + r.vagos, r.necessarios, area);
 }
 const box = resumoArea(dados, 'box');
 assert.equal(box.necessarios, 30);
 assert.equal(box.vagos, 5);
});

test('filtro só SMS conta só os médicos com plantão SMS na área', () => {
 const dados = levantamento(seed, new MemoryStore(), datasDoPeriodo(2026, 10, '1'));
 const todos = resumoArea(dados, 'clinico'), sms = resumoArea(dados, 'clinico', ['SMS']);
 assert.equal(sms.totalMedicos, todos.porVinculo.SMS.medicos);
 assert.ok(sms.totalMedicos < todos.totalMedicos);
 assert.ok(sms.medicos.every(m => m.areas.clinico.SMS));
});

test('para toda a escala = plantões do período ÷ carga de referência (só nas áreas de 12 h)', () => {
 const dados = levantamento(seed, new MemoryStore(), datasDoPeriodo(2026, 10));
 assert.equal(resumoArea(dados, 'clinico', undefined, 10).paraTodaEscala, 25);   // 8 × 31 = 248 plantões
 assert.equal(resumoArea(dados, 'visita', undefined, 10).paraTodaEscala, null);
});

test('texto do WhatsApp: só médicos SMS, quantos fecham a escala, quantos há e quantos faltam', () => {
 const dados = levantamento(seed, new MemoryStore(), datasDoPeriodo(2026, 10, '1'));
 const texto = textoWhatsApp(dados, '1ª quinzena de outubro de 2026', 5, 'na quinzena');
 const sms = resumoArea(dados, 'clinico', ['SMS'], 5);
 assert.match(texto, /Médico clínico para toda a escala: 24 médicos\n/);
 assert.match(texto, new RegExp(`Médico clínico atual SMS: ${sms.totalMedicos} médicos?\n`));
 assert.match(texto, new RegExp(`Faltam ${24 - sms.totalMedicos} médicos? SMS para fechar a escala`));
 assert.match(texto, /Médico infantil atual SMS/);
 assert.match(texto, /Box de emergência atual SMS/);
 assert.doesNotMatch(texto, /COAPH \d|Extra SMS \d/);
 assert.match(csvLotacao(dados, ['SMS']), /CRM-MT/);
});
