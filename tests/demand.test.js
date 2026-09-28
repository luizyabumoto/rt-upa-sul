import test from 'node:test';
import assert from 'node:assert/strict';
import {periodoDemanda, janelas, analisar} from '../src/demand.js';
import {plantoesDoPeriodo, cruzamento} from '../src/production.js';

const em = local => new Date(`${local}:00-04:00`);

test('períodos da análise de demanda', () => {
 const agora = em('2026-09-28T16:40');
 assert.deepEqual(periodoDemanda('30', agora), {inicio: '2026-08-30T00:00', fim: 'agora'});
 assert.deepEqual(periodoDemanda('ano', agora), {inicio: '2026-01-01T00:00', fim: 'agora'});
 assert.deepEqual(periodoDemanda('anoPassado', agora), {inicio: '2025-01-01T00:00', fim: '2026-01-01T00:00'});
});

test('período longo vira janelas de até 31 dias e só a última vai até agora', () => {
 const lista = janelas('2026-01-01T00:00', 'agora', em('2026-03-15T10:00'));
 assert.equal(lista.length, 3);
 assert.deepEqual(lista[0], {inicio: '2026-01-01T00:00', fim: '2026-02-01T00:00'});
 assert.equal(lista.at(-1).fim, 'agora');
 assert.deepEqual(janelas('2025-01-01T00:00', '2026-01-01T00:00').at(-1).fim, '2026-01-01T00:00');
 assert.equal(janelas('2025-01-01T00:00', '2026-01-01T00:00').length, 12);
});

test('médias por dia da semana contam os dias sem consulta; pico por hora e recorde', () => {
 // 28/09/2026 é segunda; período de 14 dias (duas segundas).
 const horas = {'2026-09-28T08': {adulto: 30, pediatria: 10}, '2026-09-28T20': {adulto: 10, pediatria: 0}, '2026-10-01T08': {adulto: 20, pediatria: 0}};
 const a = analisar(horas, '2026-09-28T00:00', '2026-10-11T23:59');
 assert.equal(a.dias.length, 14);
 assert.equal(a.total, 70);
 assert.equal(a.mediaDia, 5);
 assert.equal(a.semana[1].nome, 'Segunda');
 assert.equal(a.semana[1].media, 25);            // 50 consultas em 2 segundas
 assert.equal(a.semana[4].media, 10);            // quinta
 assert.deepEqual([a.recorde.data, a.recorde.total], ['2026-09-28', 50]);
 assert.equal(a.hora.reduce((x, y) => (y.media > x.media ? y : x)).hora, 8);
 assert.deepEqual(a.meses.map(m => [m.mes, m.total, m.dias]), [['2026-09', 50, 3], ['2026-10', 20, 11]]);
});

test('plantões do período começam às 07h e 19h', () => {
 assert.deepEqual(plantoesDoPeriodo('2026-09-28T07:00-04:00', '2026-09-29T07:00-04:00'), [{data: '2026-09-28', turno: 'D'}, {data: '2026-09-28', turno: 'N'}]);
 assert.deepEqual(plantoesDoPeriodo('2026-09-28T03:00-04:00', '2026-09-28T08:00-04:00'), [{data: '2026-09-27', turno: 'N'}, {data: '2026-09-28', turno: 'D'}]);
});

test('escala × produção: escalado com e sem consulta e consultas fora da escala', () => {
 const escalas = [{data: '2026-09-28', turno: 'D', nomes: ['MARIA CLARA TRETTEL', 'ANA LIMA']}, {data: '2026-09-28', turno: 'N', nomes: ['ANA LIMA']}];
 const registros = [
  {data: '2026-09-28', turno: 'D', medico: 'MARIA CLARA TRETTEL DE OLIVEIRA', adulto: 27, pediatria: 0, retornos: 3, classes: {}},
  {data: '2026-09-28', turno: 'N', medico: 'ANA LIMA', adulto: 20, pediatria: 0, retornos: 0, classes: {}},
  {data: '2026-09-28', turno: 'D', medico: 'LUCAS MOTA', adulto: 33, pediatria: 0, retornos: 0, classes: {}},
 ];
 const r = Object.fromEntries(cruzamento(registros, escalas).map(l => [l.medico, l]));
 assert.deepEqual([r['ANA LIMA'].escalados, r['ANA LIMA'].comConsulta, r['ANA LIMA'].semConsulta.length, r['ANA LIMA'].consultasEscalado], [2, 1, 1, 20]);
 assert.deepEqual([r['MARIA CLARA TRETTEL'].consultasEscalado, r['MARIA CLARA TRETTEL'].consultasFora], [27, 0]);
 assert.deepEqual([r['LUCAS MOTA'].escalados, r['LUCAS MOTA'].consultasFora], [0, 33]);
});
