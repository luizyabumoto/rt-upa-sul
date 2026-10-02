import {parse,doctorIdentity,segments,slots,hour,recurringRule,affiliationClass,patternFor} from './scheduling.js';
export function cuiabaToday(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Cuiaba',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-');}
export function addDays(date,n){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
export function dayShifts(seed,storage,date){return slots.flatMap((label,slot)=>segments(seed,storage,date,slot).map(s=>({...s,date,slot,label})));}
export function pendingCovers(storage){const covers=parse(storage,'coverages',[]);return parse(storage,'organizer',[]).filter(t=>t.kind==='task'&&t.status!=='Resolvido').map(t=>({...t,missing:Math.max(0,(t.needed||1)-covers.filter(c=>c.taskId===t.id&&c.confirmed).length)})).filter(t=>t.missing>0&&(['Cobertura','Troca de plantão','Atestado / afastamento'].includes(t.type)||['Precisa de cobertura','Aguardando confirmação'].includes(t.status)||covers.some(c=>c.taskId===t.id&&!c.confirmed))).sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999'));}
// Clínicos, pediatras e box em blocos separados na escala do dia (cinderelas ficam sem subtítulo).
export const grupoDoPosto=slot=>slot>=14?'':slot%7<4?'Clínicos':slot%7<6?'Pediatras':'Box';
export function mountQuickView(storage,seed){
 const root=document.createElement('section');root.className='quick-view';root.innerHTML='<div class="section-heading"><div><p class="eyebrow">CONSULTA RÁPIDA</p><h2>Buscar médico</h2></div></div><label>Nome do médico<input id="quick-search" type="search" placeholder="Ex.: Thiago, Ana Paula…" autocomplete="off"></label><p class="notice">Plantões dos próximos 30 dias, dias fixos atuais e pendências. Datas futuras podem vir do padrão semanal.</p><div id="quick-results" aria-live="polite"></div><div class="section-heading"><h2>Coberturas para resolver</h2></div><div id="quick-covers" class="entry-list"></div>';
 // Escala de hoje e amanhã fica ao lado das pendências; a busca e as coberturas, logo abaixo.
 const dias=document.createElement('section');dias.className='quick-view quick-days-box';dias.innerHTML='<div class="section-heading"><div><h2>Escala de hoje e amanhã</h2><p id="quick-date"></p></div></div><div id="quick-days" class="day-cards"></div>';
 const overview=document.querySelector('#overview-panel'),slotHoje=overview.querySelector('[data-slot="hoje"]'),slotBusca=overview.querySelector('[data-slot="busca"]');
 if(slotHoje&&slotBusca){slotHoje.append(dias);slotBusca.append(root);}else{overview.querySelector('.welcome').after(root);root.prepend(dias);}
 const input=root.querySelector('input'),results=root.querySelector('#quick-results');let timer;
 const fmt=d=>d.split('-').reverse().join('/');const name=d=>d.split(/CRM/i)[0].trim();
 const el=(tag,text,cls)=>{const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;};
 function openDay(date,slot=0){document.querySelector('[data-view="schedule"]').click();document.dispatchEvent(new CustomEvent('rt-open-date',{detail:date}));document.dispatchEvent(new CustomEvent('rt-select-shift',{detail:slot}));}
 function dateButton(date,slot=0){const b=el('button','Ver escala','secondary');b.onclick=()=>openDay(date,slot);return b;}
 function taskRow(t){const row=el('div','', 'quick-row');row.append(el('strong',t.title),el('p',`${t.date?fmt(t.date):'Sem data'} · ${t.status}${t.missing!==undefined?' · faltam '+t.missing+' cobertura(s)':''}`));const b=el('button','Ver pendências','secondary');b.onclick=()=>document.querySelector('[data-view="tasks"]').click();row.append(b);return row;}
 function search(){results.replaceChildren();const q=doctorIdentity(input.value);if(q.length<2){results.append(el('p','Digite pelo menos 2 letras para buscar.','notice'));return;}
  const today=cuiabaToday(),all=[];for(let i=0;i<30;i++)all.push(...dayShifts(seed,storage,addDays(today,i)));
  const fixed=[];for(let w=0;w<7;w++)for(let slot=0;slot<16;slot++){const r=recurringRule(seed,storage,today,w,slot);if(r?.doctor)fixed.push({...r,weekday:w,slot});}
  const tasks=parse(storage,'organizer',[]).filter(t=>t.kind==='task'&&t.status!=='Resolvido');const covers=parse(storage,'coverages',[]);
  const names=new Map();for(const d of [...seed.physicians,...parse(storage,'doctors',[]),...all.map(x=>x.doctor),...fixed.map(x=>x.doctor),...tasks.map(x=>x.doctor),...covers.map(x=>x.doctor)])if(d&&doctorIdentity(d).includes(q)&&!names.has(doctorIdentity(d)))names.set(doctorIdentity(d),d);
  if(!names.size){results.append(el('p','Nenhum médico encontrado.'));return;}
  results.append(el('p',`${names.size} médico(s) encontrado(s). Mostrando até 12; digite mais letras para filtrar.`,'notice'));
  for(const [id,d] of [...names].sort((a,b)=>a[1].localeCompare(b[1],'pt-BR')).slice(0,12)){
   const card=el('article','', 'shift-card');card.append(el('h3',name(d)));
   const shifts=all.filter(s=>doctorIdentity(s.doctor)===id);card.append(el('h4',`Próximos plantões · 30 dias (${shifts.length})`));
   for(const s of shifts.slice(0,5)){const line=el('div','', 'quick-row');line.append(el('p',`${fmt(s.date)} · ${s.label} · ${hour(s.start)}–${hour(s.end)}${s.coverage?' · cobertura confirmada':''}`),el('small',s.doctor.replaceAll('\n',' · ')),dateButton(s.date,s.slot));card.append(line);}
   if(!shifts.length)card.append(el('p','Nenhum plantão encontrado nos próximos 30 dias.'));
   if(shifts.length>5){const more=document.createElement('details');more.append(el('summary',`Ver outros ${shifts.length-5} plantões`));for(const s of shifts.slice(5)){const p=el('div','', 'quick-row');p.append(el('p',`${fmt(s.date)} · ${s.label} · ${hour(s.start)}–${hour(s.end)}${s.coverage?' · cobertura confirmada':''}`),dateButton(s.date,s.slot));more.append(p);}card.append(more);}
   card.append(el('h4','Dias fixos vigentes hoje'));const rules=fixed.filter(r=>doctorIdentity(r.doctor)===id);for(const r of rules)card.append(el('p',`${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][r.weekday]} · ${slots[r.slot]} · ${r.doctor.replaceAll('\n',' · ')}`));if(!rules.length)card.append(el('p','Sem dia fixo identificado.'));
   const linked=tasks.filter(t=>doctorIdentity(t.doctor)===id||covers.some(c=>c.taskId===t.id&&doctorIdentity(c.doctor)===id));card.append(el('h4',`Pendências em aberto (${linked.length})`));for(const t of linked)card.append(taskRow(t));results.append(card);
  }
 }
 function render(){const today=cuiabaToday();dias.querySelector('#quick-date').textContent='Horário de Cuiabá · '+fmt(today);const horaAgora=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Cuiaba',hour:'2-digit',hour12:false}).format(new Date()))%24,turnoAberto=horaAgora>=19?7:0;const days=dias.querySelector('#quick-days');days.replaceChildren();
  for(const [i,title] of ['Hoje','Amanhã'].entries()){const date=addDays(today,i),card=el('article','', 'shift-card');card.append(el('h3',`${title} · ${fmt(date)}`),dateButton(date));if(!seed.assignments.some(a=>a.date===date)&&!patternFor(seed,date))card.append(el('p','Sem escala médica importada ou padrão para este dia.','notice'));
   for(const [label,lo,hi] of [['Diurno · 07h–19h',0,7],['Noturno · 19h–07h',7,14],['Cinderelas · 6h',14,16]]){const detail=document.createElement('details');detail.open=i===0&&lo===turnoAberto;detail.append(el('summary',label));let grupoAtual='';for(const s of dayShifts(seed,storage,date).filter(s=>s.slot>=lo&&s.slot<hi)){const grupo=grupoDoPosto(s.slot);if(grupo&&grupo!==grupoAtual){grupoAtual=grupo;detail.append(el('h5',grupo,`quick-grupo ${grupo==='Pediatras'?'ped':grupo==='Box'?'box':'cli'}`));}const exact=seed.assignments.find(a=>a.date===date&&a.slot===s.slot);const text=s.doctor?name(s.doctor):exact?.availability==='not-scheduled'||s.slot>=14&&[0,6].includes(new Date(date+'T12:00:00').getDay())?'Sem plantão previsto':'Vago / sem médico definido';const p=el('p',`${slots[s.slot].split(' · ').slice(1).join(' · ')}: ${text}${s.coverage?' · cobertura confirmada':''}`,affiliationClass(s.doctor));detail.append(p);}card.append(detail);}days.append(card);
  }
  const covers=root.querySelector('#quick-covers'),pending=pendingCovers(storage);covers.replaceChildren();if(!pending.length)covers.append(el('p','Nenhuma cobertura pendente registrada.','empty-state'));else for(const t of pending)covers.append(taskRow(t));search();
 }
 input.oninput=()=>{clearTimeout(timer);timer=setTimeout(search,180);};document.addEventListener('rt-schedule-changed',render);document.addEventListener('rt-data-restored',render);document.addEventListener('visibilitychange',()=>{if(!document.hidden)render();});setInterval(()=>{if(!document.hidden)render();},60000);render();
}
