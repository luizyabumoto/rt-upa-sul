import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryStore} from '../src/online-store.js';
import {overlapIndex} from '../src/scheduling.js';
const date='2026-10-01',a='ANA PAULA\nCRM 123 - SMS',b='Ana Paula\nCRM 123 - EXTRA SMS';
const seed={assignments:[],cinderelas:[]};
function store(edits){return new MemoryStore({'rt-upa:edits:2026:10:1':JSON.stringify(edits)});}
test('Cinderela conflita com diurno e noturno, mesmo com vínculo diferente',()=>{
 const result=overlapIndex(seed,store({[`${date}|0`]:a,[`${date}|7`]:a,[`${date}|15`]:b}),[date]);
 assert.deepEqual(result.get(`${date}|15`).map(x=>x.slot).sort((a,b)=>a-b),[0,7]);
 assert.equal(result.get(`${date}|0`)[0].slot,15);assert.equal(result.get(`${date}|7`)[0].slot,15);
});
test('não alerta plantões consecutivos, médicos diferentes ou vagas',()=>{
 const s=store({[`${date}|0`]:a,[`${date}|7`]:a,[`${date}|14`]:'BEA CRM 456 - SMS'});
 assert.equal(overlapIndex(seed,s,[date]).size,0);
 assert.equal(overlapIndex(seed,store({[`${date}|14`]:a,[`${date}|15`]:a}),[date]).size,0);
});
test('cobertura confirmada usa substituto e recalcula ao desfazer',()=>{
 const s=store({[`${date}|0`]:a,[`${date}|14`]:a});const cover={id:'c',date,slot:0,start:7,end:19,doctor:'BEA CRM 456 - SMS',confirmed:true};
 s.setItem('rt-upa:coverages',JSON.stringify([cover]));assert.equal(overlapIndex(seed,s,[date]).size,0);
 cover.confirmed=false;s.setItem('rt-upa:coverages',JSON.stringify([cover]));assert.equal(overlapIndex(seed,s,[date]).size,2);
});
test('virada da quinzena e mês não confunde o fim do noturno com início do diurno',()=>{
 const s=store({[`${date}|0`]:a});s.setItem('rt-upa:edits:2026:9:2',JSON.stringify({'2026-09-30|7':a}));
 assert.equal(overlapIndex(seed,s,[date]).size,0);
});
