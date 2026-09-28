import test from 'node:test';
import assert from 'node:assert/strict';
import {plantaoAtual, periodo, ranking, grupos, mesmoMedico, csv} from '../src/production.js';

// Horários em Cuiabá (UTC-4): 16:40 local = 20:40Z.
const em = local => new Date(`${local}:00-04:00`);

test('plantão atual: diurno 07h–19h e noturno 19h–07h, que pertence ao dia em que começou', () => {
 assert.deepEqual(plantaoAtual(em('2026-09-28T16:40')), {inicio: '2026-09-28T07:00', data: '2026-09-28', turno: 'D'});
 assert.deepEqual(plantaoAtual(em('2026-09-28T07:00')), {inicio: '2026-09-28T07:00', data: '2026-09-28', turno: 'D'});
 assert.deepEqual(plantaoAtual(em('2026-09-28T19:00')), {inicio: '2026-09-28T19:00', data: '2026-09-28', turno: 'N'});
 assert.deepEqual(plantaoAtual(em('2026-09-29T03:10')), {inicio: '2026-09-28T19:00', data: '2026-09-28', turno: 'N'});
 assert.deepEqual(plantaoAtual(em('2026-10-01T06:59')), {inicio: '2026-09-30T19:00', data: '2026-09-30', turno: 'N'});
});

test('períodos prontos', () => {
 const agora = em('2026-09-28T16:40');
 assert.deepEqual(periodo('atual', agora), {inicio: '2026-09-28T07:00', fim: 'agora'});
 assert.deepEqual(periodo('anterior', agora), {inicio: '2026-09-27T19:00', fim: '2026-09-28T07:00'});
 assert.deepEqual(periodo('ontem', agora), {inicio: '2026-09-27T07:00', fim: '2026-09-28T07:00'});
 assert.deepEqual(periodo('semana', agora), {inicio: '2026-09-22T07:00', fim: 'agora'});
 assert.deepEqual(periodo('mes', agora), {inicio: '2026-09-01T07:00', fim: 'agora'});
 assert.deepEqual(periodo('mesPassado', agora), {inicio: '2026-08-01T07:00', fim: '2026-09-01T07:00'});
 // De madrugada, "hoje" ainda é o dia que começou às 07h de ontem.
 assert.deepEqual(periodo('hoje', em('2026-09-29T03:00')), {inicio: '2026-09-28T07:00', fim: 'agora'});
 assert.deepEqual(periodo('mesPassado', em('2026-01-10T10:00')), {inicio: '2025-12-01T07:00', fim: '2026-01-01T07:00'});
});

const registros = [
 {data: '2026-09-28', turno: 'D', medico: 'ANA', adulto: 20, pediatria: 0, retornos: 2, classes: {urgente: 5, poucoUrgente: 15}},
 {data: '2026-09-28', turno: 'N', medico: 'ANA', adulto: 10, pediatria: 0, retornos: 0, classes: {prioridade: 10}},
 {data: '2026-09-28', turno: 'D', medico: 'BIA', adulto: 0, pediatria: 25, retornos: 0, classes: {poucoUrgente: 25}},
 {data: '2026-09-29', turno: 'D', medico: 'ROBÔ', adulto: 0, pediatria: 0, retornos: 700, classes: {}},
];

test('ranking conta só consultas; retornos ficam à parte e não sobem ninguém', () => {
 const r = ranking(registros);
 assert.deepEqual(r.map(m => [m.medico, m.total, m.plantoes, m.mediaPlantao]), [['ANA', 30, 2, 15], ['BIA', 25, 1, 25], ['ROBÔ', 0, 0, 0]]);
 assert.deepEqual(r[0].classes, {urgente: 5, poucoUrgente: 15, prioridade: 10});
 assert.equal(r[0].retornos, 2);
 assert.equal(r[2].retornos, 700);
});

test('agrupamentos por plantão, dia, semana e mês', () => {
 assert.deepEqual(grupos(registros, 'plantao').map(g => [g.rotulo, g.total, g.top[0]?.medico]),
  [['28/09/2026 · Diurno 07h–19h', 45, 'BIA'], ['28/09/2026 · Noturno 19h–07h', 10, 'ANA'], ['29/09/2026 · Diurno 07h–19h', 0, undefined]]);
 assert.deepEqual(grupos(registros, 'semana').map(g => [g.rotulo, g.total, g.medicos]), [['Semana de 28/09/2026', 55, 2]]);
 assert.deepEqual(grupos(registros, 'mes').map(g => g.rotulo), ['09/2026']);
});

test('nome da escala x nome do Gestor Saúde', () => {
 assert.ok(mesmoMedico('MARIA CLARA TRETTEL\nCRM 17525 - COAPH', 'MARIA CLARA TRETTEL DE OLIVEIRA'));
 assert.ok(mesmoMedico('LUIS EDUARDO BRESCANCIM', 'LUÍS EDUARDO BRESCANCIM'));
 assert.ok(!mesmoMedico('LUCAS PICHININ', 'LUCAS DE LA CRUZ MOTA'));
 assert.ok(!mesmoMedico('ANA', 'ANA PAULA MACHADO'), 'um nome só não basta');
});

test('CSV para Excel em português', () => {
 const texto = csv(ranking(registros), 'Plantão atual');
 assert.ok(texto.startsWith('﻿'));
 assert.match(texto, /"1";"ANA";"30";"30";"0";"2";"15"/);
 assert.match(texto, /Retornos baixados \(não contam\)/);
});
