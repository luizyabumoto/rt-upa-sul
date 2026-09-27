import test from 'node:test';
import assert from 'node:assert/strict';
import {addDays,dayShifts,pendingCovers} from '../src/quick-view.js';
import {MemoryStore} from '../src/online-store.js';
test('resumo acompanha coberturas confirmadas e virada do mês',()=>{const s=new MemoryStore();const seed={assignments:[{date:'2026-09-30',slot:0,doctor:'Original'}]};s.setItem('rt-upa:coverages',JSON.stringify([{id:'1',taskId:'a',date:'2026-09-30',slot:0,start:7,end:19,doctor:'Substituto',confirmed:true}]));assert.equal(dayShifts(seed,s,'2026-09-30')[0].doctor,'Substituto');assert.equal(addDays('2026-09-30',1),'2026-10-01');s.setItem('rt-upa:organizer',JSON.stringify([{id:'a',kind:'task',title:'Duas vagas',type:'Cobertura',status:'Em acompanhamento',needed:2},{id:'b',kind:'task',type:'Cobertura',status:'Resolvido',needed:2}]));assert.equal(pendingCovers(s).length,1);assert.equal(pendingCovers(s)[0].missing,1);});
