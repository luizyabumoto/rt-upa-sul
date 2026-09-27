import test from 'node:test';
import assert from 'node:assert/strict';
import {commandDate,interpretCommand,replacementSlots,validateReplacement} from '../src/assistant.js';
import {MemoryStore} from '../src/online-store.js';
const ana='ANA PAULA\nCRM 1 - SMS',tiago='TIAGO PARREIRAS\nCRM 2 - SMS',other='ANA LUIZA\nCRM 3 - COAPH',people=[ana,tiago,other];
test('entende ausência, cobertura e substituição em português',()=>{
 for(const text of ['Ana Paula não vai dia 10/10, Tiago Parreiras vai no lugar','Tiago Parreiras cobre Ana Paula dia 10/10','Troque Ana Paula por Tiago Parreiras em 10/10']){const p=interpretCommand(text,people,'2026-09-27');assert.deepEqual(p.originals,[ana]);assert.deepEqual(p.replacements,[tiago]);assert.equal(p.date,'2026-10-10');}
});
test('não escolhe homônimo, vínculo ambíguo ou substituto negado',()=>{
 assert.equal(interpretCommand('Ana não vai amanhã, Tiago vai no lugar',people).originals.length,2);
 assert.equal(interpretCommand('Ana Paula não vai amanhã, Tiago também não vai',people).replacements.length,0);
 assert.equal(interpretCommand('Ana Paula não vai amanhã, talvez Tiago vai',people).understood,false);
 assert.equal(interpretCommand('Olá, como está a escala?',people).understood,false);
});
test('datas inválidas, intervalos e dia sem mês exigem seleção',()=>{
 for(const text of ['31/02','10/10 e 11/10','dia 10','hoje ou amanhã'])assert.equal(commandDate(text,'2026-09-27'),'');
 assert.equal(commandDate('amanhã','2026-12-31'),'2027-01-01');assert.equal(commandDate('10/10/2027','2026-09-27'),'2027-10-10');
});
test('preserva escolha de posto e rejeita alteração obsoleta, férias e cobertura duplicada',()=>{
 const seed={assignments:[{date:'2026-10-10',slot:0,doctor:ana},{date:'2026-10-10',slot:7,doctor:ana}]},store=new MemoryStore(),p={date:'2026-10-10',slot:0,original:ana,doctor:tiago};
 assert.deepEqual(replacementSlots(seed,store,p.date,ana),[0,7]);assert.equal(validateReplacement(seed,store,p).confirmed,true);
 assert.throws(()=>validateReplacement(seed,store,{...p,original:other}));assert.throws(()=>validateReplacement(seed,store,{...p,doctor:ana}));
 store.setItem('rt-upa:coverages',JSON.stringify([{...p,start:7,end:19,confirmed:true,id:'c'}]));assert.throws(()=>validateReplacement(seed,store,p));store.removeItem('rt-upa:coverages');
 store.setItem('rt-upa:organizer',JSON.stringify([{kind:'task',type:'Férias',doctor:tiago,date:'2026-10-01',endDate:'2026-10-15'}]));assert.throws(()=>validateReplacement(seed,store,p),/férias/);
});
