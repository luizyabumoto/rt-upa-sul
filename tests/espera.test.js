import test from 'node:test';
import assert from 'node:assert/strict';
import {periodoDemanda, periodoPlantao, analisar, plantaoDaHora} from '../src/demand.js';
import {filtrarEspera, resumoEspera, esperaPorGrupo} from '../src/espera.js';

const em = local => new Date(`${local}:00-04:00`);

test('novos períodos da demanda: plantões, dia, semana e mês', () => {
 const agora = em('2026-09-29T21:30');          // terça, plantão noturno em andamento
 assert.deepEqual(periodoDemanda('atual', agora), {inicio: '2026-09-29T19:00', fim: 'agora'});
 assert.deepEqual(periodoDemanda('anterior', agora), {inicio: '2026-09-29T07:00', fim: '2026-09-29T19:00'});
 assert.deepEqual(periodoDemanda('hoje', agora), {inicio: '2026-09-29T00:00', fim: 'agora'});
 assert.deepEqual(periodoDemanda('ontem', agora), {inicio: '2026-09-28T00:00', fim: '2026-09-29T00:00'});
 assert.deepEqual(periodoDemanda('semana', agora), {inicio: '2026-09-28T00:00', fim: 'agora'});
 assert.deepEqual(periodoDemanda('semanaPassada', agora), {inicio: '2026-09-21T00:00', fim: '2026-09-28T00:00'});
 assert.deepEqual(periodoDemanda('mes', agora), {inicio: '2026-09-01T00:00', fim: 'agora'});
 assert.deepEqual(periodoDemanda('mesPassado', agora), {inicio: '2026-08-01T00:00', fim: '2026-09-01T00:00'});
 // Madrugada ainda é o noturno do dia anterior.
 assert.deepEqual(periodoDemanda('atual', em('2026-09-30T03:00')), {inicio: '2026-09-29T19:00', fim: 'agora'});
 assert.deepEqual(periodoPlantao('2026-09-29', 'N'), {inicio: '2026-09-29T19:00', fim: '2026-09-30T07:00'});
 assert.deepEqual(periodoPlantao('2026-09-29', 'D'), {inicio: '2026-09-29T07:00', fim: '2026-09-29T19:00'});
});

test('madrugada pertence ao noturno do dia anterior', () => {
 assert.deepEqual(plantaoDaHora('2026-09-30T03'), {data: '2026-09-29', turno: 'N'});
 assert.deepEqual(plantaoDaHora('2026-09-30T07'), {data: '2026-09-30', turno: 'D'});
 assert.deepEqual(plantaoDaHora('2026-09-30T19'), {data: '2026-09-30', turno: 'N'});
});

test('um plantão noturno: consultas por hora, plantão e espera por classificação', () => {
 const horas = {
  '2026-09-29T18': {adulto: 50, pediatria: 0},                                     // antes do plantão: fora
  '2026-09-29T20': {adulto: 6, pediatria: 2, espera: {urgente: [4, 120], poucoUrgente: [4, 360]}},
  '2026-09-30T02': {adulto: 3, pediatria: 1, espera: {poucoUrgente: [2, 200]}},
  '2026-09-30T07': {adulto: 40, pediatria: 0}};                                    // depois do plantão: fora
 const a = analisar(horas, '2026-09-29T19:00', '2026-09-30T07:00');
 assert.equal(a.total, 12);
 assert.equal(a.horasNoPeriodo, 12);
 assert.equal(a.porHora, 1);
 assert.equal(a.hora[20].media, 8);            // uma única 20h no período: não divide por 2 dias
 assert.equal(a.hora[18].media, 0);
 assert.deepEqual(a.plantoes.map(p => [p.data, p.turno, p.total]), [['2026-09-29', 'N', 12]]);
 assert.deepEqual(a.espera.map(e => [e.chave, e.n, e.media]), [['urgente', 4, 30], ['poucoUrgente', 6, 93]]);
 assert.deepEqual(a.esperaGeral, {n: 10, media: 68});
});

test('semanas e plantões num período mais longo', () => {
 const horas = {'2026-09-21T08': {adulto: 10, pediatria: 0}, '2026-09-28T20': {adulto: 4, pediatria: 0}};
 const a = analisar(horas, '2026-09-21T00:00', '2026-10-05T00:00');
 assert.deepEqual(a.semanas.map(s => [s.inicio, s.total, s.dias]), [['2026-09-21', 10, 7], ['2026-09-28', 4, 7]]);
 // 14 dias = 28 plantões inteiros + a madrugada de 21/09, que é do noturno de 20/09.
 assert.equal(a.plantoes.length, 29);
 assert.equal(a.plantoes.find(p => p.data === '2026-09-28' && p.turno === 'N').total, 4);
});

const ESPERAS = [
 {data: '2026-09-29', turno: 'D', fila: 'adulto', classe: 'urgente', n: 10, soma: 400, maior: 90},
 {data: '2026-09-29', turno: 'D', fila: 'pediatria', classe: 'urgente', n: 2, soma: 20, maior: 15},
 {data: '2026-09-29', turno: 'N', fila: 'adulto', classe: 'poucoUrgente', n: 5, soma: 600, maior: 200},
 {data: '2026-09-30', turno: 'D', fila: 'adulto', classe: 'emergencia', n: 1, soma: 0, maior: 0}];

test('espera média por classificação no período e por plantão', () => {
 const r = resumoEspera(ESPERAS);
 assert.deepEqual(r.classes.map(c => [c.chave, c.n, c.media, c.maior, c.alvo]), [['emergencia', 1, 0, 0, 0], ['urgente', 12, 35, 90, 60], ['poucoUrgente', 5, 120, 200, 120]]);
 assert.deepEqual([r.geral.n, r.geral.media], [18, 57]);
 const porPlantao = esperaPorGrupo(ESPERAS, 'plantao');
 assert.deepEqual(porPlantao.map(g => g.chave), ['2026-09-29D', '2026-09-29N', '2026-09-30D']);
 assert.equal(porPlantao[0].classes.urgente.n, 12);
 assert.deepEqual(esperaPorGrupo(ESPERAS, 'dia').map(g => [g.chave, g.geral.n]), [['2026-09-29', 17], ['2026-09-30', 1]]);
});

test('filtros de consultório e turno na espera', () => {
 assert.equal(filtrarEspera(ESPERAS, {fila: 'pediatria'}).length, 1);
 assert.equal(filtrarEspera(ESPERAS, {turno: 'N'}).length, 1);
 assert.equal(filtrarEspera(ESPERAS, {fila: 'adulto', turno: 'D'}).length, 2);
 assert.equal(filtrarEspera(undefined).length, 0);
});
