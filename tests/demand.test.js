import test from 'node:test';
import assert from 'node:assert/strict';
import {periodoDemanda, janelas, analisar, medicosPorHora, pressaoPorHora} from '../src/demand.js';
import {plantoesDoPeriodo, cruzamento, periodoComparado, variacao, equipes, mediaUnidade, plantoes} from '../src/production.js';

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

test('médicos e consultas por hora, e consultas por médico', () => {
 // Clínico das 07h às 19h nos dias 01 e 02; o dia 03 não tem escala cadastrada.
 const partes = (data, slot) => slot === 0 && data !== '2026-10-03' ? [{doctor: 'ANA\nCRM 1', start: 7, end: 19}] : [];
 const escala = medicosPorHora(['2026-10-01', '2026-10-02', '2026-10-03'], partes);
 assert.deepEqual(escala.dias.sort(), ['2026-10-01', '2026-10-02']);   // dia 03 sem escala fica de fora
 assert.equal(escala.media[8], 1);                                     // 08h: 1 médico nos dois dias
 assert.equal(escala.media[3], 0);                                     // 03h: ninguém
 const horas = {'2026-10-01T08': {adulto: 10, pediatria: 0}, '2026-10-02T08': {adulto: 20, pediatria: 0}, '2026-10-03T08': {adulto: 99, pediatria: 0}};
 const p = pressaoPorHora(horas, escala);
 assert.equal(p[8].consultas, 15);            // média de 10 e 20; o dia 03 não conta
 assert.equal(p[8].medicos, 1);
 assert.equal(p[8].porMedico, 15);
});

test('noturno conta nas horas do dia seguinte depois da meia-noite', () => {
 const partes = (data, slot) => slot === 7 ? [{doctor: 'BIA\nCRM 2', start: 19, end: 31}] : [];
 const escala = medicosPorHora(['2026-10-01', '2026-10-02'], partes);
 assert.deepEqual(escala.dias.sort(), ['2026-10-01', '2026-10-02']);
 assert.equal(escala.media[20], 1);     // 20h: um plantão noturno em cada dia
 assert.equal(escala.media[2], 0.5);    // 02h: só a madrugada do plantão do dia 01 caiu dentro da lista
});

test('comparação: período anterior e mesmo período do ano passado', () => {
 assert.deepEqual(periodoComparado('2026-09-08T07:00', '2026-09-15T07:00', 'anterior'), {inicio: '2026-09-01T07:00', fim: '2026-09-08T07:00'});
 assert.deepEqual(periodoComparado('2026-09-01T00:00', '2026-10-01T00:00', 'ano'), {inicio: '2025-09-01T00:00', fim: '2025-10-01T00:00'});
 assert.equal(variacao(120, 100), '+20%');
 assert.equal(variacao(80, 100), '-20%');
 assert.equal(variacao(10, 0), 'novo');
});

test('equipes por dia da semana e turno, e média da unidade', () => {
 // 2 segundas diurnas (06/10 e 13/10/2026) e 1 terça diurna (07/10).
 const registros = [
  {data: '2026-10-06', turno: 'D', medico: 'A', adulto: 30, pediatria: 0, retornos: 0, classes: {}},
  {data: '2026-10-06', turno: 'D', medico: 'B', adulto: 30, pediatria: 0, retornos: 0, classes: {}},
  {data: '2026-10-13', turno: 'D', medico: 'A', adulto: 50, pediatria: 0, retornos: 0, classes: {}},
  {data: '2026-10-13', turno: 'D', medico: 'C', adulto: 50, pediatria: 0, retornos: 0, classes: {}},
  {data: '2026-10-07', turno: 'D', medico: 'A', adulto: 20, pediatria: 0, retornos: 0, classes: {}},
 ];
 const e = Object.fromEntries(equipes(registros).map(x => [x.nome, x]));
 const ter = e['Terça · diurno'];                 // 06 e 13/10/2026 são terças
 assert.equal(ter.plantoes, 2);
 assert.equal(ter.mediaPorPlantao, 80);      // (60 + 100) / 2
 assert.equal(ter.mediaMedicos, 2);
 assert.equal(ter.porMedico, 40);            // 160 consultas / 4 médicos
 // Ranking por consultas/médico: terça (40) na frente da quarta (20).
 assert.deepEqual(equipes(registros).map(x => x.nome), ['Terça · diurno', 'Quarta · diurno']);
 const u = mediaUnidade(registros);
 assert.equal(u.plantoes, 3);
 assert.equal(u.porMedico, 36);              // 180 consultas / 5 médicos-plantão
});

test('plantoes: total, médicos e por médico/hora; plantão sem consulta some', () => {
 const registros = [
  {data: '2026-10-06', turno: 'N', medico: 'A', adulto: 24, pediatria: 0, retornos: 5, classes: {}},
  {data: '2026-10-06', turno: 'N', medico: 'B', adulto: 0, pediatria: 0, retornos: 9, classes: {}},
 ];
 const p = plantoes(registros);
 assert.equal(p.length, 1);
 assert.deepEqual([p[0].total, p[0].medicos, p[0].porMedico, p[0].porMedicoHora], [24, 1, 24, 2]);
});
