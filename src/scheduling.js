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
export function recurringRule(seed,storage,date,weekday,slot){
 const overrides=parse(storage,'roster',[]).filter(x=>x.start<=date&&x.weekday===weekday&&x.slot===slot).sort((a,b)=>b.start.localeCompare(a.start)||b.id.localeCompare(a.id));
 if(overrides.length)return {...overrides[0],status:'custom'};
 const legacy=parse(storage,'fixed',[]).find(x=>Number(x.weekday)===weekday&&Number(x.slot)===slot);if(legacy)return {...legacy,status:'custom'};
 if(slot>=14)return {...(seed.cinderelas||[]).find(x=>x.weekday===weekday&&x.slot===slot),status:'regular'};
 return patternFor(seed,date)?.rules.find(x=>x.weekday===weekday&&x.slot===slot);
}
export function plannedDoctor(seed,storage,date,slot){
 const weekday=new Date(date+'T12:00:00').getDay(),rule=recurringRule(seed,storage,date,weekday,slot);
 if(rule?.status==='custom')return rule.doctor;
 if(slot>=14)return rule?.doctor||'';
 const exact=seed.assignments.find(x=>x.date===date&&x.slot===slot);if(exact)return exact.doctor;
 return rule?.doctor||'';
}
export function baseDoctor(seed,storage,date,slot){const edits=parse(storage,periodKey(date),{}),key=`${date}|${slot}`;return Object.hasOwn(edits,key)?edits[key]:plannedDoctor(seed,storage,date,slot);}
export function segments(seed,storage,date,slot){const [start,end]=bounds(slot),base=baseDoctor(seed,storage,date,slot);const covers=parse(storage,'coverages',[]).filter(x=>x.confirmed&&x.date===date&&x.slot===slot).sort((a,b)=>a.start-b.start);const result=[];let cursor=start;for(const c of covers){if(c.start>cursor)result.push({start:cursor,end:c.start,doctor:base});result.push({...c,coverage:true});cursor=c.end;}if(cursor<end)result.push({start:cursor,end,doctor:base});return result;}
export function validateCoverage(item,existing){const [start,end]=bounds(item.slot);if(!Number.isInteger(item.slot)||item.slot<0||item.slot>15||!item.date||!item.doctor||!Number.isInteger(item.start)||!Number.isInteger(item.end)||item.start<start||item.end>end||item.start>=item.end)throw new Error('Confira data, posto, médico e intervalo da cobertura.');if(existing.some(x=>x.confirmed&&x.id!==item.id&&x.date===item.date&&x.slot===item.slot&&x.start<item.end&&item.start<x.end))throw new Error('Já existe uma cobertura confirmada nesse intervalo. Desfaça a anterior para substituí-la.');}
