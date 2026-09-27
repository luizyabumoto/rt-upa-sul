import test from 'node:test';
import assert from 'node:assert/strict';
import {urgency} from '../src/organizer.js';
test('lembrete prevalece sobre plantão e considera virada de mês',()=>{
 assert.equal(urgency({date:'2026-10-03',reminder:'2026-09-26'},'2026-09-27'),'Atrasado');
 assert.equal(urgency({date:'2026-10-03'},'2026-09-27'),'Próximos 7 dias');
 assert.equal(urgency({date:'2026-10-05'},'2026-09-27'),'Mais adiante');
 assert.equal(urgency({reminder:'2026-09-27'},'2026-09-27'),'Hoje');
 assert.equal(urgency({status:'Resolvido',date:'2026-09-01'},'2026-09-27'),'Resolvido');
});
