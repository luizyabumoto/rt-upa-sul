import test from 'node:test';
import assert from 'node:assert/strict';
import {matchingDoctors} from '../src/doctor-picker.js';
test('busca ignora acentos e procura nome, CRM e vínculo sem confundir a opção vazia',()=>{
 const options=[{value:'',textContent:'Vago'},{value:'a',textContent:'JOÃO SILVA · CRM 123 - SMS'},{value:'b',textContent:'JOÃO SILVA · CRM 123 - COAPH'},{value:'c',textContent:'ANA · CRM 789 - SMS'}];
 assert.deepEqual(matchingDoctors(options,'joao 123').map(x=>x.value),['a','b']);
 assert.deepEqual(matchingDoctors(options,'123 coaph').map(x=>x.value),['b']);
 assert.equal(matchingDoctors(options,'').length,0);assert.equal(matchingDoctors(options,'vago').length,0);
});
