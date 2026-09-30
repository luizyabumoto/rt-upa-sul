import {mountAssistant} from './assistant.js';
import {doctorSearchButton} from './doctor-picker.js';
import {mountQuickView} from './quick-view.js';
import {mountPdf} from './pdf.js';
import {mountRoster} from './roster.js';
import {mountScheduleView} from './schedule-view.js';
import {overlapIndex,overlapMessage,segments,baseDoctor,plannedDoctor,affiliationClass,vacationConflicts,vacationMessage,periodReview,slots,canonicalizeStorage,doctorChoices,doctorOptions,canonicalDoctor,clinicoOccupancy} from './scheduling.js';
import {mountPush} from './push.js';
import {mountOrganizer} from './organizer.js';
import {mountFlow} from './flow.js';
import {mountProduction} from './production.js';
import {mountDemand} from './demand.js';
import {mountEspera} from './espera.js';
import {mountTrocas} from './trocas.js';
import {registrarTroca, mountHistorico} from './historico.js';
import {mountAlertasEscala} from './escala-alertas.js';
import {mountVersoes} from './versoes.js';
import {reincluirMedico} from './cadastro.js';
import {mountResumo} from './resumo.js';
import {mountCabecalho, mountAtencao} from './painel.js';
import {fortnight, WEEKDAYS, nomeArquivo} from './calendar.js';
import {connectStore} from './online-store.js';
let storage;
try { storage = await connectStore(); } catch(error) { document.querySelector('main').textContent = error.message; throw error; }
const seedResponse = await fetch('/src/seed.json',{cache:'no-store'});
if (!seedResponse.ok) { document.querySelector('main').textContent = 'Não foi possível carregar a escala. Entre novamente e recarregue a página.'; throw new Error('Seed indisponível'); }
const seed = await seedResponse.json();
// Nomes, CRMs e vínculos salvos antes do cadastro único passam para a forma padronizada.
canonicalizeStorage(storage);
const months=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const slotNames=['Diurno · Clínico 1','Diurno · Clínico 2','Diurno · Clínico 3','Diurno · Clínico 4','Diurno · Pediatria 1','Diurno · Pediatria 2','Diurno · Box','Noturno · Clínico 1','Noturno · Clínico 2','Noturno · Clínico 3','Noturno · Clínico 4','Noturno · Pediatria 1','Noturno · Pediatria 2','Noturno · Box','Cinderela · 11h–17h','Cinderela · 12h–18h'];
const source=new Map(seed.assignments.map(a=>[`${a.date}|${a.slot}`,a.doctor]));
const get=(key,fallback)=>{try{return JSON.parse(storage.getItem(`rt-upa:${key}`))??fallback}catch{return fallback}};
const put=(key,value)=>storage.setItem(`rt-upa:${key}`,JSON.stringify(value));
const monthEl=document.querySelector('#month');months.forEach((m,i)=>monthEl.add(new Option(m,i+1)));monthEl.value='10';
WEEKDAYS.forEach((day,i)=>document.querySelector('#fixed-weekday').add(new Option(day,i)));
slotNames.forEach((name,i)=>document.querySelector('#fixed-slot').add(new Option(name,i)));
function doctors(){return ['',...doctorChoices(seed,storage)]}
const label=d=>d?d.replace(/\n/g,' · '):'— Vago —';
function fillDoctorSelect(select){const selected=select.value;select.replaceChildren();for(const doctor of doctors())select.add(new Option(label(doctor),doctor));select.value=selected||''}
function weekdayDoctor(weekday,slot){const date=fortnight(2026,10,1).find(d=>d.weekday===weekday);return date?source.get(`${date.date}|${slot}`)||'':''}
function baseline(date,slot){return plannedDoctor(seed,storage,date,slot);}
function storageKey(){return `edits:${document.querySelector('#year').value}:${monthEl.value}:${document.querySelector('#half').value}`}
function settings(){for(const id of ['fixed-doctor','absence-doctor'])fillDoctorSelect(document.querySelector(`#${id}`));
 const container=document.querySelector('#settings-list');container.replaceChildren();
 for(const [type,items,describe] of [['fixed',get('fixed',[]),item=>`${WEEKDAYS[item.weekday]} · ${slotNames[item.slot]} · ${label(item.doctor)}`],['absences',get('absences',[]),item=>`${label(item.doctor)} · ${item.start} a ${item.end}`]]){
  const heading=document.createElement('h3');heading.textContent=type==='fixed'?'Plantões fixos cadastrados':'Férias e afastamentos';container.append(heading);
  if(!items.length){const empty=document.createElement('p');empty.className='notice';empty.textContent='Nenhum registro.';container.append(empty)}
  items.forEach((item,index)=>{const entry=document.createElement('span');entry.className='entry';entry.append(document.createTextNode(describe(item)));const remove=document.createElement('button');remove.type='button';remove.textContent='Remover';remove.addEventListener('click',()=>{items.splice(index,1);put(type,items);settings();document.dispatchEvent(new Event('rt-schedule-changed'))});entry.append(remove);container.append(entry)})
 }
}
function renderVisitors(){
 const edits=get('visits:weekly',{});
 const order=[1,2,3,4,5,6,0];
 document.querySelector('#visits-head').innerHTML=`<tr><th>Visitador · 6 h</th>${order.map(day=>`<th>${WEEKDAYS[day].toUpperCase()}</th>`).join('')}</tr>`;
 const body=document.querySelector('#visits-body');body.replaceChildren();
 for(let line=0;line<2;line++){const row=document.createElement('tr'),title=document.createElement('td');title.textContent=`Visitador ${line+1}`;row.append(title);
  for(const weekday of order){const td=document.createElement('td'),key=`${weekday}|${line}`,base=seed.visits.find(v=>v.weekday===weekday&&v.line===line)?.doctor ?? '',selected=Object.hasOwn(edits,key)?edits[key]:base;
   if(selected!==base)td.classList.add('changed');if(!selected)td.classList.add('empty');
   const select=document.createElement('select');select.setAttribute('aria-label',`Visitador ${line+1}, ${WEEKDAYS[weekday]}`);
   const options=['',...doctorOptions(doctors().slice(1),selected)];for(const doctor of options)select.add(new Option(label(doctor),doctor));select.value=selected;
   select.addEventListener('change',()=>{const storage='visits:weekly',update=get(storage,{});if(select.value===base)delete update[key];else update[key]=select.value;put(storage,update);renderVisitors()});td.append(select);row.append(td)
  }body.append(row)
 }
}
function render(){let days;try{days=fortnight(Number(document.querySelector('#year').value),Number(monthEl.value),Number(document.querySelector('#half').value))}catch{return alert('Escolha um ano, mês e quinzena válidos.')}
 const edits=get(storageKey(),{}),absences=get('absences',[]),first=days[0].day,last=days.at(-1).day;
 document.querySelector('#summary').innerHTML=`<span><b>${first} a ${last} de ${months[days[0].month-1]} de ${days[0].year}</b></span><span>${days.length} dias</span><span id="count"></span><span id="alerts"></span>`;
 document.querySelector('#head').innerHTML=`<tr><th>Posto / turno</th>${days.map(d=>`<th>${d.weekdayName.toUpperCase()}<br>${String(d.day).padStart(2,'0')}/${String(d.month).padStart(2,'0')}</th>`).join('')}</tr>`;
 const overlaps=overlapIndex(seed,storage,days.map(d=>d.date));const body=document.querySelector('#body');body.replaceChildren();let changed=0,alerts=0,duplicatePosts=0;
 slotNames.slice(0,14).forEach((name,slot)=>{const row=document.createElement('tr');const title=document.createElement('td');title.textContent=name+(slot<7?" · 07h–19h · 12h":" · 19h–07h · 12h");row.append(title);
 for(const day of days){const td=document.createElement('td');const key=`${day.date}|${slot}`;const base=baseline(day.date,slot,day.weekday);const selected=Object.hasOwn(edits,key)?edits[key]:base;if(selected!==base){td.classList.add('changed');changed++}if(!selected)td.classList.add('empty');const select=document.createElement('select');select.setAttribute('aria-label',`${name} em ${day.date}`);
 const options=['',...doctorOptions(doctors().slice(1),selected)];for(const doctor of options)select.add(new Option((vacationConflicts(storage,doctor,day.date,slot).length?'⚠ EM FÉRIAS · ':'')+label(doctor),doctor));select.value=selected;
 select.addEventListener('change',()=>{registrarTroca(storage,{data:day.date,slot,saiu:selected,entrou:select.value});const update=get(storageKey(),{});if(select.value===base)delete update[key];else update[key]=select.value;put(storageKey(),update);document.dispatchEvent(new Event('rt-schedule-changed'))});td.append(select);
 const covers=segments(seed,storage,day.date,slot).filter(x=>x.coverage);if(covers.length){if(selected===base)changed++;select.value=covers[0].doctor;select.disabled=true;const note=document.createElement('small');note.textContent='Cobertura: '+covers.map(x=>x.doctor.replaceAll('\n',' · ')).join(' / ');td.append(note);td.classList.add('changed');}
 if(segments(seed,storage,day.date,slot).some(s=>s.doctor&&absences.some(a=>a.doctor===s.doctor&&a.start<=day.date&&day.date<=a.end))){td.style.outline='2px solid #d34c4c';const message=document.createElement('small');message.textContent='Afastamento cadastrado';td.append(message);alerts++}
 for(const seg of segments(seed,storage,day.date,slot)){for(const leave of vacationConflicts(storage,seg.doctor,day.date,slot)){td.classList.add('vacation-conflict');const warning=document.createElement('small');warning.className='vacation-warning';warning.textContent=vacationMessage(leave);td.append(warning);alerts++;}}
 const collisions=overlaps.get(`${day.date}|${slot}`)||[];if(collisions.length){duplicatePosts++;td.classList.add('overlap-conflict');for(const collision of collisions){const warning=document.createElement('small');warning.className='overlap-warning';warning.textContent=overlapMessage(collision);td.append(warning);}}
 row.append(td)}body.append(row);
 // Clínicos 1 a 4 são postos iguais: esta linha coloca o médico na primeira vaga livre de cada dia.
 if(slot===3||slot===10){const turno=slot===3?'dia':'noite',rotulo=slot===3?'Diurno':'Noturno',linha=document.createElement('tr');linha.className='grid-add-row';const titulo=document.createElement('td');titulo.textContent=`${rotulo} · + Adicionar clínico`;linha.append(titulo);
  for(const day of days){const td=document.createElement('td'),occ=clinicoOccupancy(seed,storage,day.date,turno);if(!occ.free.length){const ok=document.createElement('small');ok.textContent=`Completo · ${occ.total}/${occ.total}`;td.append(ok);}else{const escolha=document.createElement('select');escolha.setAttribute('aria-label',`Adicionar clínico ${rotulo.toLowerCase()} em ${day.date}`);escolha.add(new Option(`+ ${occ.free.length} ${occ.free.length===1?'vaga':'vagas'}`,''));for(const doctor of doctors().slice(1))escolha.add(new Option(label(doctor),doctor));
   escolha.addEventListener('change',()=>{if(!escolha.value)return;const destino=occ.free[0],update=get(storageKey(),{});registrarTroca(storage,{data:day.date,slot:destino,saiu:'',entrou:escolha.value});update[`${day.date}|${destino}`]=escolha.value;put(storageKey(),update);document.dispatchEvent(new Event('rt-schedule-changed'))});td.append(escolha);}linha.append(td);}body.append(linha);}
 });
 for(const select of document.querySelectorAll('#body select')){select.classList.add(affiliationClass(select.value));doctorSearchButton(select);}
 renderVisitors();
 document.querySelector('#count').textContent=`${changed} alterações`;const alertsEl=document.querySelector('#alerts');alertsEl.textContent=`${alerts} conflitos com afastamento · ${duplicatePosts} postos com choque de horário`;alertsEl.classList.toggle('clicavel',alerts+duplicatePosts>0);
}
// Clicar no resumo de conflitos abre a lista de afastamentos/férias e choques de horário da quinzena.
const conflitosDialog=document.createElement('dialog');conflitosDialog.className='review-dialog';document.body.append(conflitosDialog);
document.querySelector('#summary').addEventListener('click',event=>{
 if(!event.target.closest('#alerts'))return;
 let days;try{days=fortnight(Number(document.querySelector('#year').value),Number(monthEl.value),Number(document.querySelector('#half').value))}catch{return}
 const review=periodReview(seed,storage,days.map(d=>d.date));
 const nome=d=>String(d).split('\n')[0];const br=x=>x.split('-').reverse().join('/');
 conflitosDialog.replaceChildren();const form=document.createElement('form');form.method='dialog';
 form.append(Object.assign(document.createElement('h2'),{textContent:`Conflitos · ${days[0].day} a ${days.at(-1).day}/${String(days[0].month).padStart(2,'0')}`}));
 const secao=(titulo,itens)=>{if(!itens.length)return;const h=document.createElement('h3');h.textContent=`${titulo} · ${itens.length}`;const ul=document.createElement('ul');for(const t of itens){const li=document.createElement('li');li.textContent=t;ul.append(li)}form.append(h,ul)};
 secao('Médico de férias escalado',review.vacations.map(v=>`${br(v.date)} · ${slotNames[v.slot]} · ${nome(v.doctor)}`));
 secao('Médico afastado escalado',review.absences.map(v=>`${br(v.date)} · ${slotNames[v.slot]} · ${nome(v.doctor)}`));
 secao('Choque de horário',review.overlaps.map(o=>`${nome(o.other.doctor)} · ${br(o.date)} ${slotNames[o.slot]} × ${br(o.other.date)} ${slotNames[o.other.slot]}`));
 if(!review.vacations.length&&!review.absences.length&&!review.overlaps.length)form.append(Object.assign(document.createElement('p'),{textContent:'Nenhum conflito de afastamento ou choque de horário nesta quinzena.'}));
 const acoes=document.createElement('div');acoes.className='actions';const fechar=document.createElement('button');fechar.textContent='Fechar';acoes.append(fechar);form.append(acoes);
 conflitosDialog.append(form);conflitosDialog.showModal();
});
document.querySelector('#doctor-form').elements.name.addEventListener('input',event=>event.target.setCustomValidity(''));
document.querySelector('#doctor-form').addEventListener('submit',event=>{event.preventDefault();const data=new FormData(event.currentTarget);if(!String(data.get('name')).trim()){event.currentTarget.elements.name.setCustomValidity('Informe o nome do médico.');event.currentTarget.elements.name.reportValidity();return;}const doctor=canonicalDoctor(`${String(data.get('name')).trim().toUpperCase()}\nCRM ${String(data.get('crm')).trim()} - ${data.get('affiliation')}`);put('doctors',[...new Set([...get('doctors',[]),...get('roster',[]).map(x=>x.doctor).filter(Boolean),doctor])]);reincluirMedico(storage,doctor);event.currentTarget.reset();settings();document.dispatchEvent(new Event('rt-schedule-changed'))});
document.querySelector('#fixed-form').addEventListener('submit',event=>{event.preventDefault();const data=new FormData(event.currentTarget),rule={weekday:Number(data.get('weekday')),slot:Number(data.get('slot')),doctor:String(data.get('doctor'))};if(!rule.doctor)return alert('Selecione o médico.');const rules=get('fixed',[]).filter(r=>!(r.weekday===rule.weekday&&r.slot===rule.slot));rules.push(rule);put('fixed',rules);settings();document.dispatchEvent(new Event('rt-schedule-changed'))});
document.querySelector('#absence-form').addEventListener('submit',event=>{event.preventDefault();const data=new FormData(event.currentTarget),item={doctor:String(data.get('doctor')),start:String(data.get('start')),end:String(data.get('end'))};if(!item.doctor||item.start>item.end)return alert('Confira médico e período.');put('absences',[...get('absences',[]),item]);event.currentTarget.reset();settings();document.dispatchEvent(new Event('rt-schedule-changed'))});
document.querySelector('#generate').addEventListener('click',render);
// A quinzena abre sozinha ao trocar mês, ano ou quinzena; as setas andam uma quinzena por vez.
for(const id of ['year','month','half'])document.querySelector('#'+id).addEventListener('change',()=>document.querySelector('#generate').click());
for(const [id,passo] of [['prev-half',-1],['next-half',1]])document.querySelector('#'+id).addEventListener('click',()=>{const year=document.querySelector('#year'),half=document.querySelector('#half'),indice=Number(year.value)*24+(Number(monthEl.value)-1)*2+Number(half.value)-1+passo;year.value=Math.floor(indice/24);monthEl.value=String(Math.floor(indice%24/2)+1);half.value=String(indice%2+1);document.querySelector('#generate').click();});
document.querySelector('#reset').addEventListener('click',()=>{const count=Object.keys(get(storageKey(),{})).length,period=document.querySelector('#summary b')?.textContent||'esta quinzena';document.querySelector('.backup-menu').open=false;if(!count)return alert(`Nenhum ajuste feito à mão em ${period}. Nada para desfazer.`);if(confirm(`Desfazer ${count} ${count===1?'ajuste feito':'ajustes feitos'} à mão em ${period}?

A quinzena volta para a escala importada e os fixos. Coberturas, férias e outras quinzenas não mudam. Não dá para desfazer esta ação — se tiver dúvida, baixe antes uma cópia de segurança.`)){storage.removeItem(`rt-upa:${storageKey()}`);render();document.dispatchEvent(new Event('rt-schedule-changed'))}});
document.querySelector('#backup').addEventListener('click',()=>{const data={version:1,createdAt:new Date().toISOString(),items:{}};for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key.startsWith('rt-upa:'))data.items[key]=storage.getItem(key)}const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`rt-upa-copia-${new Date().toISOString().slice(0,10)}.json`;a.click();document.querySelector('.backup-menu').open=false;setTimeout(()=>URL.revokeObjectURL(a.href),1000)});
settings();render();
mountOrganizer(storage,seed);
// Módulo independente: uma falha no Fluxo de pacientes nunca pode impedir a escala de abrir.
try{mountFlow();mountEspera();mountDemand(storage,seed);}catch(error){console.error('Fluxo de pacientes',error);}
try{mountProduction(storage,seed);}catch(error){console.error('Produção médica',error);}
try{mountTrocas(storage,seed);}catch(error){console.error('Trocas detectadas',error);}
try{mountHistorico(storage);}catch(error){console.error('Histórico de trocas',error);}
try{mountAlertasEscala(storage,seed);}catch(error){console.error('Vagas e carga',error);}
try{mountVersoes(storage);}catch(error){console.error('Versões',error);}
try{mountResumo(storage,seed);}catch(error){console.error('Resumo do dia',error);}
try{mountCabecalho();mountAtencao(storage,seed);}catch(error){console.error('Médicos do plantão',error);}
mountScheduleView(storage,seed);
mountRoster(storage,seed);
mountPdf(storage);
mountQuickView(storage,seed);
mountAssistant(storage,seed);
document.querySelector('#fixed-form').hidden=true;
document.addEventListener("rt-schedule-changed",render);
document.addEventListener("rt-data-restored",()=>{settings();render();});
mountPush();

document.querySelector('#restore').addEventListener('click',()=>document.querySelector('#restore-file').click());
document.querySelector('#restore-file').addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;try{const data=JSON.parse(await file.text());if(data.version!==1||!data.items||typeof data.items!=='object'||Object.keys(data.items).some(key=>!key.startsWith('rt-upa:')||typeof data.items[key]!=='string'))throw new Error('Formato de backup inválido');document.querySelector('.backup-menu').open=false;const saved=/^\d{4}-\d{2}-\d{2}/.test(data.createdAt||'')?` de ${data.createdAt.slice(0,10).split('-').reverse().join('/')}`:'';if(!confirm(`Carregar a cópia${saved} (${Object.keys(data.items).length} registros)?

Os dados atuais com o mesmo tipo serão trocados pelos do arquivo e salvos online. Se tiver dúvida, baixe antes uma cópia de segurança do estado atual.`))return;for(const [key,value] of Object.entries(data.items))storage.setItem(key,value);settings();render();document.dispatchEvent(new Event('rt-data-restored'))}catch(error){alert(`Não foi possível restaurar: ${error.message}`)}finally{event.target.value=''}});

// Excel das cinderelas da quinzena escolhida no topo (o botão da aba Cinderelas usa o dia aberto na tela).
async function exportCinderelas(){const button=document.querySelector('#excel-cinderela'),year=Number(document.querySelector('#year').value),month=Number(monthEl.value),half=Number(document.querySelector('#half').value);button.disabled=true;button.textContent='Gerando Excel…';try{const items={};for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key.startsWith('rt-upa:'))items[key]=storage.getItem(key)}const date=`${year}-${String(month).padStart(2,'0')}-${half===1?'01':'16'}`;const response=await fetch('/api/export-cinderela',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date,items})});if(!response.ok)throw new Error(response.status===404?'Inicie o protótipo com py server.py, conforme COMO-ABRIR.txt.':'Não foi possível gerar agora. Confira seu acesso e tente novamente.');const a=document.createElement('a');a.href=URL.createObjectURL(await response.blob());a.download=nomeArquivo('cinderela',year,month,half);a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}catch(error){alert(`Exportação indisponível: ${error.message}`)}finally{button.disabled=false;button.textContent='Excel · cinderelas'}}
async function exportExcel(){const button=document.querySelector('#excel');button.disabled=true;button.textContent='Gerando Excel…';try{const items={};for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key.startsWith('rt-upa:'))items[key]=storage.getItem(key)}const response=await fetch('/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({year:Number(document.querySelector('#year').value),month:Number(monthEl.value),half:Number(document.querySelector('#half').value),items})});if(!response.ok)throw new Error(response.status===501?'Inicie o protótipo com py server.py, conforme COMO-ABRIR.txt.':await response.text());const blob=await response.blob();const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=nomeArquivo('regular',Number(document.querySelector('#year').value),Number(monthEl.value),Number(document.querySelector('#half').value));a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}catch(error){alert(`Exportação indisponível: ${error.message}`)}finally{button.disabled=false;button.textContent='Excel · escala 12 h'}}
// Conferência antes de exportar: mostra vagas, férias/afastamentos, choques de horário e CRMs
// repetidos da quinzena. Exportar continua possível, mas só depois de ver a lista.
const reviewDialog=document.createElement('dialog');reviewDialog.className='review-dialog';document.body.append(reviewDialog);
const shortDate=date=>{const d=new Date(date+'T12:00:00');return `${WEEKDAYS[d.getDay()].slice(0,3)} ${date.slice(8,10)}/${date.slice(5,7)}`};
const shortName=doctor=>String(doctor).split('\n')[0];
function reviewSection(title,hint,lines){
 if(!lines.length)return null;const section=document.createElement('section'),heading=document.createElement('h3'),help=document.createElement('p'),list=document.createElement('ul');
 heading.textContent=`${title} · ${lines.length}`;help.textContent=hint;
 for(const line of lines.slice(0,40)){const item=document.createElement('li');item.textContent=line;list.append(item)}
 if(lines.length>40){const more=document.createElement('li');more.textContent=`… e mais ${lines.length-40}`;list.append(more)}
 section.append(heading,help,list);return section;
}
document.querySelector('#excel-cinderela')?.addEventListener('click',exportCinderelas);
document.querySelector('#excel').addEventListener('click',()=>{
 let days;try{days=fortnight(Number(document.querySelector('#year').value),Number(monthEl.value),Number(document.querySelector('#half').value))}catch{return alert('Escolha um ano, mês e quinzena válidos.')}
 const review=periodReview(seed,storage,days.map(d=>d.date)),period=`${days[0].day} a ${days.at(-1).day} de ${months[days[0].month-1]} de ${days[0].year}`;
 reviewDialog.replaceChildren();const form=document.createElement('form');form.method='dialog';
 const title=document.createElement('h2');title.textContent=review.total?`Conferência · ${period}`:`Tudo certo · ${period}`;
 const intro=document.createElement('p');intro.textContent=review.total?'Confira os pontos abaixo antes de enviar a escala. Você pode voltar e corrigir, ou exportar assim mesmo — as vagas saem como VAGO na planilha.':'Nenhuma vaga, férias, afastamento, choque de horário ou problema de CRM nesta quinzena.';
 form.append(title,intro);
 for(const section of [
  reviewSection('Vagas sem médico','Postos que vão sair como VAGO no Excel.',review.vacancies.map(v=>`${shortDate(v.date)} · ${slots[v.slot]}`)),
  reviewSection('Médico em férias escalado','Férias cadastradas nas pendências.',review.vacations.map(v=>`${shortDate(v.date)} · ${slots[v.slot]} · ${shortName(v.doctor)}`)),
  reviewSection('Médico afastado escalado','Afastamentos cadastrados em Médicos e fixos.',review.absences.map(v=>`${shortDate(v.date)} · ${slots[v.slot]} · ${shortName(v.doctor)}`)),
  reviewSection('Choque de horário','O mesmo médico em dois postos ao mesmo tempo.',review.overlaps.map(o=>`${shortName(o.other.doctor)} · ${shortDate(o.date)} ${slots[o.slot]} × ${shortDate(o.other.date)} ${slots[o.other.slot]}`)),
  reviewSection('CRM repetido','O mesmo CRM aparece com nomes diferentes. Corrija o cadastro.',review.sharedCrm.map(c=>`CRM ${c.crm} · ${c.doctors.map(shortName).join(' / ')}`)),
  reviewSection('CRM a confirmar','Médicos escalados sem número de CRM. Complete em Médicos e fixos › CRM a confirmar (tem o botão Buscar no CFM).',review.missingCrm.map(shortName))
 ])if(section)form.append(section);
 const actions=document.createElement('div');actions.className='actions';
 const go=document.createElement('button');go.value='export';go.textContent=review.total?'Exportar assim mesmo':'Exportar Excel';
 const back=document.createElement('button');back.value='cancel';back.className='secondary';back.textContent=review.total?'Voltar e corrigir':'Cancelar';
 actions.append(go,back);form.append(actions);reviewDialog.append(form);
 reviewDialog.onclose=()=>{if(reviewDialog.returnValue==='export')exportExcel()};reviewDialog.returnValue='';reviewDialog.showModal();(review.total?back:go).focus();
});
