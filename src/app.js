import {fortnight, WEEKDAYS} from './calendar.js';
import {connectStore} from './online-store.js';
let storage;
try { storage = await connectStore(); } catch(error) { document.querySelector('main').textContent = error.message; throw error; }
const seedResponse = await fetch('/src/seed.json');
if (!seedResponse.ok) { document.querySelector('main').textContent = 'Não foi possível carregar a escala. Entre novamente e recarregue a página.'; throw new Error('Seed indisponível'); }
const seed = await seedResponse.json();
const months=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const slotNames=['Diurno · Clínico 1','Diurno · Clínico 2','Diurno · Clínico 3','Diurno · Clínico 4','Diurno · Pediatria 1','Diurno · Pediatria 2','Diurno · Box','Noturno · Clínico 1','Noturno · Clínico 2','Noturno · Clínico 3','Noturno · Clínico 4','Noturno · Pediatria 1','Noturno · Pediatria 2','Noturno · Box'];
const source=new Map(seed.assignments.map(a=>[`${a.date}|${a.slot}`,a.doctor]));
const get=(key,fallback)=>{try{return JSON.parse(storage.getItem(`rt-upa:${key}`))??fallback}catch{return fallback}};
const put=(key,value)=>storage.setItem(`rt-upa:${key}`,JSON.stringify(value));
const monthEl=document.querySelector('#month');months.forEach((m,i)=>monthEl.add(new Option(m,i+1)));monthEl.value='10';
WEEKDAYS.forEach((day,i)=>document.querySelector('#fixed-weekday').add(new Option(day,i)));
slotNames.forEach((name,i)=>document.querySelector('#fixed-slot').add(new Option(name,i)));
function doctors(){return ['',...new Set([...seed.physicians,...get('doctors',[])])].sort((a,b)=>a.localeCompare(b,'pt-BR'))}
const label=d=>d?d.replace(/\n/g,' · '):'— Vago —';
function fillDoctorSelect(select){const selected=select.value;select.replaceChildren();for(const doctor of doctors())select.add(new Option(label(doctor),doctor));select.value=selected||''}
function weekdayDoctor(weekday,slot){const date=fortnight(2026,10,1).find(d=>d.weekday===weekday);return date?source.get(`${date.date}|${slot}`)||'':''}
function baseline(date,slot,weekday){
 const rule=get('fixed',[]).find(r=>Number(r.weekday)===weekday&&Number(r.slot)===slot);
 if(rule)return rule.doctor;
 if(source.has(`${date}|${slot}`))return source.get(`${date}|${slot}`);
 return '';
}
function storageKey(){return `edits:${document.querySelector('#year').value}:${monthEl.value}:${document.querySelector('#half').value}`}
function settings(){for(const id of ['fixed-doctor','absence-doctor'])fillDoctorSelect(document.querySelector(`#${id}`));
 const container=document.querySelector('#settings-list');container.replaceChildren();
 for(const [type,items,describe] of [['fixed',get('fixed',[]),item=>`${WEEKDAYS[item.weekday]} · ${slotNames[item.slot]} · ${label(item.doctor)}`],['absences',get('absences',[]),item=>`${label(item.doctor)} · ${item.start} a ${item.end}`]]){
  const heading=document.createElement('h3');heading.textContent=type==='fixed'?'Plantões fixos cadastrados':'Férias e afastamentos';container.append(heading);
  if(!items.length){const empty=document.createElement('p');empty.className='notice';empty.textContent='Nenhum registro.';container.append(empty)}
  items.forEach((item,index)=>{const entry=document.createElement('span');entry.className='entry';entry.append(document.createTextNode(describe(item)));const remove=document.createElement('button');remove.type='button';remove.textContent='Remover';remove.addEventListener('click',()=>{items.splice(index,1);put(type,items);settings();render()});entry.append(remove);container.append(entry)})
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
   const options=selected&&!doctors().includes(selected)?[...doctors(),selected]:doctors();for(const doctor of options)select.add(new Option(label(doctor),doctor));select.value=selected;
   select.addEventListener('change',()=>{const storage='visits:weekly',update=get(storage,{});if(select.value===base)delete update[key];else update[key]=select.value;put(storage,update);renderVisitors()});td.append(select);row.append(td)
  }body.append(row)
 }
}
function render(){let days;try{days=fortnight(Number(document.querySelector('#year').value),Number(monthEl.value),Number(document.querySelector('#half').value))}catch{return alert('Escolha um ano, mês e quinzena válidos.')}
 const edits=get(storageKey(),{}),absences=get('absences',[]),first=days[0].day,last=days.at(-1).day;
 document.querySelector('#summary').innerHTML=`<span><b>${first} a ${last} de ${months[days[0].month-1]} de ${days[0].year}</b></span><span>${days.length} dias</span><span id="count"></span><span id="alerts"></span>`;
 document.querySelector('#head').innerHTML=`<tr><th>Posto / turno</th>${days.map(d=>`<th>${d.weekdayName.toUpperCase()}<br>${String(d.day).padStart(2,'0')}/${String(d.month).padStart(2,'0')}</th>`).join('')}</tr>`;
 const body=document.querySelector('#body');body.replaceChildren();let changed=0,alerts=0;
 slotNames.forEach((name,slot)=>{const row=document.createElement('tr');const title=document.createElement('td');title.textContent=name;row.append(title);
 for(const day of days){const td=document.createElement('td');const key=`${day.date}|${slot}`;const base=baseline(day.date,slot,day.weekday);const selected=Object.hasOwn(edits,key)?edits[key]:base;if(selected!==base){td.classList.add('changed');changed++}if(!selected)td.classList.add('empty');const select=document.createElement('select');select.setAttribute('aria-label',`${name} em ${day.date}`);
 const options=selected&&!doctors().includes(selected)?[...doctors(),selected]:doctors();for(const doctor of options)select.add(new Option(label(doctor),doctor));select.value=selected;
 select.addEventListener('change',()=>{const update=get(storageKey(),{});if(select.value===base)delete update[key];else update[key]=select.value;put(storageKey(),update);render()});td.append(select);
 if(selected&&absences.some(a=>a.doctor===selected&&a.start<=day.date&&day.date<=a.end)){td.style.outline='2px solid #d34c4c';const message=document.createElement('small');message.textContent='Afastamento cadastrado';td.append(message);alerts++}
 row.append(td)}body.append(row)});
 renderVisitors();
 document.querySelector('#count').textContent=`${changed} alterações`;document.querySelector('#alerts').textContent=`${alerts} conflitos com afastamento`;
}
document.querySelector('#doctor-form').addEventListener('submit',event=>{event.preventDefault();const data=new FormData(event.currentTarget);const doctor=`${String(data.get('name')).trim().toUpperCase()}\nCRM ${String(data.get('crm')).trim()} - ${data.get('affiliation')}`;put('doctors',[...new Set([...get('doctors',[]),doctor])]);event.currentTarget.reset();settings();render()});
document.querySelector('#fixed-form').addEventListener('submit',event=>{event.preventDefault();const data=new FormData(event.currentTarget),rule={weekday:Number(data.get('weekday')),slot:Number(data.get('slot')),doctor:String(data.get('doctor'))};if(!rule.doctor)return alert('Selecione o médico.');const rules=get('fixed',[]).filter(r=>!(r.weekday===rule.weekday&&r.slot===rule.slot));rules.push(rule);put('fixed',rules);settings();render()});
document.querySelector('#absence-form').addEventListener('submit',event=>{event.preventDefault();const data=new FormData(event.currentTarget),item={doctor:String(data.get('doctor')),start:String(data.get('start')),end:String(data.get('end'))};if(!item.doctor||item.start>item.end)return alert('Confira médico e período.');put('absences',[...get('absences',[]),item]);event.currentTarget.reset();settings();render()});
document.querySelector('#generate').addEventListener('click',render);
document.querySelector('#reset').addEventListener('click',()=>{if(confirm('Restaurar os dados iniciais desta quinzena? No modo online, use Salvar online para confirmar.')){storage.removeItem(`rt-upa:${storageKey()}`);render()}});
document.querySelector('#backup').addEventListener('click',()=>{const data={version:1,createdAt:new Date().toISOString(),items:{}};for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key.startsWith('rt-upa:'))data.items[key]=storage.getItem(key)}const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`rt-upa-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)});
settings();render();

document.querySelector('#restore').addEventListener('click',()=>document.querySelector('#restore-file').click());
document.querySelector('#restore-file').addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;try{const data=JSON.parse(await file.text());if(data.version!==1||!data.items||typeof data.items!=='object'||Object.keys(data.items).some(key=>!key.startsWith('rt-upa:')||typeof data.items[key]!=='string'))throw new Error('Formato de backup inválido');if(!confirm('Restaurar este backup? Os registros com a mesma chave serão substituídos. No modo online, use Salvar online para confirmar.'))return;for(const [key,value] of Object.entries(data.items))storage.setItem(key,value);settings();render()}catch(error){alert(`Não foi possível restaurar: ${error.message}`)}finally{event.target.value=''}});

document.querySelector('#excel').addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;button.textContent='Gerando Excel…';try{const items={};for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key.startsWith('rt-upa:'))items[key]=storage.getItem(key)}const response=await fetch('/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({year:Number(document.querySelector('#year').value),month:Number(monthEl.value),half:Number(document.querySelector('#half').value),items})});if(!response.ok)throw new Error(response.status===501?'Inicie o protótipo com py server.py, conforme COMO-ABRIR.txt.':await response.text());const blob=await response.blob();const match=response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/);const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=match?.[1]||'escala-medica.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}catch(error){alert(`Exportação indisponível: ${error.message}`)}finally{button.disabled=false;button.textContent='Exportar Excel oficial'}});
