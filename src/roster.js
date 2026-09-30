import {doctorPicker,searchText} from './doctor-picker.js';
import {slots,bounds,hour,parse,doctorIdentity,affiliation,affiliationClass,recurringRule,patternFor,CLINICO_TURNS,MISSING_CRM} from './scheduling.js';
import {excluidos,excluirMedico,excluirDiasFixos,fixosDoMedico,atualizarCrm,crmAConfirmar,CFM_BUSCA,quadroFixos,ORDEM_SEMANA,postoClinicoParaFixo} from './cadastro.js';
const slotLabel=i=>`${slots[i]} · ${hour(bounds(i)[0])}–${hour(bounds(i)[1])}`;
const days=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
const fmt=value=>value.split('-').reverse().join('/');
export function mountRoster(storage,seed){
 const root=document.querySelector('#roster-panel');
 root.innerHTML=`<div class="section-heading"><div><p class="eyebrow">PADRÃO PARA AS PRÓXIMAS ESCALAS</p><h2>Médicos e dias fixos</h2></div><button id="roster-add">+ Novo dia fixo</button></div><p>Consulte por data. Mudanças valem a partir do dia informado e mantêm o histórico anterior. A escala usa os padrões automaticamente em períodos novos; ajustes pontuais e coberturas confirmadas têm prioridade.</p><div class="form-grid"><label>Ver os fixos do dia<input id="roster-date" type="date" required><small id="roster-date-label"></small></label><label>Buscar médico<input id="roster-search" type="search" placeholder="Digite parte do nome"></label></div><p id="roster-source" class="notice"></p><p class="link-legend"><span class="affiliation link-sms">SMS · fixo</span> <span class="affiliation link-coaph">COAPH</span> <span class="affiliation link-extra">Extra SMS · repetição somente se você configurar</span></p><section id="crm-pendentes" class="crm-pendentes" hidden></section><details id="doctor-registry"><summary>Cadastro de médicos e CRM · incluir médico de cobertura</summary><p>O cadastro fica salvo na sua conta online e disponível nas sugestões. Cadastrar um médico não cria plantões.</p><div id="registry-form"></div><p id="registry-status" role="status"></p><label>Consultar cadastro por nome ou CRM<input id="registry-search" type="search"></label><div id="registry-list"></div></details><div class="schedule-tabs roster-vistas" role="tablist"><button type="button" data-vista="quadro">Quadro da semana</button><button type="button" data-vista="medicos">Por médico</button></div><section id="quadro-fixos" class="quadro-fixos"></section><div id="roster-cards" class="day-cards"></div><details><summary id="roster-review-title">Postos para revisar</summary><div id="roster-review"></div></details><details id="roster-missing-block"><summary id="roster-missing-title">Cadastrados sem nenhum dia fixo</summary><div id="roster-missing"></div></details><details><summary>Histórico das alterações de padrão</summary><div id="roster-history"></div></details><dialog class="coverage-dialog" id="roster-dialog"><form><h2 id="roster-edit-title">Dia fixo</h2><label>Médico<select name="doctor" required></select></label><div class="form-grid"><label>Vínculo neste plantão<select name="affiliation"><option>SMS</option><option>COAPH</option><option>EXTRA SMS</option></select></label><label>Dia da semana<select name="weekday"></select></label><label>Posto e horário<select name="slot"></select></label><label>Começa a valer em<input name="start" type="date" required><small class="roster-start-dica">Se a pessoa já é fixa, deixe esta data. Use uma data futura só para uma mudança programada.</small></label></div><button type="button" id="roster-next" class="secondary">Usar próxima quinzena</button><label id="roster-extra-label" hidden><input type="checkbox" name="repeatExtra"> Repetir este extra toda semana a partir da data informada</label><label><input type="checkbox" name="end"> Encerrar este dia fixo a partir da data informada</label><p id="roster-impact" role="status"></p><label id="roster-quem-sai-label" hidden>Os 4 clínicos deste dia já têm fixo. Quem sai?<select name="quemSai"></select></label><label id="roster-replace-label" hidden><input type="checkbox" name="replace"> Confirmo substituir o médico que ocupa esse posto no padrão</label><p class="notice">O vínculo pertence a este plantão. Alterar aqui não muda outros vínculos do mesmo médico. Extras importados continuam pontuais. Para repetir um extra, escolha EXTRA SMS e marque a repetição semanal. Ajustes por data e coberturas confirmadas continuam tendo prioridade.</p><fieldset id="roster-excluir-fixos" class="excluir-fixos" hidden><legend>Excluir dias fixos deste médico</legend><p class="notice">Marque os dias que deixam de ser fixos. Vale a partir da data em "Válido a partir de"; os dias anteriores não mudam e a escala já é atualizada. O médico continua no cadastro.</p><div class="excluir-lista"></div><button type="button" class="secondary danger" id="roster-excluir-sel" disabled>Excluir dias selecionados</button></fieldset><div class="actions"><button type="submit">Salvar mudança</button><button type="button" class="secondary" id="roster-cancel">Cancelar</button></div></form></dialog>`;
 const date=root.querySelector('#roster-date');date.value=document.querySelector('#schedule-date').value;
 const form=root.querySelector('#roster-dialog form'),dialog=root.querySelector('#roster-dialog');let original=null;
 // Um mesmo médico pode aparecer no histórico com mais de um vínculo (ex.: uma vez como EXTRA SMS,
 // outra como SMS). Ao escolher qual string representa a pessoa (pro <select>, pro cadastro, pro
 // resumo "sem dia fixo"), preferimos sempre SMS/COAPH a EXTRA — senão o formulário de "Novo dia
 // fixo" pré-seleciona "EXTRA SMS" sozinho, e salvar sem marcar "repetir toda semana" fica bloqueado
 // silenciosamente (some mensagem no aviso, o card nunca chega a ser criado). Foi provavelmente
 // isso que fez o dia fixo da Ana Kellen "sumir" — o cadastro dela no sistema começa como EXTRA SMS.
 const affiliationRank=d=>affiliation(d)==='SMS'?0:affiliation(d)==='COAPH'?1:2;
 const people=()=>{const map=new Map(),fora=excluidos(storage);for(const d of [...seed.physicians,...parse(storage,'doctors',[]),...parse(storage,'roster',[]).map(x=>x.doctor).filter(Boolean)]){const key=doctorIdentity(d),current=map.get(key);if(fora.has(key))continue;if(!current||affiliationRank(d)<affiliationRank(current))map.set(key,d);}return [...map.values()].sort((a,b)=>a.localeCompare(b,'pt-BR'));};
 const name=d=>d.split(/CRM/i)[0].trim();
 const changeDoctor=(d,link)=>`${name(d)}\nCRM ${d.match(/CRM\s*(\d+)/i)?.[1]||MISSING_CRM} - ${link}`;
 days.forEach((d,i)=>form.elements.weekday.add(new Option(d,i)));slots.forEach((s,i)=>form.elements.slot.add(new Option(slotLabel(i)+` · ${bounds(i)[1]-bounds(i)[0]}h`,i)));
 // "Clínico (qualquer)": o médico não fica preso ao número 1/2/3/4 — a posição exata é
 // decidida sozinha todo dia (ordem alfabética, só nos postos que sobrarem vagos).
 const addGenericOption=(value,label,beforeSlotIndex)=>{const before=[...form.elements.slot.options].find(o=>o.value===String(beforeSlotIndex));form.elements.slot.add(new Option(label,value),before||null);};
 addGenericOption('generic-dia','Diurno · Clínico (qualquer) · 12h',4);
 addGenericOption('generic-noite','Noturno · Clínico (qualquer) · 12h',11);
 // Clínicos 1 a 4 são iguais: aqui se escolhe só o turno; o número é um posto livre, decidido sozinho.
 addGenericOption('clinico-dia','Diurno · Clínico (um dos 4) · 07:00–19:00 · 12h',0);
 addGenericOption('clinico-noite','Noturno · Clínico (um dos 4) · 19:00–07:00 (+1 dia) · 12h',7);
 const NUMERADOS=[...CLINICO_TURNS.dia,...CLINICO_TURNS.noite].map(String);
 for(const o of form.elements.slot.options)if(NUMERADOS.includes(o.value)||o.value.startsWith('generic-')){o.hidden=true;o.disabled=true;}
 const turnoDoPosto=s=>CLINICO_TURNS.dia.includes(s)?'dia':CLINICO_TURNS.noite.includes(s)?'noite':null;
 // Posto real a gravar: clínico vai para um posto livre do turno; editando um fixo, ele continua no mesmo número.
 function resolverPosto(){
  const v=form.elements.slot.value,weekday=Number(form.elements.weekday.value),start=form.elements.start.value;
  if(!v.startsWith('clinico-'))return {slot:Number(v)};
  const turn=v.slice(8),grupo=CLINICO_TURNS[turn];
  if(original&&!original.generic&&original.weekday===weekday&&grupo.includes(original.slot))return {slot:original.slot,proprio:true};
  if(form.elements.end.checked)return {slot:null,nadaParaEncerrar:true};
  const r=postoClinicoParaFixo(seed,storage,start,weekday,grupo[0],form.elements.doctor.value||'');
  if(!r.livre){const q=form.elements.quemSai.value;return {slot:q?Number(q):null,cheio:true,ocupados:r.ocupados};}
  return {slot:r.slot,jaEsta:r.jaEsta,movido:r.movido};
 }
 const turnOf=r=>r?.turn||(r?.generic&&Number.isInteger(r.slot)?(CLINICO_TURNS.dia.includes(r.slot)?'dia':'noite'):null);
 function impact(){
  root.querySelector('#roster-impact').classList.remove('roster-impact-alert');root.querySelector('#roster-extra-label').classList.remove('roster-impact-alert');
  root.querySelector('#roster-extra-label').hidden=form.elements.affiliation.value!=='EXTRA SMS'||form.elements.end.checked;
  const start=form.elements.start.value,slotValue=form.elements.slot.value,weekday=Number(form.elements.weekday.value),generic=slotValue.startsWith('generic-');
  if(!start)return false;
  if(generic){
   root.querySelector('#roster-replace-label').hidden=true;
   const turnLabel=slotValue==='generic-dia'?'Diurno':'Noturno';
   root.querySelector('#roster-impact').textContent=form.elements.end.checked?`Este médico deixa de ser "${turnLabel} · Clínico (qualquer)" às ${days[weekday]}s a partir de ${fmt(start)}.`:`${days[weekday]} · ${turnLabel} · Clínico (qualquer), a partir de ${fmt(start)}. O número exato (1 a 4) é decidido sozinho todo dia, por ordem alfabética entre os médicos genéricos, só nos postos que sobrarem vagos — nunca troca quem já está fixo num número.`;
   return false;
  }
  const pos=resolverPosto(),quemSai=root.querySelector('#roster-quem-sai-label');
  quemSai.hidden=!pos.cheio;
  // A lista de "quem sai" é refeita quando muda o dia, o turno ou a data (senão ficava a de outro dia da semana).
  const chaveQuemSai=pos.cheio?`${weekday}|${slotValue}|${start}|${pos.ocupados.map(o=>o.slot+':'+o.doctor).join(';')}`:'';
  if(form.elements.quemSai.dataset.chave!==chaveQuemSai){const antes=form.elements.quemSai.value;form.elements.quemSai.replaceChildren();form.elements.quemSai.dataset.chave=chaveQuemSai;if(pos.cheio){form.elements.quemSai.add(new Option('— escolha quem deixa de ser fixo —',''));for(const o of pos.ocupados)form.elements.quemSai.add(new Option(name(o.doctor),o.slot));}form.elements.quemSai.value='';return impact();}
  if(pos.slot===null){
   root.querySelector('#roster-replace-label').hidden=true;
   root.querySelector('#roster-impact').textContent=pos.cheio?`Os 4 clínicos de ${days[weekday].toLowerCase()} (${slotValue==='clinico-dia'?'diurno':'noturno'}) já têm fixo: ${pos.ocupados.map(o=>name(o.doctor)).join(', ')}. Escolha acima quem deixa de ser fixo para ${name(form.elements.doctor.value)||'o novo médico'} entrar.`:'Este médico não é fixo neste dia e turno.';
   if(pos.cheio)root.querySelector('#roster-impact').classList.add('roster-impact-alert');
   return true;
  }
  const slot=pos.slot;
  const target=recurringRule(seed,storage,start,weekday,slot,true);
  // Clínico que entra num posto livre (ou no que o RT escolheu liberar) não precisa da confirmação de substituição.
  const replacing=!pos.cheio&&!pos.movido&&!!target?.doctor&&doctorIdentity(target.doctor)!==doctorIdentity(form.elements.doctor.value)&&!form.elements.end.checked;
  root.querySelector('#roster-replace-label').hidden=!replacing;
  const moves=original&&!original.generic&&(original.weekday!==weekday||original.slot!==slot);
  // Choque: o médico escolhido já é fixo em outro posto no mesmo dia da semana e em horário que se cruza.
  const escolhido=doctorIdentity(form.elements.doctor.value),[ini,fim]=bounds(slot,start);
  const choques=!escolhido||form.elements.end.checked?[]:Array.from({length:16},(_,s)=>s).filter(s=>s!==slot&&!(original&&!original.generic&&original.weekday===weekday&&original.slot===s)).filter(s=>{const r=recurringRule(seed,storage,start,weekday,s,true);if(!r?.doctor||doctorIdentity(r.doctor)!==escolhido)return false;const [a,b]=bounds(s,start);return a<fim&&ini<b;});
  const onde=slotValue.startsWith('clinico-')?`${days[weekday]} · ${slotValue==='clinico-dia'?'Diurno':'Noturno'} · Clínico (posto ${slot%7+1} na planilha)`:`${days[weekday]} · ${slots[slot]}`;
  const extra=pos.jaEsta&&!form.elements.end.checked?` ${name(form.elements.doctor.value)} já é fixo aqui: nada muda.`:pos.movido?' Entra num posto de clínico livre; ninguém sai.':pos.cheio?` Sai ${name(target?.doctor||'')}.`:'';
  root.querySelector('#roster-impact').textContent=form.elements.end.checked?`O posto ficará sem médico fixo a partir de ${fmt(start)}. Dias anteriores permanecem iguais.`:`${onde}, a partir de ${fmt(start)}.${extra}${moves?' O dia/posto anterior será liberado a partir dessa data.':''}${replacing?' Neste posto está '+name(target.doctor)+'.':''}${choques.length?` ⚠ Choque de horário: ${name(form.elements.doctor.value)} já é fixo às ${days[weekday].toLowerCase()}s em ${choques.map(s=>slotLabel(s)).join(' e ')}.`:''}`;
  if(choques.length)root.querySelector('#roster-impact').classList.add('roster-impact-alert');
  return replacing;
 }
 // "Alterar": lista os dias fixos do médico para excluir vários de uma vez (o dia clicado já vem marcado).
 function montarExclusao(rule){
  const caixa=root.querySelector('#roster-excluir-fixos'),lista=caixa.querySelector('.excluir-lista'),botao=caixa.querySelector('#roster-excluir-sel');
  lista.replaceChildren();caixa.hidden=true;botao.disabled=true;
  if(!rule?.doctor)return;
  const {fixos,genericos}=fixosDoMedico(seed,storage,rule.doctor,date.value);
  const agendado=x=>x.inicio?` · passa a valer em ${fmt(x.inicio)}`:'';
  const itens=[...fixos.map(f=>({tipo:'fixo',dado:f,rotulo:`${days[f.weekday]} · ${slotLabel(f.slot)}${agendado(f)}`,marcado:!rule.generic&&f.weekday===rule.weekday&&f.slot===rule.slot})),
   ...genericos.map(g=>({tipo:'generico',dado:g,rotulo:`${days[g.weekday]} · ${g.turn==='dia'?'Diurno':'Noturno'} · Clínico (qualquer)${agendado(g)}`,marcado:!!rule.generic&&g.weekday===rule.weekday&&g.turn===turnOf(rule)}))]
   .sort((a,b)=>a.dado.weekday-b.dado.weekday);
  if(!itens.length)return;
  caixa.hidden=false;
  const atualizar=()=>{const n=lista.querySelectorAll('input:checked').length;botao.disabled=!n;botao.textContent=n?`Excluir ${n} dia${n>1?'s':''} fixo${n>1?'s':''}`:'Excluir dias selecionados';};
  for(const item of itens){const label=document.createElement('label');label.className='excluir-item';const caixaMarcar=document.createElement('input');caixaMarcar.type='checkbox';caixaMarcar.checked=item.marcado;caixaMarcar.onchange=atualizar;caixaMarcar._item=item;label.append(caixaMarcar,document.createTextNode(' '+item.rotulo));lista.append(label);}
  atualizar();
  botao.onclick=()=>{
   const escolhidos=[...lista.querySelectorAll('input:checked')].map(i=>i._item),desde=form.elements.start.value;
   if(!escolhidos.length)return;
   if(!confirm(`Excluir ${escolhidos.length} dia${escolhidos.length>1?'s':''} fixo${escolhidos.length>1?'s':''} de ${name(rule.doctor)} a partir de ${fmt(desde)}?\n\n${escolhidos.map(i=>'• '+i.rotulo).join('\n')}\n\nOs postos ficam sem fixo dali em diante (vagos, se ninguém mais estiver neles). Dias anteriores não mudam.`))return;
   try{excluirDiasFixos(storage,{fixos:escolhidos.filter(i=>i.tipo==='fixo').map(i=>i.dado),genericos:escolhidos.filter(i=>i.tipo==='generico').map(i=>i.dado)},desde);}catch(err){alert(err.message);return;}
   date.value=desde;dialog.close();document.dispatchEvent(new Event('rt-schedule-changed'));
  };
 }
 // Excluir um dia fixo direto do cartão, a partir da data "Válidos em" (ou só o agendamento, se ainda não começou).
 function excluirUmDia(doctor,r){
  const desde=date.value||new Date(Date.now()-4*3600000).toISOString().slice(0,10);
  const inicio=r.upcoming&&r.start>desde?r.start:null;
  const rotulo=r.generic?`${days[r.weekday]} · ${turnOf(r)==='dia'?'Diurno':'Noturno'} · Clínico (qualquer)`:`${days[r.weekday]} · ${slotLabel(r.slot)}`;
  const quando=inicio?`O agendamento que começaria em ${fmt(inicio)} é cancelado; quem está no posto até lá continua.`:`Vale a partir de ${fmt(desde)}; os dias anteriores não mudam e o posto fica sem fixo dali em diante.`;
  if(!confirm(`Excluir o dia fixo de ${name(doctor)}?\n\n• ${rotulo}\n\n${quando}\nO médico continua no cadastro.`))return;
  try{excluirDiasFixos(storage,r.generic?{genericos:[{weekday:r.weekday,turn:turnOf(r),doctor,inicio}]}:{fixos:[{weekday:r.weekday,slot:r.slot,doctor,inicio}]},desde);}catch(err){alert(err.message);return;}
  document.dispatchEvent(new Event('rt-schedule-changed'));
 }
 function open(rule,doctor='',preset=null){
  original=rule?{...rule,turn:turnOf(rule)}:null;
  form.reset();
  form.elements.doctor.replaceChildren(new Option('Selecione o médico',''));
  for(const d of people())form.elements.doctor.add(new Option(d.replaceAll('\n',' · '),d));
  const selected=doctor||rule?.doctor||'';
  const match=people().find(d=>doctorIdentity(d)===doctorIdentity(selected));
  form.elements.doctor.value=match||'';
  form.elements.affiliation.value=affiliation(selected)||'SMS';
  form.elements.weekday.value=rule?.weekday??preset?.weekday??1;
  for(const o of form.elements.slot.options)if(o.value.startsWith('generic-')){o.hidden=o.disabled=!rule?.generic;}
  const postoInicial=rule?.slot??preset?.slot??0,turnoInicial=turnoDoPosto(postoInicial);
  form.elements.quemSai.replaceChildren();form.elements.quemSai.dataset.chave='';
  form.elements.slot.value=rule?.generic?`generic-${original.turn}`:turnoInicial?`clinico-${turnoInicial}`:postoInicial;
  form.elements.start.value=date.value;
  root.querySelector('#roster-edit-title').textContent=rule?'Alterar dia fixo':'Novo dia fixo';
  montarExclusao(rule);
  form.elements.repeatExtra.checked=!!rule?.repeatExtra;
  doctorPicker(form.elements.doctor);
  impact();
  dialog.showModal();
 }
 form.onchange=e=>{if(e.target!==form.elements.replace)form.elements.replace.checked=false;impact();};root.querySelector('#roster-cancel').onclick=()=>dialog.close();root.querySelector('#roster-add').onclick=()=>open();
 form.onsubmit=e=>{
  e.preventDefault();
  const slotValue=form.elements.slot.value,generic=slotValue.startsWith('generic-');
  if(affiliation(changeDoctor(form.elements.doctor.value,form.elements.affiliation.value))==='EXTRA SMS'&&!form.elements.end.checked&&!form.elements.repeatExtra.checked){const warn=root.querySelector('#roster-impact');warn.textContent='NÃO SALVO: marque "Repetir este extra toda semana" para cadastrar este extra como dia fixo, ou troque o Vínculo para SMS/COAPH se este médico não é extra. Para um extra pontual (sem repetir), ajuste apenas a data na aba Escala.';warn.classList.add('roster-impact-alert');warn.scrollIntoView({behavior:'smooth',block:'nearest'});root.querySelector('#roster-extra-label').classList.add('roster-impact-alert');return;}
  root.querySelector('#roster-impact').classList.remove('roster-impact-alert');root.querySelector('#roster-extra-label').classList.remove('roster-impact-alert');
  if(!generic&&impact()&&!form.elements.replace.checked&&!(resolverPosto().cheio&&resolverPosto().slot!==null))return;
  const start=form.elements.start.value,weekday=Number(form.elements.weekday.value),doctorString=changeDoctor(form.elements.doctor.value,form.elements.affiliation.value);
  if(generic){
   const turn=slotValue==='generic-dia'?'dia':'noite';
   let genericRows=parse(storage,'clinicoRoster',[]);
   const putGeneric=(w,t,d,active)=>{genericRows=genericRows.filter(x=>!(x.start===start&&x.weekday===w&&x.turn===t&&doctorIdentity(x.doctor)===doctorIdentity(d)));genericRows.push({id:crypto.randomUUID(),start,weekday:w,turn:t,doctor:d,active});};
   if(original&&original.generic&&(original.weekday!==weekday||original.turn!==turn))putGeneric(original.weekday,original.turn,original.doctor,false);
   if(original&&!original.generic){let rules=parse(storage,'roster',[]);rules=rules.filter(x=>!(x.start===start&&x.weekday===original.weekday&&x.slot===original.slot));rules.push({id:crypto.randomUUID(),start,weekday:original.weekday,slot:original.slot,doctor:''});storage.setItem('rt-upa:roster',JSON.stringify(rules));}
   putGeneric(weekday,turn,doctorString,!form.elements.end.checked);
   storage.setItem('rt-upa:clinicoRoster',JSON.stringify(genericRows));
  } else {
   const pos=resolverPosto();if(pos.slot===null)return;
   const slot=pos.slot,doctor=form.elements.end.checked?'':doctorString;
   const atual=recurringRule(seed,storage,start,weekday,slot,true)?.doctor||'';
   // Já é fixo aqui (mesmo médico e vínculo): não cria um "a partir de" novo, que só confundia.
   if(!form.elements.end.checked&&atual===doctorString&&(!original||(original.weekday===weekday&&original.slot===slot))){date.value=start;dialog.close();return;}
   let rules=parse(storage,'roster',[]);
   const put=(w,s,d)=>{rules=rules.filter(x=>!(x.start===start&&x.weekday===w&&x.slot===s));rules.push({id:crypto.randomUUID(),start,weekday:w,slot:s,doctor:d,...(affiliation(d)==='EXTRA SMS'?{repeatExtra:true}:{})});};
   if(original&&original.generic){let genericRows=parse(storage,'clinicoRoster',[]);genericRows=genericRows.filter(x=>!(x.start===start&&x.weekday===original.weekday&&x.turn===original.turn&&doctorIdentity(x.doctor)===doctorIdentity(original.doctor)));genericRows.push({id:crypto.randomUUID(),start,weekday:original.weekday,turn:original.turn,doctor:original.doctor,active:false});storage.setItem('rt-upa:clinicoRoster',JSON.stringify(genericRows));}
   else if(original&&(original.weekday!==weekday||original.slot!==slot))put(original.weekday,original.slot,'');
   put(weekday,slot,doctor);
   storage.setItem('rt-upa:roster',JSON.stringify(rules));
  }
  date.value=start;dialog.close();document.dispatchEvent(new Event('rt-schedule-changed'));
 };

 root.querySelector('#roster-next').onclick=()=>{const now=new Date(),next=now.getDate()<16?new Date(now.getFullYear(),now.getMonth(),16):new Date(now.getFullYear(),now.getMonth()+1,1);form.elements.start.value=`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}-${String(next.getDate()).padStart(2,'0')}`;form.elements.replace.checked=false;impact();};
 const registryForm=document.querySelector('#doctor-form');root.querySelector('#registry-form').append(registryForm);registryForm.querySelector('h3').textContent='Cadastrar médico';registryForm.elements.crm.inputMode='numeric';registryForm.elements.crm.placeholder='Número do CRM-MT';registryForm.elements.name.maxLength=160;registryForm.elements.crm.maxLength=12;
 // O CRM só precisa ser dígitos: limpamos sozinhos o que for colado (pontos, espaços, "CRM-MT" etc.)
 // em vez de bloquear o salvamento com uma mensagem de formato — foi o que travou o recadastro da Ana Kellen.
 registryForm.elements.crm.addEventListener('input',()=>{const digits=registryForm.elements.crm.value.replace(/\D/g,'').slice(0,12);if(digits!==registryForm.elements.crm.value)registryForm.elements.crm.value=digits;});
 registryForm.addEventListener('submit',()=>{root.querySelector('#registry-status').textContent='Médico incluído nas sugestões. Confira a confirmação de salvamento online no topo.';});
 function registry(groups){
  const list=root.querySelector('#registry-list'),q=searchText(root.querySelector('#registry-search').value);
  list.replaceChildren();
  // Um médico costuma aparecer no histórico com mais de um vínculo (SMS, COAPH, EXTRA SMS) —
  // usamos a mesma lista já deduplicada por pessoa (people()) pra não mostrar 2 ou 3 linhas
  // repetidas do mesmo médico aqui, o que só confundia quem estava procurando.
  const found=people().filter(d=>q.split(' ').every(term=>searchText(d).includes(term)));
  for(const d of found){
   const count=groups?.get(doctorIdentity(d))?.rules.length||0;
   const line=document.createElement('button');
   line.type='button';
   line.className='registry-entry';
   const label=document.createElement('span');label.textContent=d.replaceAll('\n',' · ');
   const tag=document.createElement('small');tag.className='registry-count'+(count?'':' registry-count-empty');tag.textContent=count?`${count} dia${count>1?'s':''} fixo${count>1?'s':''}`:'nenhum dia fixo ainda';
   line.append(label,tag);
   line.title='Ver os dias fixos deste médico e alterar, ou cadastrar um novo';
   line.onclick=()=>{
    root.querySelector('#roster-search').value=name(d);
    render();
    root.querySelector('#roster-cards').scrollIntoView({behavior:'smooth',block:'start'});
    if(!root.querySelector('#roster-cards').children.length)open(null,d);
   };
   list.append(line);
  }
  if(!found.length)list.textContent='Nenhum médico encontrado.';
 }
 root.querySelector('#registry-search').oninput=()=>registry(buildGroups(date.value).groups);
 // Reúne, pra uma data de referência, quantos e quais dias fixos cada médico tem — usado tanto
 // pra montar os cards quanto pra mostrar a contagem no cadastro e o resumo de quem ainda não tem nada.
 function buildGroups(refDate){
  const groups=new Map(),review=[];
  if(!refDate)return {groups,review,clinicoRows:[]};
  for(let w=0;w<7;w++)for(let slot=0;slot<16;slot++){const r=recurringRule(seed,storage,refDate,w,slot,true);if(r){const rule={...r,weekday:w,slot};if(r.doctor){const key=doctorIdentity(r.doctor);if(!groups.has(key))groups.set(key,{doctor:r.doctor,rules:[]});groups.get(key).rules.push(rule);}else if(r.status==='review')review.push(rule);}
   // Mudança programada: quem já é fixo aqui não vira "agendado" de novo; quem sai ganha "até", quem entra "a partir de".
   const futuros=parse(storage,'roster',[]).filter(x=>x.weekday===w&&x.slot===slot&&x.start>refDate).sort((a,b)=>a.start.localeCompare(b.start));
   const atualAqui=groups.size&&r?.doctor?[...groups.values()].flatMap(g=>g.rules).find(x=>x.weekday===w&&x.slot===slot&&!x.upcoming):null;
   const mudanca=futuros.find(x=>doctorIdentity(x.doctor)!==doctorIdentity(r?.doctor||''));
   if(atualAqui&&mudanca){const d=new Date(mudanca.start+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-1);atualAqui.ate=d.toISOString().slice(0,10);}
   for(const future of futuros.filter(x=>x.doctor&&doctorIdentity(x.doctor)!==doctorIdentity(r?.doctor||''))){const key=doctorIdentity(future.doctor);if(!groups.has(key))groups.set(key,{doctor:future.doctor,rules:[]});groups.get(key).rules.push({...future,weekday:w,slot,upcoming:true});}
  }
  // Médicos "Clínico (qualquer)" cadastrados nunca podem simplesmente sumir da tela — nem quando
  // a data de início ainda não chegou, nem quando têm mais genéricos cadastrados do que vagas
  // sobrando hoje (perderam a vez na ordem alfabética). Mesmo bug que a Ana Kellen teve nos fixos
  // por número — aqui tratado explicitamente pros dois casos.
  const clinicoRows=parse(storage,'clinicoRoster',[]);
  const latestClinico=new Map();
  for(const row of clinicoRows.filter(x=>x.start<=refDate).sort((a,b)=>a.start.localeCompare(b.start)||a.id.localeCompare(b.id)))latestClinico.set(`${row.weekday}|${row.turn}|${doctorIdentity(row.doctor)}`,row);
  for(const row of [...latestClinico.values()].filter(r=>r.active)){
   const key=doctorIdentity(row.doctor);
   const already=(groups.get(key)?.rules||[]).some(r=>r.generic&&r.weekday===row.weekday&&Number.isInteger(r.slot)&&CLINICO_TURNS[row.turn].includes(r.slot));
   if(!groups.has(key))groups.set(key,{doctor:row.doctor,rules:[]});
   if(!already)groups.get(key).rules.push({...row,generic:true,overflow:true});
  }
  for(const row of clinicoRows.filter(x=>x.start>refDate&&x.active)){
   const key=doctorIdentity(row.doctor);
   if(!groups.has(key))groups.set(key,{doctor:row.doctor,rules:[]});
   groups.get(key).rules.push({...row,generic:true,upcoming:true});
  }
  return {groups,review,clinicoRows};
 }
 // Excluir: os dias fixos terminam a partir da data "Válidos em" (os postos ficam vagos dali em diante) e o médico sai
 // das listas e sugestões. Plantões anteriores, trocas e histórico não mudam. Cadastrar de novo traz o médico de volta.
 function botaoExcluir(doctor,compacto=false){
  const b=document.createElement('button');b.type='button';b.className='secondary danger roster-excluir';b.textContent=compacto?'Excluir':'Excluir médico';
  b.setAttribute('aria-label',`Excluir ${name(doctor)} do cadastro`);
  b.onclick=()=>{
   const desde=date.value||new Date(Date.now()-4*3600000).toISOString().slice(0,10);
   const {fixos,genericos}=fixosDoMedico(seed,storage,doctor,desde),total=fixos.length+genericos.length;
   const aviso=`Excluir ${name(doctor)} do cadastro?\n\n`+(total?`Os ${total} dia${total>1?'s':''} fixo${total>1?'s':''} dele${total>1?'s':''} terminam a partir de ${fmt(desde)} e esses postos ficam vagos na escala dali em diante.\n`:'')+'Plantões anteriores, trocas, coberturas e histórico não mudam. Para trazer de volta, é só cadastrar o médico de novo.';
   if(!confirm(aviso))return;
   excluirMedico(seed,storage,doctor,desde);
   root.querySelector('#roster-search').value='';
   document.dispatchEvent(new Event('rt-schedule-changed'));
  };
  return b;
 }
 // CRM "A CONFIRMAR": digitar o número (ou buscar no CFM, que exige a verificação "não sou um robô") e salvar.
 function crmPendentes(){
  const box=root.querySelector('#crm-pendentes'),lista=people().filter(crmAConfirmar);
  box.replaceChildren();box.hidden=!lista.length;if(!lista.length)return;
  const h=document.createElement('h3');h.textContent=`CRM a confirmar (${lista.length})`;
  const p=document.createElement('p');p.className='notice';p.textContent='"Buscar no CFM" copia o nome e abre a busca de médicos do CFM: cole o nome, escolha Mato Grosso, confirme "não sou um robô" e copie o número do CRM para cá. Quando o Gestor Saúde informar o CRM no relatório de produção, ele é preenchido sozinho.';
  box.append(h,p);
  for(const d of lista){
   const linha=document.createElement('form');linha.className='crm-linha';
   const n=document.createElement('strong');n.textContent=name(d);
   const campo=document.createElement('input');campo.inputMode='numeric';campo.placeholder='Número do CRM-MT';campo.maxLength=12;campo.required=true;campo.setAttribute('aria-label',`CRM de ${name(d)}`);
   campo.oninput=()=>{campo.value=campo.value.replace(/\D/g,'').slice(0,12);};
   const cfm=document.createElement('button');cfm.type='button';cfm.className='secondary';cfm.textContent='Buscar no CFM';
   cfm.onclick=async()=>{try{await navigator.clipboard.writeText(name(d));cfm.textContent='Nome copiado · abrindo CFM';}catch{cfm.textContent='Abrindo CFM';}window.open(CFM_BUSCA,'_blank','noopener');setTimeout(()=>{cfm.textContent='Buscar no CFM';},4000);campo.focus();};
   const salvar=document.createElement('button');salvar.textContent='Salvar CRM';
   linha.onsubmit=e=>{e.preventDefault();try{atualizarCrm(storage,d,campo.value);document.dispatchEvent(new Event('rt-schedule-changed'));}catch(err){alert(err.message);}};
   linha.append(n,campo,cfm,salvar);box.append(linha);
  }
 }
 // Quadro da semana: posto × dia, com quem é fixo em cada um. Clicar abre a janela já no dia e no posto.
 // Nome curto reconhecível: primeiro nome + dois últimos sobrenomes ("GABRIEL SALVATORI SILVA"), sem da/de/dos.
 const curto=d=>{const p=name(d).split(/\s+/).filter(t=>!/^(DA|DE|DO|DAS|DOS|E)$/i.test(t));return p.length>3?`${p[0]} ${p.at(-2)} ${p.at(-1)}`:p.join(' ');};
 const GRUPOS=[['DIURNO · 07h–19h',[0,1,2,3,4,5,6]],['NOTURNO · 19h–07h',[7,8,9,10,11,12,13]],['CINDERELAS',[14,15]]];
 const postoCurto=s=>s>=14?`Cinderela ${s-13} · ${hour(bounds(s)[0]).slice(0,2)}h–${hour(bounds(s)[1]).slice(0,2)}h`:slots[s].split(' · ')[1];
 let vista='quadro';try{vista=localStorage.getItem('rt-roster-vista')||'quadro';}catch{/* sem armazenamento */}
 function aplicarVista(){root.querySelectorAll('.roster-vistas button').forEach(b=>b.classList.toggle('active',b.dataset.vista===vista));root.querySelector('#quadro-fixos').hidden=vista!=='quadro';root.querySelector('#roster-cards').hidden=vista!=='medicos';}
 root.querySelectorAll('.roster-vistas button').forEach(b=>b.onclick=()=>{vista=b.dataset.vista;try{localStorage.setItem('rt-roster-vista',vista);}catch{/* ignora */}aplicarVista();});
 function quadro(){
  const box=root.querySelector('#quadro-fixos');box.replaceChildren();if(!date.value)return;
  const q=quadroFixos(seed,storage,date.value),busca=doctorIdentity(root.querySelector('#roster-search').value);
  const resumo=document.createElement('div');resumo.className='quadro-resumo';
  const chip=(texto,cls)=>{const s=document.createElement('span');s.className='faltas-chip '+cls;s.textContent=texto;resumo.append(s);};
  chip(q.semFixo.length?`${q.semFixo.length} ${q.semFixo.length===1?'posto sem fixo':'postos sem fixo'} na semana`:'Todos os postos com fixo','vaga');
  if(q.conflitos.length)chip(`${q.conflitos.length} ${q.conflitos.length===1?'choque':'choques'} de horário`,'falta');
  const ausentes=[...q.celulas.values()].filter(c=>c.ausente);
  if(ausentes.length)chip(`${ausentes.length} ${ausentes.length===1?'fixo de férias ou afastado':'fixos de férias ou afastados'} nos próximos 7 dias`,'falta');
  const pesados=[...q.carga.values()].filter(m=>m.horas>60);
  if(pesados.length)chip(`Acima de 60 h/semana: ${pesados.map(m=>`${curto(m.doctor)} (${m.horas} h)`).join(', ')}`,'producao');
  const dica=document.createElement('p');dica.className='notice';dica.textContent=`Fixos em vigor em ${fmt(date.value)}. Clique num posto para definir, trocar ou excluir o fixo daquele dia da semana; a escala das próximas quinzenas usa este padrão automaticamente.`;
  const tabela=document.createElement('table');tabela.className='prod-table quadro-tabela';
  const head=document.createElement('tr');head.append(Object.assign(document.createElement('th'),{textContent:'Posto'}));
  for(const w of ORDEM_SEMANA)head.append(Object.assign(document.createElement('th'),{textContent:days[w]}));
  const thead=document.createElement('thead');thead.append(head);tabela.append(thead);
  const corpo=document.createElement('tbody');
  for(const [titulo,postos] of GRUPOS){
   const tr=document.createElement('tr');tr.className='quadro-grupo';const th=document.createElement('th');th.colSpan=8;th.textContent=titulo;tr.append(th);corpo.append(tr);
   for(const linhaPosto of postos){
    // Clínicos 1 a 4 são iguais: em cada dia, os ocupados vêm primeiro e os vagos depois, sem número.
    const grupoC=CLINICO_TURNS.dia.includes(linhaPosto)?CLINICO_TURNS.dia:CLINICO_TURNS.noite.includes(linhaPosto)?CLINICO_TURNS.noite:null;
    const linha=document.createElement('tr');linha.append(Object.assign(document.createElement('th'),{textContent:grupoC?'Clínico':postoCurto(linhaPosto),scope:'row',className:'quadro-posto'}));
    for(const w of ORDEM_SEMANA){
     const c=grupoC?grupoC.map(s=>q.celulas.get(`${w}|${s}`)).sort((a,b)=>(!!b.doctor-!!a.doctor)||(!!b.futuro?.doctor-!!a.futuro?.doctor)||a.slot-b.slot)[grupoC.indexOf(linhaPosto)]:q.celulas.get(`${w}|${linhaPosto}`);
     const slot=c.slot,td=document.createElement('td'),b=document.createElement('button');b.type='button';
     const fimDeSemana=slot>=14&&(w===0||w===6);
     b.className='quadro-cel'+(c.doctor?' '+affiliationClass(c.doctor):fimDeSemana?' quadro-sem':' quadro-vago')+(c.conflito?' quadro-conflito':'')+(busca&&c.doctor&&!doctorIdentity(c.doctor).includes(busca)?' quadro-apagado':'')+(busca&&c.doctor&&doctorIdentity(c.doctor).includes(busca)?' quadro-achado':'');
     const nome=document.createElement('span');nome.className='quadro-nome';nome.textContent=c.doctor?curto(c.doctor):fimDeSemana?'—':'Sem fixo';b.append(nome);
     if(c.generic){const t=document.createElement('small');t.textContent='clínico (qualquer)';b.append(t);}
     if(c.doctor&&!c.generic){const t=document.createElement('small');t.textContent=affiliation(c.doctor);b.append(t);}
     if(!c.doctor&&!fimDeSemana){const t=document.createElement('small');t.textContent='+ definir';b.append(t);}
     if(c.futuro){const t=document.createElement('small');t.className='quadro-futuro';t.textContent=c.futuro.doctor?(c.doctor?`muda em ${fmt(c.futuro.start).slice(0,5)} → ${curto(c.futuro.doctor)}`:`entra em ${fmt(c.futuro.start).slice(0,5)}: ${curto(c.futuro.doctor)}`):`sai em ${fmt(c.futuro.start).slice(0,5)}`;b.append(t);}
     if(c.conflito){const t=document.createElement('small');t.className='quadro-alerta';t.textContent='⚠ choque de horário';b.append(t);}
     if(c.ausente){const t=document.createElement('small');t.className='quadro-alerta';t.textContent=`⚠ ${c.ausente} em ${fmt(c.dia).slice(0,5)}`;b.append(t);b.classList.add('quadro-ausente');}
     b.title=`${days[w]} · ${slotLabel(slot)}\n${c.doctor?name(c.doctor)+' · '+affiliation(c.doctor)+(c.generic?' · clínico (qualquer)':''):'Sem médico fixo'}\nClique para ${c.doctor?'alterar ou excluir':'definir o fixo'}`;
     b.onclick=()=>c.doctor?open({doctor:c.doctor,weekday:w,slot,generic:c.generic,status:'custom'}):c.futuro?.doctor?open({doctor:c.futuro.doctor,weekday:w,slot,status:'custom',upcoming:true,start:c.futuro.start}):open(null,'',{weekday:w,slot});
     td.append(b);linha.append(td);
    }
    corpo.append(linha);
    // Depois do 4º clínico: quantos clínicos cada dia tem (o que importa são 4 médicos, não o número do posto).
    if(grupoC&&linhaPosto===grupoC.at(-1)){
     const conta=document.createElement('tr');conta.className='quadro-conta';conta.append(Object.assign(document.createElement('th'),{textContent:'Clínicos no dia',scope:'row',className:'quadro-posto'}));
     for(const w of ORDEM_SEMANA){const n=grupoC.filter(s=>q.celulas.get(`${w}|${s}`).doctor).length;conta.append(Object.assign(document.createElement('td'),{textContent:`${n}/4`,className:n<4?'quadro-falta':'quadro-ok'}));}
     corpo.append(conta);
    }
   }
  }
  tabela.append(corpo);
  const wrap=document.createElement('div');wrap.className='table-wrap quadro-wrap';wrap.append(tabela);
  box.append(resumo,dica,wrap);
 }
 function render(){crmPendentes();quadro();aplicarVista();if(!date.value){registry();return;}root.querySelector('#roster-date-label').textContent=`${days[new Date(date.value+'T12:00:00').getDay()]} · ${fmt(date.value)}`;const pattern=patternFor(seed,date.value);root.querySelector('#roster-source').textContent=pattern?`Base: ${pattern.source}. SMS repetidos foram organizados como fixos; COAPH repetidos como padrão habitual. Extras e posições variáveis precisam de revisão.`:'Sem padrão importado para este período. Você pode cadastrar dias fixos.';const conflicts=seed.assignments.filter(x=>x.doctor&&x.date.slice(0,7)===date.value.slice(0,7)&&x.colorAffiliation&&x.colorAffiliation!==x.affiliation);if(conflicts.length)root.querySelector('#roster-source').textContent+=' Atenção: '+conflicts.map(x=>name(x.doctor)+' em '+fmt(x.date)).join('; ')+' têm divergência entre texto e cor. Mantido o vínculo escrito, sem assumir fixo.';const {groups,review,clinicoRows}=buildGroups(date.value);registry(groups);
 const rowLabel=r=>(r.generic&&!Number.isInteger(r.slot)?`${days[r.weekday]} · ${r.turn==='dia'?'Diurno':'Noturno'} · Clínico (qualquer)`:`${days[r.weekday]} · ${slotLabel(r.slot)}`+(r.generic?' · (qualquer)':''));
 const cards=root.querySelector('#roster-cards');cards.replaceChildren();const query=doctorIdentity(root.querySelector('#roster-search').value);const cargaSemana=quadroFixos(seed,storage,date.value).carga;for(const group of [...groups.values()].sort((a,b)=>name(a.doctor).localeCompare(name(b.doctor),'pt-BR'))){if(query&&!doctorIdentity(group.doctor).includes(query))continue;const card=document.createElement('article');card.className='shift-card';const h=document.createElement('h3');h.textContent=name(group.doctor);card.append(h);const c=cargaSemana.get(doctorIdentity(group.doctor));if(c){const s=document.createElement('small');s.className='roster-carga'+(c.horas>60?' roster-carga-alta':'');s.textContent=`${c.plantoes} ${c.plantoes>1?'plantões':'plantão'} por semana · ${c.horas} h`;card.append(s);}for(const r of group.rules.sort((a,b)=>(a.upcoming===b.upcoming?0:a.upcoming?1:-1)||a.weekday-b.weekday)){const row=document.createElement('div');row.className='roster-line'+(r.upcoming?' roster-upcoming':'');const p=document.createElement('p');p.textContent=rowLabel(r)+(r.upcoming?` · a partir de ${fmt(r.start)}`:'')+(r.ate?` · até ${fmt(r.ate)}`:'')+(r.overflow?' · sem posto vago nesta data':'');const badge=document.createElement('span');badge.className='affiliation '+affiliationClass(r.doctor);badge.textContent=(r.upcoming?'Entra depois · ':'')+(r.ate?'Sai depois · ':'')+(r.overflow?'Sem posto hoje · ':'')+affiliation(r.doctor);const button=document.createElement('button');button.className='secondary';button.textContent='Alterar';button.setAttribute('aria-label',`Alterar ${name(group.doctor)} ${rowLabel(r)}`);button.onclick=()=>open(r);const tirar=document.createElement('button');tirar.type='button';tirar.className='secondary danger roster-excluir-dia';tirar.textContent='Excluir';tirar.setAttribute('aria-label',`Excluir ${name(group.doctor)} ${rowLabel(r)}`);tirar.onclick=()=>excluirUmDia(group.doctor,r);row.append(p,badge,button,tirar);card.append(row);}const add=document.createElement('button');add.className='secondary';add.textContent='+ Outro dia fixo';add.onclick=()=>open(null,group.doctor);card.append(add,botaoExcluir(group.doctor));cards.append(card);}if(!cards.children.length)cards.textContent='Nenhum médico com dia fixo nesta seleção.';
 const target=root.querySelector('#roster-review');target.replaceChildren();root.querySelector('#roster-review-title').textContent=`Postos para revisar (${review.length})`;for(const r of review){const line=document.createElement('div');line.className='roster-line';const p=document.createElement('p');p.textContent=`${days[r.weekday]} · ${slotLabel(r.slot)} — ${r.candidates?.length?'Nomes encontrados: '+r.candidates.map(name).join(', '):'Só extras ou vagas na referência'}`;const b=document.createElement('button');b.textContent='Definir fixo';b.className='secondary';b.onclick=()=>open(r,r.candidates?.[0]);line.append(p,b);target.append(line);}
 // Quem está cadastrado (SMS/COAPH, com vínculo regular) mas ainda não tem nenhum dia fixo —
 // pra não esquecer ninguém na hora de montar uma escala nova.
 const missingTarget=root.querySelector('#roster-missing');missingTarget.replaceChildren();
 const missing=people().filter(d=>affiliation(d)!=='EXTRA SMS'&&!(groups.get(doctorIdentity(d))?.rules.length)).sort((a,b)=>name(a).localeCompare(name(b),'pt-BR'));
 root.querySelector('#roster-missing-title').textContent=`Cadastrados sem nenhum dia fixo (${missing.length})`;
 if(missing.length)for(const d of missing){const line=document.createElement('div');line.className='roster-line';const p=document.createElement('p');p.textContent=name(d);const b=document.createElement('button');b.className='secondary';b.textContent='Definir dia fixo';b.onclick=()=>open(null,d);line.append(p,b,botaoExcluir(d,true));missingTarget.append(line);}
 else missingTarget.textContent='Todos os médicos cadastrados (SMS/COAPH) já têm pelo menos um dia fixo.';
 const history=root.querySelector('#roster-history');history.replaceChildren();
 const historyItems=[
  ...parse(storage,'roster',[]).map(r=>({start:r.start,text:`${days[r.weekday]} · ${slotLabel(r.slot)}: ${r.doctor.replaceAll('\n',' · ')||'Sem fixo'}`})),
  ...clinicoRows.map(r=>({start:r.start,text:`${days[r.weekday]} · ${r.turn==='dia'?'Diurno':'Noturno'} · Clínico (qualquer): ${r.doctor.replaceAll('\n',' · ')}${r.active?'':' (encerrado)'}`})),
 ].sort((a,b)=>b.start.localeCompare(a.start));
 for(const item of historyItems){const p=document.createElement('p');p.textContent=`Desde ${fmt(item.start)} · ${item.text}`;history.append(p);}
 if(!historyItems.length)history.textContent='Nenhuma alteração manual de padrão.';
 }
 date.onchange=render;root.querySelector('#roster-search').oninput=render;document.addEventListener('rt-schedule-changed',render);document.addEventListener('rt-data-restored',render);render();
}
