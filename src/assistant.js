import {searchText,doctorPicker} from './doctor-picker.js';
import {parse,doctorIdentity,baseDoctor,slots,bounds,hour,validateCoverage,vacationConflicts,vacationMessage,doctorChoices} from './scheduling.js';

const display=d=>d.replaceAll('\n',' · ');
export function cuiabaToday(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Cuiaba',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
export function commandDate(text,today=cuiabaToday()){
 const t=searchText(text),matches=[...t.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/g)];
 if(matches.length===1&&!/\b(hoje|amanha)\b/.test(t)){const [,day,month,year]=matches[0],date=`${year||today.slice(0,4)}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;const d=new Date(date+'T12:00:00Z');return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===date?date:'';}
 if(matches.length)return '';
 const relative=[...t.matchAll(/\b(hoje|amanha)\b/g)];if(relative.length!==1)return '';
 const d=new Date(today+'T12:00:00Z');if(relative[0][1]==='amanha')d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);
}
export function mentionedDoctors(fragment,people){
 const text=' '+searchText(fragment).replace(/[^a-z0-9]+/g,' ')+' ';
 const scored=people.map(doctor=>{const parts=searchText(doctor.split(/CRM/i)[0]).split(/[^a-z]+/).filter(w=>w.length>=3&&!['dos','das'].includes(w));return {doctor,score:parts.filter(w=>text.includes(' '+w+' ')).length};});
 const best=Math.max(0,...scored.map(x=>x.score));return best?scored.filter(x=>x.score===best).map(x=>x.doctor):[];
}
export function interpretCommand(text,people,today=cuiabaToday()){
 const t=searchText(text);let original='',replacement='',match;
 if((match=t.match(/(?:troque|trocar|substitua)\s+(.+?)\s+(?:por|pelo|pela)\s+(.+)/))){[,original,replacement]=match;}
 else if((match=t.match(/(.+?)\s+(?:vai\s+)?(?:cobrir|cobre|substituir|substitui)\s+(.+)/))){replacement=match[1];original=match[2];}
 else if((match=t.match(/(.+?)\s+(?:nao|n)\s+(?:vai|vem|pode|podera)\b(.*)/))){original=match[1];replacement=match[2];}
 // Questions, negated replacements and conditional messages require manual clarification.
 const uncertain=/\?|\b(?:talvez|se|poderia|sera|nao|n)\b/.test(replacement);
 return {date:commandDate(t,today),originals:mentionedDoctors(original,people),replacements:uncertain?[]:mentionedDoctors(replacement,people),understood:!!match&&!uncertain};
}
export function replacementSlots(seed,storage,date,doctor){return date&&doctor?slots.map((_,slot)=>slot).filter(slot=>doctorIdentity(baseDoctor(seed,storage,date,slot))===doctorIdentity(doctor)):[];}
export function validateReplacement(seed,storage,proposal){
 const {date,slot,original,doctor}=proposal;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!original||!doctor||!Number.isInteger(slot)||slot<0||slot>15)throw new Error('Confira data, os dois médicos e o posto.');
 if(doctorIdentity(original)===doctorIdentity(doctor))throw new Error('Escolha um médico diferente para a cobertura.');
 if(baseDoctor(seed,storage,date,slot)!==original)throw new Error('O médico previsto mudou. Analise novamente antes de confirmar.');
 const [start,end]=bounds(slot,date);validateCoverage({date,slot,start,end,doctor},parse(storage,'coverages',[]));
 const vacations=vacationConflicts(storage,doctor,date,slot);if(vacations.length)throw new Error(vacationMessage(vacations[0])+' Escolha outro médico ou confira as férias em Pendências.');
 return {date,slot,start,end,doctor,original,confirmed:true};
}
export function mountAssistant(storage,seed){
 const root=document.querySelector('#assistant-panel');
 root.innerHTML=`<div class="section-heading"><div><p class="eyebrow">TROCAS EM POUCOS TOQUES</p><h2>Assistente da escala</h2></div></div><p>Escreva uma substituição por vez. Este assistente de comandos reconhece nomes cadastrados e datas; confira o resumo antes de confirmar. Não é um chat de IA geral.</p><div class="assistant-message">Exemplo: “Ana Paula não vai dia 10/10, Tiago Parreiras vai no lugar”. Você também pode escrever “Tiago cobre Ana Paula amanhã”.</div><form id="assistant-command"><label>Sua mensagem<textarea name="message" rows="3" maxlength="1000" required placeholder="Quem não vai, em qual data e quem vai cobrir?"></textarea></label><button>Analisar troca</button></form><p id="assistant-reply" role="status" aria-live="polite"></p><form id="assistant-review" hidden><h3>Confira o que vai mudar</h3><div class="form-grid"><label>Data da cobertura<input name="date" type="date" required></label><label>Médico que não vai<select name="original" required></select></label><label>Médico que vai cobrir · confira o vínculo<select name="doctor" required></select></label><label>Plantão que será coberto<select name="slot" required></select></label></div><p id="assistant-impact" class="assistant-message"></p><p class="notice">Vale somente para este plantão. O padrão fixo continua igual. Uma cobertura confirmada será registrada em Pendências, onde você pode desfazê-la.</p><div class="actions"><button>Confirmar e atualizar escala</button><button type="button" id="assistant-cancel" class="secondary">Cancelar</button></div></form><div id="assistant-result" hidden><p role="status">Troca aplicada à escala. Confira “Salvo online” no topo para confirmar a sincronização.</p><div class="actions"><button id="assistant-open">Ver plantão atualizado</button><button id="assistant-tasks" class="secondary">Ver registro / desfazer</button></div></div>`;
 const command=root.querySelector('#assistant-command'),form=root.querySelector('#assistant-review'),reply=root.querySelector('#assistant-reply'),result=root.querySelector('#assistant-result');let proposal=null,last=null,message='';
 const people=()=>doctorChoices(seed,storage);
 function update(){proposal=null;const date=form.elements.date.value,original=form.elements.original.value,doctor=form.elements.doctor.value,previous=form.elements.slot.value;const candidates=replacementSlots(seed,storage,date,original);form.elements.slot.replaceChildren(new Option('Selecione o posto',''));for(const slot of candidates){const [a,b]=bounds(slot);form.elements.slot.add(new Option(`${slots[slot]} · ${hour(a)}–${hour(b)}`,slot));}if(candidates.length===1)form.elements.slot.value=candidates[0];else if(candidates.includes(Number(previous))&&previous!=='')form.elements.slot.value=previous;
  const slot=form.elements.slot.value,impact=root.querySelector('#assistant-impact');impact.textContent=!date?'Informe a data completa.':!original?'Escolha quem não vai.':!candidates.length?'Esse médico não está previsto nesta data. Confira o médico e a data.':slot===''?'O médico tem mais de um plantão. Escolha qual será coberto.':!doctor?'Escolha quem vai cobrir e confira o vínculo.':`${date.split('-').reverse().join('/')} · ${slots[Number(slot)]}\nSai: ${display(baseDoctor(seed,storage,date,Number(slot)))}\nEntra: ${display(doctor)}`;
  if(date&&original&&doctor&&slot!=='')proposal={date,slot:Number(slot),original:baseDoctor(seed,storage,date,Number(slot)),doctor};
 }
 command.onsubmit=e=>{e.preventDefault();message=command.elements.message.value.trim();if(!message)return;result.hidden=true;form.reset();const all=people(),read=interpretCommand(message,all),unique=new Map();for(const d of all)if(!unique.has(doctorIdentity(d)))unique.set(doctorIdentity(d),d);form.elements.original.replaceChildren(new Option('Selecione quem não vai',''));for(const d of unique.values())form.elements.original.add(new Option(display(d),d));form.elements.doctor.replaceChildren(new Option('Selecione quem vai cobrir e o vínculo',''));for(const d of all)form.elements.doctor.add(new Option(display(d),d));form.elements.date.value=read.date;const old=[...new Set(read.originals.map(doctorIdentity))];if(old.length===1)form.elements.original.value=unique.get(old[0]);if(read.replacements.length===1)form.elements.doctor.value=read.replacements[0];reply.textContent=read.understood?'Confira os dados abaixo. Se houver nomes ou vínculos parecidos, escolha a opção correta.':'Não consegui identificar uma troca única com segurança. Complete os campos abaixo ou reescreva a mensagem.';form.hidden=false;form.elements.slot.value='';doctorPicker(form.elements.original);doctorPicker(form.elements.doctor);update();};
 form.onchange=e=>{if(e.target!==form.elements.slot)form.elements.slot.value='';update();};
 root.querySelector('#assistant-cancel').onclick=()=>{form.hidden=true;proposal=null;reply.textContent='Cancelado. A escala não foi alterada.';};
 command.elements.message.oninput=()=>{if(!form.hidden){form.hidden=true;proposal=null;reply.textContent='Mensagem alterada. Toque em Analisar troca novamente.';}};
 form.onsubmit=e=>{e.preventDefault();try{if(!proposal)throw new Error('Complete os campos antes de confirmar.');const coverage=validateReplacement(seed,storage,proposal),taskId=crypto.randomUUID();const tasks=parse(storage,'organizer',[]),covers=parse(storage,'coverages',[]);if(tasks.length>=2000||covers.length>=2000)throw new Error('O limite de registros foi atingido. Revise suas pendências.');const task={id:taskId,kind:'task',type:'Cobertura',needed:1,title:'Substituição pelo assistente',body:message,date:coverage.date,reminder:'',endDate:'',shift:coverage.slot>=14?'Cinderela':coverage.slot>=7?'Noturno':'Diurno',status:'Resolvido',doctor:coverage.original,cover:coverage.doctor};storage.setItem('rt-upa:organizer',JSON.stringify([task,...tasks]));storage.setItem('rt-upa:coverages',JSON.stringify([...covers,{...coverage,id:crypto.randomUUID(),taskId}]));last={...coverage};form.hidden=true;proposal=null;reply.textContent='Cobertura confirmada e registrada. O nome já aparece na escala e nas exportações.';result.hidden=false;document.dispatchEvent(new Event('rt-data-restored'));document.dispatchEvent(new Event('rt-schedule-changed'));}catch(err){reply.textContent=err.message;}};
 root.querySelector('#assistant-open').onclick=()=>{document.querySelector('[data-view="schedule"]').click();document.dispatchEvent(new CustomEvent('rt-open-date',{detail:last.date}));document.dispatchEvent(new CustomEvent('rt-select-shift',{detail:last.slot}));};
 root.querySelector('#assistant-tasks').onclick=()=>{document.querySelector('[data-view="tasks"]').click();const filter=document.querySelector('#task-filter');filter.value='all';filter.dispatchEvent(new Event('change'));};
 document.addEventListener('rt-data-restored',()=>{if(!form.hidden){form.hidden=true;proposal=null;reply.textContent='Os dados foram atualizados. Analise a mensagem novamente para conferir a escala mais recente.';}});
}
