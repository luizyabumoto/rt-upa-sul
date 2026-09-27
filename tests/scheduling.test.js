import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryStore} from '../src/online-store.js';
import {segments,validateCoverage,bounds,baseDoctor,vacationConflicts} from '../src/scheduling.js';
test('férias incluem limites, vínculos e noturno; resolução não cancela férias',()=>{
 const store=new MemoryStore();const leave={kind:'task',type:'Férias',doctor:'THIAGO CONERA\nCRM 123 - SMS',date:'2026-10-10',endDate:'2026-10-15',status:'Resolvido'};
 store.setItem('rt-upa:organizer',JSON.stringify([leave]));
 for(const day of ['10','15'])assert.equal(vacationConflicts(store,'Thiago Conera · CRM 123 - COAPH',`2026-10-${day}`).length,1);
 assert.equal(vacationConflicts(store,'Thiago Conera','2026-10-09',0).length,0);
 assert.equal(vacationConflicts(store,'Thiago Conera','2026-10-09',7).length,1);
 assert.equal(vacationConflicts(store,'Thiago Conera','2026-10-09',15).length,0);
 assert.equal(vacationConflicts(store,'Outro médico','2026-10-10').length,0);
 assert.equal(vacationConflicts(store,'Thiago Conera','2026-10-16').length,0);
 leave.type='Outro';store.setItem('rt-upa:organizer',JSON.stringify([leave]));assert.equal(vacationConflicts(store,'Thiago Conera','2026-10-10').length,0);
});
const seed={assignments:[{date:'2026-10-01',slot:0,doctor:'Ana'},{date:'2026-10-01',slot:1,doctor:'Bea'}],cinderelas:[{weekday:1,slot:14,doctor:'Lucas'}]};
test('rascunho não altera escala; duas confirmações independentes e desfazer preservam previsão',()=>{
 const store=new MemoryStore();const a={id:'a',taskId:'t',date:'2026-10-01',slot:0,start:7,end:19,doctor:'Tiago',original:'Ana',confirmed:false};const b={...a,id:'b',slot:1,doctor:'Luiza',original:'Bea',confirmed:true};store.setItem('rt-upa:coverages',JSON.stringify([a,b]));
 assert.equal(segments(seed,store,a.date,0)[0].doctor,'Ana');assert.equal(segments(seed,store,a.date,1)[0].doctor,'Luiza');a.confirmed=true;store.setItem('rt-upa:coverages',JSON.stringify([a,b]));assert.equal(segments(seed,store,a.date,0)[0].doctor,'Tiago');assert.equal(baseDoctor(seed,store,a.date,0),'Ana');a.confirmed=false;store.setItem('rt-upa:coverages',JSON.stringify([a,b]));assert.equal(segments(seed,store,a.date,0)[0].doctor,'Ana');
});
test('horários de 12h e 6h, cinderela fixo e bloqueio de sobreposição',()=>{
 assert.deepEqual(bounds(0),[7,19]);assert.deepEqual(bounds(7),[19,31]);assert.deepEqual(bounds(14),[12,18]);assert.deepEqual(bounds(15),[18,24]);assert.equal(baseDoctor(seed,new MemoryStore(),'2026-09-28',14),'Lucas');
 const cover={id:'a',date:'2026-10-01',slot:0,start:7,end:19,doctor:'Tiago',confirmed:true};assert.throws(()=>validateCoverage({...cover,id:'b'},[cover]));validateCoverage({...cover,id:'b',slot:1},[cover]);
});
