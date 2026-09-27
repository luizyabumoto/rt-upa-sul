import test from 'node:test';
import assert from 'node:assert/strict';
import {fortnight, generateSchedule} from '../src/calendar.js';

test('outubro de 2026 começa quinta e termina sábado', () => {
  assert.equal(fortnight(2026, 10, 1)[0].weekdayName, 'quinta');
  assert.equal(fortnight(2026, 10, 2).at(-1).weekdayName, 'sábado');
});

test('segunda quinzena acompanha o fim do mês e ano bissexto', () => {
  assert.equal(fortnight(2027, 2, 2).length, 13);
  assert.equal(fortnight(2028, 2, 2).length, 14);
});

test('plantão fixo muda de data e cobertura preserva a exceção', () => {
  const fixed = [{doctorId:'ana', sector:'porta', slot:1, weekday:4, startTime:'07:00', endTime:'19:00', affiliation:'SMS'}];
  const october = generateSchedule({year:2026,month:10,half:1,fixed,
    absences:[{doctorId:'ana',startDate:'2026-10-08',endDate:'2026-10-08'}],
    overrides:[{date:'2026-10-08',sector:'porta',slot:1,doctorId:'lucas',reason:'cobertura'}]});
  assert.deepEqual(october.placements.map(p=>p.date), ['2026-10-01','2026-10-08','2026-10-15']);
  assert.equal(october.placements[1].doctorId,'lucas');
  assert.equal(october.warnings.length,0);
  const november = generateSchedule({year:2026,month:11,half:1,fixed});
  assert.equal(november.placements[0].date,'2026-11-05');
});
