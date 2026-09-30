import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {levantamento, resumoArea, textoWhatsApp, datasDoPeriodo, csvLotacao, lotacaoSMS, resumoLotacao, salvarLotacao} from '../src/lotacao.js';
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

test('para toda a escala = postos por dia × 7 ÷ 2 plantões por médico na semana: 28, 14 e 7', () => {
 const dados = levantamento(seed, new MemoryStore(), datasDoPeriodo(2026, 10, '1'));
 assert.equal(resumoArea(dados, 'clinico').paraTodaEscala, 28);
 assert.equal(resumoArea(dados, 'infantil').paraTodaEscala, 14);
 assert.equal(resumoArea(dados, 'box').paraTodaEscala, 7);
 assert.equal(resumoArea(dados, 'visita').paraTodaEscala, null);
 assert.equal(resumoArea(dados, 'clinico', undefined, 3).paraTodaEscala, 19);
});

test('lotação SMS: médico de licença continua contando e o ajuste do RT vale', () => {
 const storage = new MemoryStore();
 const antes = resumoLotacao(lotacaoSMS(seed, storage, '2026-10-20'));
 const ana = lotacaoSMS(seed, storage, '2026-10-20').find(m => m.nome.startsWith('ANA PAULA MACHADO'));
 salvarLotacao(storage, d => { d.medicos[ana.id] = {nome: ana.nome, area: 'clinico', situacao: 'licenca-maternidade'}; });
 const lista = lotacaoSMS(seed, storage, '2026-10-20'), depois = resumoLotacao(lista);
 const clin = depois.find(r => r.chave === 'clinico');
 assert.ok(clin.medicos.some(m => m.id === ana.id && m.situacao === 'licenca-maternidade'));
 assert.equal(clin.atual, antes.find(r => r.chave === 'clinico').atual + (ana.area === 'clinico' ? 0 : 1));
 assert.equal(clin.faltam, 28 - clin.atual);
 // Tirar alguém da conta
 const juliane = lista.find(m => m.nome === 'JULIANE ZANINA');
 if (juliane) {
  salvarLotacao(storage, d => { d.medicos[juliane.id] = {nome: juliane.nome, area: 'fora', situacao: 'ativo'}; });
  assert.equal(resumoLotacao(lotacaoSMS(seed, storage, '2026-10-20')).find(r => r.chave === 'clinico').atual, clin.atual - (juliane.area === 'clinico' ? 1 : 0));
 }
});

test('texto do WhatsApp no formato da Secretaria, só SMS', () => {
 const storage = new MemoryStore();
 const lista = lotacaoSMS(seed, storage, '2026-10-20'), r = resumoLotacao(lista);
 const texto = textoWhatsApp(lista, 2, '2026-10-20');
 const n = chave => r.find(x => x.chave === chave).atual;
 assert.match(texto, /Médico clínico para toda a escala: 28\n/);
 assert.match(texto, new RegExp(`Médico clínico atual SMS: ${n('clinico')}\n`));
 assert.match(texto, /Médico clínico infantil para toda a escala: 14\n/);
 assert.match(texto, new RegExp(`Médico infantil atual SMS: ${n('infantil')}\n`));
 assert.match(texto, /Médico Box de emergência para toda a escala: 7\n/);
 assert.match(texto, new RegExp(`Médico Box de emergência atual SMS: ${n('box')}`));
 assert.doesNotMatch(texto, /COAPH|Extra/);
 const dados = levantamento(seed, storage, datasDoPeriodo(2026, 10, '1'));
 assert.match(csvLotacao(dados, ['SMS']), /CRM-MT/);
});
