import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MemoryStore} from '../src/online-store.js';
import {baseDoctor,plannedDoctor,recurringRule,segments} from '../src/scheduling.js';
const seed=JSON.parse(readFileSync(new URL('../src/seed.json',import.meta.url),'utf8'));
test('27/09 importado preserva nomes, X e extras sem inventar fixos',()=>{
 const store=new MemoryStore();
 assert.match(baseDoctor(seed,store,'2026-09-27',0),/GUSTAVO/);
 assert.match(baseDoctor(seed,store,'2026-09-27',2),/THIAGO PAES CONERA/);
 assert.equal(baseDoctor(seed,store,'2026-09-27',3),'');
 assert.equal(seed.assignments.find(a=>a.date==='2026-09-27'&&a.slot===3).availability,'not-scheduled');
 assert.equal(seed.assignments.filter(a=>a.date>='2026-09-16'&&a.date<='2026-09-30').length,210);
 assert.ok(seed.patterns.every(p=>p.rules.every(r=>!r.doctor.includes('EXTRA'))));
});
test('Dhyeillen mantém setembro e muda para terça em outubro, padrão continua em novembro',()=>{
 const store=new MemoryStore();
 assert.match(plannedDoctor(seed,store,'2026-09-28',1),/DHYEILLEN/);
 assert.match(plannedDoctor(seed,store,'2026-10-06',0),/DHYEILLEN/);
 assert.match(plannedDoctor(seed,store,'2026-11-03',0),/DHYEILLEN/);
 assert.doesNotMatch(recurringRule(seed,store,'2026-10-01',1,1).doctor,/DHYEILLEN/);
});
test('vigência, troca de posto, encerramento, exceção diária e cobertura têm prioridade correta',()=>{
 const store=new MemoryStore(); const before=plannedDoctor(seed,store,'2026-09-28',1);
 store.setItem('rt-upa:roster',JSON.stringify([
 {id:'a',start:'2026-10-01',weekday:1,slot:1,doctor:''},
 {id:'b',start:'2026-10-01',weekday:2,slot:0,doctor:'NOVO CRM 1 - COAPH'},
 {id:'c',start:'2026-11-01',weekday:2,slot:0,doctor:''}]));
 assert.equal(plannedDoctor(seed,store,'2026-09-28',1),before);
 assert.equal(plannedDoctor(seed,store,'2026-10-05',1),'');
 assert.match(plannedDoctor(seed,store,'2026-10-06',0),/NOVO/);
 assert.equal(plannedDoctor(seed,store,'2026-11-03',0),'');
 store.setItem('rt-upa:edits:2026:10:1',JSON.stringify({'2026-10-06|0':'PONTUAL'}));
 assert.equal(baseDoctor(seed,store,'2026-10-06',0),'PONTUAL');
 store.setItem('rt-upa:coverages',JSON.stringify([{id:'x',date:'2026-10-06',slot:0,start:7,end:19,doctor:'COBERTURA',confirmed:true}]));
 assert.equal(segments(seed,store,'2026-10-06',0)[0].doctor,'COBERTURA');
});
