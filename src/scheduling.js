export const slots=['Diurno · Clínico 1','Diurno · Clínico 2','Diurno · Clínico 3','Diurno · Clínico 4','Diurno · Pediatria 1','Diurno · Pediatria 2','Diurno · Box','Noturno · Clínico 1','Noturno · Clínico 2','Noturno · Clínico 3','Noturno · Clínico 4','Noturno · Pediatria 1','Noturno · Pediatria 2','Noturno · Box','Cinderela · 12h–18h','Cinderela · 18h–00h'];
export const bounds=slot=>slot===14?[12,18]:slot===15?[18,24]:slot<7?[7,19]:[19,31];
export const hour=n=>`${String(n%24).padStart(2,'0')}:00${n>=24?' (+1 dia)':''}`;
export const periodKey=date=>{const [y,m,d]=date.split('-').map(Number);return `edits:${y}:${m}:${d<=15?1:2}`;};
export const parse=(storage,key,fallback)=>{try{return JSON.parse(storage.getItem('rt-upa:'+key))??fallback;}catch{return fallback;}};
export const doctorIdentity=name=>String(name||'').split(/CRM/i)[0].normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]/g,'').toLowerCase();
export function vacationConflicts(storage,doctor,date,slot=0){
 if(!doctor)return [];
 const next=new Date(date+'T12:00:00');next.setDate(next.getDate()+1);
 const end=bounds(slot)[1]>24?`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}-${String(next.getDate()).padStart(2,'0')}`:date;
 return parse(storage,'organizer',[]).filter(x=>x.kind==='task'&&x.type==='Férias'&&doctorIdentity(x.doctor)===doctorIdentity(doctor)&&x.date&&x.endDate&&x.date<=end&&x.endDate>=date);
}
export const vacationMessage=item=>`Em férias de ${item.date.split('-').reverse().join('/')} a ${item.endDate.split('-').reverse().join('/')} — confira a escala.`;
export const affiliation=doctor=>/EXTRA/i.test(doctor)?'EXTRA SMS':/COAPH/i.test(doctor)?'COAPH':doctor?'SMS':'';
export const affiliationClass=doctor=>affiliation(doctor)==='COAPH'?'link-coaph':affiliation(doctor)==='EXTRA SMS'?'link-extra':'link-sms';
export function patternFor(seed,date){return (seed.patterns||[]).filter(x=>x.start<=date&&(!x.end||date<=x.end)).sort((a,b)=>b.start.localeCompare(a.start))[0];}

// Diurno/noturno · Clínico 1-4: quatro postos fisicamente iguais. Um médico pode
// ser cadastrado como "Clínico (qualquer)" em vez de preso a um número — ver
// genericClinicoDoctors. Eles só preenchem posições que sobrarem vagas; nunca
// substituem um médico já fixo/importado num número específico.
export const CLINICO_TURNS={dia:[0,1,2,3],noite:[7,8,9,10]};
const clinicoTurnForSlot=slot=>Object.keys(CLINICO_TURNS).find(turn=>CLINICO_TURNS[turn].includes(slot))||null;
export function genericClinicoDoctors(storage,date,weekday,turn){
 const rows=parse(storage,'clinicoRoster',[]).filter(x=>x.weekday===weekday&&x.turn===turn&&x.start<=date).sort((a,b)=>a.start.localeCompare(b.start)||a.id.localeCompare(b.id));
 const latest=new Map();for(const row of rows)latest.set(doctorIdentity(row.doctor),row);
 return [...latest.values()].filter(row=>row.active).map(row=>row.doctor).sort((a,b)=>a.localeCompare(b,'pt-BR'));
}
function pinnedRule(seed,storage,date,weekday,slot){
 const overrides=parse(storage,'roster',[]).filter(x=>x.start<=date&&x.weekday===weekday&&x.slot===slot).sort((a,b)=>b.start.localeCompare(a.start)||b.id.localeCompare(a.id));
 if(overrides.length)return {...overrides[0],status:'custom'};
 const legacy=parse(storage,'fixed',[]).find(x=>Number(x.weekday)===weekday&&Number(x.slot)===slot);if(legacy)return {...legacy,status:'custom'};
 if(slot>=14)return {...(seed.cinderelas||[]).find(x=>x.weekday===weekday&&x.slot===slot),status:'regular'};
 return patternFor(seed,date)?.rules.find(x=>x.weekday===weekday&&x.slot===slot);
}
// Igual a pinnedRule, mas também considera a escala exata importada (seed.assignments)
// quando não há padrão/roster cobrindo a data — é o que "reserva" um slot pra fins de
// preenchimento genérico, mesmo quando o único registro daquele dia é o histórico importado.
function nonGenericResolution(seed,storage,date,weekday,slot){
 const rule=pinnedRule(seed,storage,date,weekday,slot);
 if(rule?.status==='custom'||slot>=14)return rule;
 const exact=seed.assignments.find(x=>x.date===date&&x.slot===slot);
 if(exact)return {doctor:exact.doctor,status:'regular'};
 return rule;
}
export function recurringRule(seed,storage,date,weekday,slot){
 const turn=clinicoTurnForSlot(slot);
 if(!turn)return pinnedRule(seed,storage,date,weekday,slot);
 const group=CLINICO_TURNS[turn];
 const pinned=new Map(group.map(s=>[s,nonGenericResolution(seed,storage,date,weekday,s)]));
 const taken=new Set([...pinned.values()].filter(r=>r?.doctor).map(r=>doctorIdentity(r.doctor)));
 const pool=genericClinicoDoctors(storage,date,weekday,turn).filter(doctor=>!taken.has(doctorIdentity(doctor)));
 const emptySlots=group.filter(s=>!pinned.get(s)?.doctor);
 const index=emptySlots.indexOf(slot);
 if(index!==-1&&index<pool.length)return {doctor:pool[index],status:'custom',generic:true};
 return pinned.get(slot);
}
export function plannedDoctor(seed,storage,date,slot){
 const weekday=new Date(date+'T12:00:00').getDay(),rule=recurringRule(seed,storage,date,weekday,slot);
 if(rule?.status==='custom')return rule.doctor;
 if(slot>=14)return rule?.doctor||'';
 const exact=seed.assignments.find(x=>x.date===date&&x.slot===slot);if(exact)return exact.doctor;
 return rule?.doctor||'';
}
export function baseDoctor(seed,storage,date,slot){const edits=parse(storage,periodKey(date),{}),key=`${date}|${slot}`;return Object.hasOwn(edits,key)?edits[key]:plannedDoctor(seed,storage,date,slot);}
// Inclusão avulsa num turno de clínicos: o médico entra na primeira posição (1 a 4) sem médico
// e sem cobertura confirmada. O número só importa para a planilha oficial; quem usa não escolhe.
export function clinicoOccupancy(seed,storage,date,turn){
 const coverages=parse(storage,'coverages',[]).filter(x=>x.confirmed&&x.date===date);
 const doctors=[],free=[];
 for(const slot of CLINICO_TURNS[turn]){const doctor=baseDoctor(seed,storage,date,slot);if(doctor)doctors.push(doctor);else if(!coverages.some(x=>x.slot===slot))free.push(slot);}
 return {doctors,free,total:CLINICO_TURNS[turn].length};
}
export function segments(seed,storage,date,slot){const [start,end]=bounds(slot),base=baseDoctor(seed,storage,date,slot);const covers=parse(storage,'coverages',[]).filter(x=>x.confirmed&&x.date===date&&x.slot===slot).sort((a,b)=>a.start-b.start);const result=[];let cursor=start;for(const c of covers){if(c.start>cursor)result.push({start:cursor,end:c.start,doctor:base});result.push({...c,coverage:true});cursor=c.end;}if(cursor<end)result.push({start:cursor,end,doctor:base});return result;}
export function validateCoverage(item,existing){const [start,end]=bounds(item.slot);if(!Number.isInteger(item.slot)||item.slot<0||item.slot>15||!item.date||!item.doctor||!Number.isInteger(item.start)||!Number.isInteger(item.end)||item.start<start||item.end>end||item.start>=item.end)throw new Error('Confira data, posto, médico e intervalo da cobertura.');if(existing.some(x=>x.confirmed&&x.id!==item.id&&x.date===item.date&&x.slot===item.slot&&x.start<item.end&&item.start<x.end))throw new Error('Já existe uma cobertura confirmada nesse intervalo. Desfaça a anterior para substituí-la.');}

// Use calendar-day offsets, independent of the device timezone, including overnight hours.
export function overlapIndex(seed,storage,dates){
 const allDates=new Set(),byDoctor=new Map(),result=new Map();
 for(const date of dates)for(const offset of [-1,0,1])allDates.add(new Date(Date.parse(date+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10));
 for(const date of allDates)for(let slot=0;slot<16;slot++)for(const segment of segments(seed,storage,date,slot)){
  const identity=doctorIdentity(segment.doctor);if(!identity)continue;
  const midnight=Date.parse(date+'T00:00:00Z')/3600000;
  const item={date,slot,doctor:segment.doctor,start:segment.start,end:segment.end,from:midnight+segment.start,to:midnight+segment.end};
  if(!byDoctor.has(identity))byDoctor.set(identity,[]);byDoctor.get(identity).push(item);
 }
 const add=(a,b)=>{const key=`${a.date}|${a.slot}`;if(!result.has(key))result.set(key,[]);const found=result.get(key);if(!found.some(x=>x.date===b.date&&x.slot===b.slot&&doctorIdentity(x.doctor)===doctorIdentity(b.doctor)))found.push(b);};
 for(const entries of byDoctor.values()){entries.sort((a,b)=>a.from-b.from);for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length&&entries[j].from<entries[i].to;j++){const a=entries[i],b=entries[j];if(a.date===b.date&&a.slot===b.slot)continue;if(a.from<b.to&&b.from<a.to){add(a,b);add(b,a);}}}
 return result;
}
export function overlapMessage(conflict){return `⚠ HORÁRIO DUPLICADO: ${conflict.doctor.split(/CRM/i)[0].trim()} também está em ${slots[conflict.slot]} · ${conflict.date.split('-').reverse().join('/')} · ${hour(conflict.start)}–${hour(conflict.end)}.`;}
