export const slots=['Diurno · Clínico 1','Diurno · Clínico 2','Diurno · Clínico 3','Diurno · Clínico 4','Diurno · Pediatria 1','Diurno · Pediatria 2','Diurno · Box','Noturno · Clínico 1','Noturno · Clínico 2','Noturno · Clínico 3','Noturno · Clínico 4','Noturno · Pediatria 1','Noturno · Pediatria 2','Noturno · Box','Cinderela · 11h–17h','Cinderela · 12h–18h'];
// Cinderelas: até 30/09/2026 eram 12h–18h e 18h–00h; a partir de 01/10/2026, 11h–17h e 12h–18h.
// Sem data, vale o horário atual (usado nos rótulos de formulários).
export const CINDERELAS_NOVAS='2026-10-01';
export const bounds=(slot,date=CINDERELAS_NOVAS)=>slot===14?(date>=CINDERELAS_NOVAS?[11,17]:[12,18]):slot===15?(date>=CINDERELAS_NOVAS?[12,18]:[18,24]):slot<7?[7,19]:[19,31];
export const hour=n=>`${String(n%24).padStart(2,'0')}:00${n>=24?' (+1 dia)':''}`;
export const periodKey=date=>{const [y,m,d]=date.split('-').map(Number);return `edits:${y}:${m}:${d<=15?1:2}`;};
export const parse=(storage,key,fallback)=>{try{return JSON.parse(storage.getItem('rt-upa:'+key))??fallback;}catch{return fallback;}};
// Chamada milhares de vezes a cada atualização da tela, sempre com os mesmos nomes: o resultado fica guardado.
const identityCache=new Map();
export const doctorIdentity=name=>{const key=String(name||'');let id=identityCache.get(key);if(id===undefined){id=key.split(/CRM/i)[0].normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]/g,'').toLowerCase();if(identityCache.size>20000)identityCache.clear();identityCache.set(key,id);}return id;};
export function vacationConflicts(storage,doctor,date,slot=0){
 if(!doctor)return [];
 const next=new Date(date+'T12:00:00');next.setDate(next.getDate()+1);
 const end=bounds(slot,date)[1]>24?`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}-${String(next.getDate()).padStart(2,'0')}`:date;
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
function nonGenericResolution(seed,storage,date,weekday,slot,soFixo=false){
 const rule=pinnedRule(seed,storage,date,weekday,slot);
 if(rule?.status==='custom'||slot>=14||soFixo)return rule;
 // A escala importada só vale para o próprio dia: consultando outro dia da semana (aba Médicos e fixos),
 // ela não pode ser repetida como se fosse fixo daquele dia.
 const exact=new Date(date+'T12:00:00').getDay()===weekday&&seed.assignments.find(x=>x.date===date&&x.slot===slot);
 if(exact)return {doctor:exact.doctor,status:'regular'};
 return rule;
}
// soFixo: só o padrão (fixos do site, padrão importado, genéricos), sem a escala importada do próprio dia —
// é o que as telas de dias fixos precisam; a escala do dia (plannedDoctor) continua usando a importada.
export function recurringRule(seed,storage,date,weekday,slot,soFixo=false){
 const turn=clinicoTurnForSlot(slot);
 if(!turn)return pinnedRule(seed,storage,date,weekday,slot);
 const group=CLINICO_TURNS[turn];
 const pinned=new Map(group.map(s=>[s,nonGenericResolution(seed,storage,date,weekday,s,soFixo)]));
 const taken=new Set([...pinned.values()].filter(r=>r?.doctor).map(r=>doctorIdentity(r.doctor)));
 const pool=genericClinicoDoctors(storage,date,weekday,turn).filter(doctor=>!taken.has(doctorIdentity(doctor)));
 const emptySlots=group.filter(s=>!pinned.get(s)?.doctor);
 const index=emptySlots.indexOf(slot);
 if(index!==-1&&index<pool.length)return {doctor:pool[index],status:'custom',generic:true};
 return pinned.get(slot);
}
// Médico previsto sem olhar férias: fixo do site, cinderela, escala importada do dia ou padrão.
export function plannedSemFerias(seed,storage,date,slot){
 const weekday=new Date(date+'T12:00:00').getDay(),rule=recurringRule(seed,storage,date,weekday,slot);
 if(rule?.status==='custom'||slot>=14)return rule?.doctor||'';
 const exact=seed.assignments.find(x=>x.date===date&&x.slot===slot);if(exact)return exact.doctor;
 return rule?.doctor||'';
}
// Férias bloqueiam o médico em toda a escala do período (fixos, padrão e escala importada): entra o substituto
// lançado nas férias (se ele não estiver de férias também) ou o posto fica vago. Acabou o período, volta sozinho.
// Edições feitas à mão continuam valendo (com alerta vermelho se puserem alguém de férias).
export function plannedDoctor(seed,storage,date,slot){
 const doctor=plannedSemFerias(seed,storage,date,slot);
 const ferias=doctor?vacationConflicts(storage,doctor,date,slot):[];
 if(!ferias.length)return doctor;
 const sub=ferias.find(f=>f.substituto)?.substituto||'';
 return sub&&!vacationConflicts(storage,sub,date,slot).length?sub:'';
}
// Plantões do médico no período (pelo previsto, sem contar as férias): o que as férias vão liberar.
export function plantoesNoPeriodo(seed,storage,doctor,inicio,fim){
 const lista=[],id=doctorIdentity(doctor);
 for(const d=new Date(inicio+'T12:00:00'),f=new Date(fim+'T12:00:00');d<=f;d.setDate(d.getDate()+1)){
  const date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,edits=parse(storage,periodKey(date),{});
  for(let slot=0;slot<16;slot++){const key=`${date}|${slot}`,quem=Object.hasOwn(edits,key)?edits[key]:plannedSemFerias(seed,storage,date,slot);if(quem&&doctorIdentity(quem)===id)lista.push({date,slot,manual:Object.hasOwn(edits,key)});}
 }
 return lista;
}
// Clínicos 1 a 4 (e noturnos 1 a 4) são o mesmo grupo: o número do posto não importa.
// Pôr no posto A um médico que já está no posto B do mesmo turno TROCA os dois de lugar (B recebe quem
// estava em A): nada de "horário duplicado" nem troca falsa no histórico, porque a equipe do turno é a mesma.
export function definirPosto(seed,storage,date,slot,doctor){
 const turn=clinicoTurnForSlot(slot),key=periodKey(date),edits=parse(storage,key,{});
 const saiu=baseDoctor(seed,storage,date,slot);
 const outro=turn&&doctor?CLINICO_TURNS[turn].find(s=>s!==slot&&doctorIdentity(baseDoctor(seed,storage,date,s))===doctorIdentity(doctor)):undefined;
 edits[`${date}|${slot}`]=doctor;
 if(outro!==undefined)edits[`${date}|${outro}`]=saiu;
 for(const s of [slot,outro])if(s!==undefined&&edits[`${date}|${s}`]===plannedDoctor(seed,storage,date,s))delete edits[`${date}|${s}`];
 storage.setItem('rt-upa:'+key,JSON.stringify(edits));
 return {saiu,trocouDeLugar:outro!==undefined,outro};
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
export function segments(seed,storage,date,slot){const [start,end]=bounds(slot,date),base=baseDoctor(seed,storage,date,slot);const covers=parse(storage,'coverages',[]).filter(x=>x.confirmed&&x.date===date&&x.slot===slot).sort((a,b)=>a.start-b.start);const result=[];let cursor=start;for(const c of covers){if(c.start>cursor)result.push({start:cursor,end:c.start,doctor:base});result.push({...c,coverage:true});cursor=c.end;}if(cursor<end)result.push({start:cursor,end,doctor:base});return result;}
export function validateCoverage(item,existing){const [start,end]=bounds(item.slot,item.date);if(!Number.isInteger(item.slot)||item.slot<0||item.slot>15||!item.date||!item.doctor||!Number.isInteger(item.start)||!Number.isInteger(item.end)||item.start<start||item.end>end||item.start>=item.end)throw new Error('Confira data, posto, médico e intervalo da cobertura.');if(existing.some(x=>x.confirmed&&x.id!==item.id&&x.date===item.date&&x.slot===item.slot&&x.start<item.end&&item.start<x.end))throw new Error('Já existe uma cobertura confirmada nesse intervalo. Desfaça a anterior para substituí-la.');}

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

// Conferência antes de exportar a quinzena. "Vaga" segue o mesmo critério do Excel
// (export_excel.py): posto sem médico vira VAGO, exceto o "X" da planilha importada
// (não previsto) quando ninguém alterou nem fixou aquele posto.
const crmNumber=doctor=>(String(doctor||'').match(/CRM\D*(\d+)/i)||[])[1]||'';
export function periodReview(seed,storage,dates){
 const vacancies=[],vacations=[],absences=[],overlaps=[],seenOverlap=new Set(),byCrm=new Map(),missing=new Map();
 const roster=parse(storage,'roster',[]),fixed=parse(storage,'fixed',[]),leaves=parse(storage,'absences',[]),index=overlapIndex(seed,storage,dates);
 for(const date of dates){
  const weekday=new Date(date+'T12:00:00').getDay(),edits=parse(storage,periodKey(date),{});
  for(let slot=0;slot<14;slot++){
   const parts=segments(seed,storage,date,slot);
   if(parts.some(part=>!part.doctor)){
    const exact=seed.assignments.find(x=>x.date===date&&x.slot===slot);
    const overridden=Object.hasOwn(edits,`${date}|${slot}`)||roster.some(r=>r.start<=date&&r.weekday===weekday&&r.slot===slot)||fixed.some(r=>Number(r.weekday)===weekday&&Number(r.slot)===slot);
    if(overridden||exact?.availability!=='not-scheduled')vacancies.push({date,slot});
   }
   for(const part of parts){
    if(!part.doctor)continue;
    for(const leave of vacationConflicts(storage,part.doctor,date,slot))vacations.push({date,slot,doctor:part.doctor,leave});
    if(leaves.some(a=>a.doctor===part.doctor&&a.start<=date&&date<=a.end))absences.push({date,slot,doctor:part.doctor});
    const crm=crmNumber(part.doctor);if(!crm)missing.set(doctorIdentity(part.doctor),part.doctor);if(crm){if(!byCrm.has(crm))byCrm.set(crm,new Map());byCrm.get(crm).set(doctorIdentity(part.doctor),part.doctor);}
   }
   for(const other of index.get(`${date}|${slot}`)||[]){
    const pair=[`${date}|${slot}`,`${other.date}|${other.slot}`].sort().join('~')+'~'+doctorIdentity(other.doctor);
    if(!seenOverlap.has(pair)){seenOverlap.add(pair);overlaps.push({date,slot,other});}
   }
  }
 }
 const sharedCrm=[...byCrm].filter(([,names])=>names.size>1).map(([crm,names])=>({crm,doctors:[...names.values()]}));
 const missingCrm=[...missing.values()];
 return {vacancies,vacations,absences,overlaps,sharedCrm,missingCrm,total:vacancies.length+vacations.length+absences.length+overlaps.length+sharedCrm.length+missingCrm.length};
}

// Cadastro único por médico. O texto "NOME\nCRM número - VÍNCULO" continua sendo o formato
// gravado (a planilha oficial depende dele), mas nome, CRM e vínculo são padronizados e o
// mesmo médico aparece uma vez só nas listas; o vínculo é escolhido em cada plantão.
export const AFFILIATIONS=['SMS','COAPH','EXTRA SMS'];
const NAME_FIXES={gustavoluizsilacampos:'GUSTAVO LUIZ SILVA CAMPOS',blayraborges:'BLAYRA BORGES BARBOSA',josepedromarchryvacari:'JOSÉ PEDRO MACHRY VACARI',
 // Nomes como estão no Gestor Saúde (fonte mais confiável), para a produção bater com a escala.
 anakellenpadilha:'ANA KELLEN PADILHA CORREIA DE LIMA',anapaulamachadodasilvadeoliveira:'ANA PAULA MACHADO DA SILVA OLIVEIRA',
 ceciliacopettidambros:'CECÍLIA COPETTI DAMBRÓS',jheniferalvesflores:'JHENIFFER ALVES FLORES',joaovictorlinodasilva:'JOAO VITOR LINO DA SILVA',
 leticiailkiufrancelino:'LETICIA ILKIU FRANCELINO',luiseduardobrescancim:'LUÍS EDUARDO BRESCANCIM',mariaclaratrettel:'MARIA CLARA TRETTEL DE OLIVEIRA',
 rafaelfariasgolembra:'RAFAEL FARIAS GOLEMBA',rafaelgabrielgarlindalbo:'RAFAEL GABRIEL GARLINI DAL BO',raynasouzagoncalves:'RAYNA FERRER DE SOUZA GONCALVES',
 silviacorreiaramosribeiro:'SILVIA CORREA RAMOS RIBEIRO',thaisguimaraesdesouza:'THAIS GUIMARAES DE SOUZA'};
// CRM 17422 é da Ingrid; o do José Pedro vinha repetido (ou "A CONFIRMAR") e é 17877.
const CRM_FIXES={josepedromachryvacari:{from:['17422',''],to:'17877'}};
export const MISSING_CRM='A CONFIRMAR';
const DOCTOR_TEXT=/^[^\n]+\nCRM\s*(\d+|A CONFIRMAR)?\s*-?\s*(EXTRA\s*SMS|COAPH|SMS)?\s*$/i;
const canonicalCache=new Map();
export function canonicalDoctor(doctor){
 if(typeof doctor!=='string')return canonicalUncached(doctor);
 let v=canonicalCache.get(doctor);if(v===undefined){v=canonicalUncached(doctor);if(canonicalCache.size>20000)canonicalCache.clear();canonicalCache.set(doctor,v);}return v;
}
function canonicalUncached(doctor){
 if(typeof doctor!=='string'||!DOCTOR_TEXT.test(doctor))return doctor;
 let name=doctor.split(/CRM/i)[0].replace(/\s+/g,' ').trim().toUpperCase();
 name=NAME_FIXES[doctorIdentity(name)]||name;
 let crm=crmNumber(doctor);const fix=CRM_FIXES[doctorIdentity(name)];if(fix&&fix.from.includes(crm))crm=fix.to;
 return `${name}\nCRM ${crm||MISSING_CRM} - ${affiliation(doctor)}`;
}
export const withAffiliation=(doctor,link)=>doctor?`${doctor.split('\n')[0]}\nCRM ${crmNumber(doctor)||MISSING_CRM} - ${link}`:doctor;
export const doctorLabel=doctor=>{const crm=crmNumber(doctor);return `${String(doctor).split('\n')[0]} · ${crm?'CRM '+crm:'CRM a confirmar'}`;};
// Troca, em qualquer estrutura JSON, os textos de médico pela forma padronizada.
export function canonicalizeDeep(value){
 if(typeof value==='string')return canonicalDoctor(value);
 if(Array.isArray(value))return value.map(canonicalizeDeep);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,canonicalizeDeep(v)]));
 return value;
}
// Padroniza o que já está salvo na conta (edições, fixos, coberturas, pendências...). Só grava o que mudou.
export function canonicalizeStorage(storage){
 let changed=0;const keys=[];for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key?.startsWith('rt-upa:'))keys.push(key);}
 for(const key of keys){const raw=storage.getItem(key);let value;try{value=JSON.parse(raw);}catch{continue;}const next=JSON.stringify(canonicalizeDeep(value));if(next!==raw&&next!==JSON.stringify(value)){storage.setItem(key,next);changed++;}}
 return changed;
}
// Um item por médico, com o vínculo mais usado por ele como sugestão.
// A lista de médicos só muda quando mudam o cadastro, os fixos ou os excluídos: fica guardada até lá.
let choicesCache={chave:null,seed:null,lista:[]};
export function doctorChoices(seed,storage){
 const chave=['doctors','roster','excluidos'].map(k=>storage.getItem('rt-upa:'+k)||'').join('\u0001');
 if(choicesCache.seed===seed&&choicesCache.chave===chave)return [...choicesCache.lista];
 const lista=doctorChoicesUncached(seed,storage);choicesCache={chave,seed,lista};return [...lista];
}
function doctorChoicesUncached(seed,storage){
 const counts=new Map(),add=(doctor,weight)=>{if(!doctor||!DOCTOR_TEXT.test(doctor))return;const key=doctorIdentity(doctor);if(!counts.has(key))counts.set(key,new Map());const byText=counts.get(key);byText.set(doctor,(byText.get(doctor)||0)+weight);};
 for(const doctor of [...seed.physicians,...parse(storage,'doctors',[]),...parse(storage,'roster',[]).map(x=>x.doctor)])add(canonicalDoctor(doctor),0);
 for(const item of seed.assignments)add(item.doctor,1);
 for(const pattern of seed.patterns||[])for(const rule of pattern.rules||[])add(rule.doctor,1);
 const pick=byText=>[...byText].sort((a,b)=>b[1]-a[1]||(crmNumber(a[0])?0:1)-(crmNumber(b[0])?0:1)||AFFILIATIONS.indexOf(affiliation(a[0]))-AFFILIATIONS.indexOf(affiliation(b[0])))[0][0];
 const removed=new Set(parse(storage,'excluidos',[]).map(x=>x.id));
 return [...counts.values()].map(pick).filter(d=>!removed.has(doctorIdentity(d))).sort((a,b)=>a.localeCompare(b,'pt-BR'));
}
// Lista para um seletor: o médico atual aparece com o vínculo que já está no plantão.
export function doctorOptions(choices,current){
 if(!current)return choices;const key=doctorIdentity(current);
 return choices.some(d=>doctorIdentity(d)===key)?choices.map(d=>doctorIdentity(d)===key?current:d):[...choices,current];
}
