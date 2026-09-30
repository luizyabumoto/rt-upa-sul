import {doctorPicker,searchText} from './doctor-picker.js';
import {slots,bounds,hour,parse,doctorIdentity,affiliation,affiliationClass,recurringRule,patternFor,CLINICO_TURNS} from './scheduling.js';
import {excluidos,excluirMedico,excluirDiasFixos,fixosDoMedico,atualizarCrm,crmAConfirmar,CFM_BUSCA} from './cadastro.js';
const slotLabel=i=>`${slots[i]} · ${hour(bounds(i)[0])}–${hour(bounds(i)[1])}`;
const days=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
const fmt=value=>value.split('-').reverse().join('/');
export function mountRoster(storage,seed){
 const root=document.querySelector('#roster-panel');
 root.innerHTML=`<div class="section-heading"><div><p class="eyebrow">PADRÃO PARA AS PRÓXIMAS ESCALAS</p><h2>Médicos e dias fixos</h2></div><button id="roster-add">+ Novo dia fixo</button></div><p>Consulte por data. Mudanças valem a partir do dia informado e mantêm o histórico anterior. A escala usa os padrões automaticamente em períodos novos; ajustes pontuais e coberturas confirmadas têm prioridade.</p><div class="form-grid"><label>Válidos em<input id="roster-date" type="date" required><small id="roster-date-label"></small></label><label>Buscar médico<input id="roster-search" type="search" placeholder="Digite parte do nome"></label></div><p id="roster-source" class="notice"></p><p class="link-legend"><span class="affiliation link-sms">SMS · fixo</span> <span class="affiliation link-coaph">COAPH</span> <span class="affiliation link-extra">Extra SMS · repetição somente se você configurar</span></p><section id="crm-pendentes" class="crm-pendentes" hidden></section><details id="doctor-registry"><summary>Cadastro de médicos e CRM · incluir médico de cobertura</summary><p>O cadastro fica salvo na sua conta online e disponível nas sugestões. Cadastrar um médico não cria plantões.</p><div id="registry-form"></div><p id="registry-status" role="status"></p><label>Consultar cadastro por nome ou CRM<input id="registry-search" type="search"></label><div id="registry-list"></div></details><div id="roster-cards" class="day-cards"></div><details><summary id="roster-review-title">Postos para revisar</summary><div id="roster-review"></div></details><details id="roster-missing-block"><summary id="roster-missing-title">Cadastrados sem nenhum dia fixo</summary><div id="roster-missing"></div></details><details><summary>Histórico das alterações de padrão</summary><div id="roster-history"></div></details><dialog class="coverage-dialog" id="roster-dialog"><form><h2 id="roster-edit-title">Dia fixo</h2><label>Médico<select name="doctor" required></select></label><div class="form-grid"><label>Vínculo neste plantão<select name="affiliation"><option>SMS</option><option>COAPH</option><option>EXTRA SMS</option></select></label><label>Dia da semana<select name="weekday"></select></label><label>Posto e horário<select name="slot"></select></label><label>Válido a partir de<input name="start" type="date" required></label></div><button type="button" id="roster-next" class="secondary">Usar próxima quinzena</button><label id="roster-extra-label" hidden><input type="checkbox" name="repeatExtra"> Repetir este extra toda semana a partir da data informada</label><label><input type="checkbox" name="end"> Encerrar este dia fixo a partir da data informada</label><p id="roster-impact" role="status"></p><label id="roster-replace-label" hidden><input type="checkbox" name="replace"> Confirmo substituir o médico que ocupa esse posto no padrão</label><p class="notice">O vínculo pertence a este plantão. Alterar aqui não muda outros vínculos do mesmo médico. Extras importados continuam pontuais. Para repetir um extra, escolha EXTRA SMS e marque a repetição semanal. Ajustes por data e coberturas confirmadas continuam tendo prioridade.</p><fieldset id="roster-excluir-fixos" class="excluir-fixos" hidden><legend>Excluir dias fixos deste médico</legend><p class="notice">Marque os dias que deixam de ser fixos. Vale a partir da data em "Válido a partir de"; os dias anteriores não mudam e a escala já é atualizada. O médico continua no cadastro.</p><div class="excluir-lista"></div><button type="button" class="secondary danger" id="roster-excluir-sel" disabled>Excluir dias selecionados</button></fieldset><div class="actions"><button type="submit">Salvar mudança</button><button type="button" class="secondary" id="roster-cancel">Cancelar</button></div></form></dialog>`;
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
 const changeDoctor=(d,link)=>`${name(d)}\nCRM ${d.match(/CRM\s*(\d+)/i)?.[1]||''} - ${link}`;
 days.forEach((d,i)=>form.elements.weekday.add(new Option(d,i)));slots.forEach((s,i)=>form.elements.slot.add(new Option(slotLabel(i)+` · ${bounds(i)[1]-bounds(i)[0]}h`,i)));
 // "Clínico (qualquer)": o médico não fica preso ao número 1/2/3/4 — a posição exata é
 // decidida sozinha todo dia (ordem alfabética, só nos postos que sobrarem vagos).
 const addGenericOption=(value,label,beforeSlotIndex)=>{const before=[...form.elements.slot.options].find(o=>o.value===String(beforeSlotIndex));form.elements.slot.add(new Option(label,value),before||null);};
 addGenericOption('generic-dia','Diurno · Clínico (qualquer) · 12h',4);
 addGenericOption('generic-noite','Noturno · Clínico (qualquer) · 12h',11);
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
  const slot=Number(slotValue);
  const target=recurringRule(seed,storage,start,weekday,slot);
  const replacing=!!target?.doctor&&doctorIdentity(target.doctor)!==doctorIdentity(form.elements.doctor.value)&&!form.elements.end.checked;
  root.querySelector('#roster-replace-label').hidden=!replacing;
  const moves=original&&!original.generic&&(original.weekday!==weekday||original.slot!==slot);
  root.querySelector('#roster-impact').textContent=form.elements.end.checked?`O posto ficará sem médico fixo a partir de ${fmt(start)}. Dias anteriores permanecem iguais.`:`${days[weekday]} · ${slots[slot]}, a partir de ${fmt(start)}.${moves?' O dia/posto anterior será liberado a partir dessa data.':''}${replacing?' Neste posto está '+name(target.doctor)+'.':''}`;
  return replacing;
 }
 // "Alterar": lista os dias fixos do médico para excluir vários de uma vez (o dia clicado já vem marcado).
 function montarExclusao(rule){
  const caixa=root.querySelector('#roster-excluir-fixos'),lista=caixa.querySelector('.excluir-lista'),botao=caixa.querySelector('#roster-excluir-sel');
  lista.replaceChildren();caixa.hidden=true;botao.disabled=true;
  if(!rule?.doctor)return;
  const {fixos,genericos}=fixosDoMedico(seed,storage,rule.doctor,date.value);
  const itens=[...fixos.map(f=>({tipo:'fixo',dado:f,rotulo:`${days[f.weekday]} · ${slotLabel(f.slot)}`,marcado:!rule.generic&&f.weekday===rule.weekday&&f.slot===rule.slot})),
   ...genericos.map(g=>({tipo:'generico',dado:g,rotulo:`${days[g.weekday]} · ${g.turn==='dia'?'Diurno':'Noturno'} · Clínico (qualquer)`,marcado:!!rule.generic&&g.weekday===rule.weekday&&g.turn===turnOf(rule)}))]
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
 function open(rule,doctor=''){
  original=rule?{...rule,turn:turnOf(rule)}:null;
  form.reset();
  form.elements.doctor.replaceChildren(new Option('Selecione o médico',''));
  for(const d of people())form.elements.doctor.add(new Option(d.replaceAll('\n',' · '),d));
  const selected=doctor||rule?.doctor||'';
  const match=people().find(d=>doctorIdentity(d)===doctorIdentity(selected));
  form.elements.doctor.value=match||'';
  form.elements.affiliation.value=affiliation(selected)||'SMS';
  form.elements.weekday.value=rule?.weekday??1;
  form.elements.slot.value=rule?.generic?`generic-${original.turn}`:(rule?.slot??0);
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
  if(!generic&&impact()&&!form.elements.replace.checked)return;
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
   const slot=Number(slotValue),doctor=form.elements.end.checked?'':doctorString;
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
  for(let w=0;w<7;w++)for(let slot=0;slot<16;slot++){const r=recurringRule(seed,storage,refDate,w,slot);if(r){const rule={...r,weekday:w,slot};if(r.doctor){const key=doctorIdentity(r.doctor);if(!groups.has(key))groups.set(key,{doctor:r.doctor,rules:[]});groups.get(key).rules.push(rule);}else if(r.status==='review')review.push(rule);}
   // Dias fixos já salvos que começam depois da data acima não somem da lista:
   // aparecem marcados como "passa a valer em" para não parecer que o cadastro falhou.
   for(const future of parse(storage,'roster',[]).filter(x=>x.weekday===w&&x.slot===slot&&x.start>refDate&&x.doctor).sort((a,b)=>a.start.localeCompare(b.start))){const key=doctorIdentity(future.doctor);if(!groups.has(key))groups.set(key,{doctor:future.doctor,rules:[]});groups.get(key).rules.push({...future,weekday:w,slot,upcoming:true});}
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
 function render(){crmPendentes();if(!date.value){registry();return;}root.querySelector('#roster-date-label').textContent=`${days[new Date(date.value+'T12:00:00').getDay()]} · ${fmt(date.value)}`;const pattern=patternFor(seed,date.value);root.querySelector('#roster-source').textContent=pattern?`Base: ${pattern.source}. SMS repetidos foram organizados como fixos; COAPH repetidos como padrão habitual. Extras e posições variáveis precisam de revisão.`:'Sem padrão importado para este período. Você pode cadastrar dias fixos.';const conflicts=seed.assignments.filter(x=>x.doctor&&x.date.slice(0,7)===date.value.slice(0,7)&&x.colorAffiliation&&x.colorAffiliation!==x.affiliation);if(conflicts.length)root.querySelector('#roster-source').textContent+=' Atenção: '+conflicts.map(x=>name(x.doctor)+' em '+fmt(x.date)).join('; ')+' têm divergência entre texto e cor. Mantido o vínculo escrito, sem assumir fixo.';const {groups,review,clinicoRows}=buildGroups(date.value);registry(groups);
 const rowLabel=r=>(r.generic&&!Number.isInteger(r.slot)?`${days[r.weekday]} · ${r.turn==='dia'?'Diurno':'Noturno'} · Clínico (qualquer)`:`${days[r.weekday]} · ${slotLabel(r.slot)}`+(r.generic?' · (qualquer)':''));
 const cards=root.querySelector('#roster-cards');cards.replaceChildren();const query=doctorIdentity(root.querySelector('#roster-search').value);for(const group of [...groups.values()].sort((a,b)=>name(a.doctor).localeCompare(name(b.doctor),'pt-BR'))){if(query&&!doctorIdentity(group.doctor).includes(query))continue;const card=document.createElement('article');card.className='shift-card';const h=document.createElement('h3');h.textContent=name(group.doctor);card.append(h);for(const r of group.rules.sort((a,b)=>(a.upcoming===b.upcoming?0:a.upcoming?1:-1)||a.weekday-b.weekday)){const row=document.createElement('div');row.className='roster-line'+(r.upcoming?' roster-upcoming':'');const p=document.createElement('p');p.textContent=rowLabel(r)+(r.upcoming?` · passa a valer em ${fmt(r.start)}`:'')+(r.overflow?' · sem posto vago nesta data':'');const badge=document.createElement('span');badge.className='affiliation '+affiliationClass(r.doctor);badge.textContent=(r.upcoming?'Agendado · ':'')+(r.overflow?'Sem posto hoje · ':'')+affiliation(r.doctor);const button=document.createElement('button');button.className='secondary';button.textContent='Alterar';button.setAttribute('aria-label',`Alterar ${name(group.doctor)} ${rowLabel(r)}`);button.onclick=()=>open(r);row.append(p,badge,button);card.append(row);}const add=document.createElement('button');add.className='secondary';add.textContent='+ Outro dia fixo';add.onclick=()=>open(null,group.doctor);card.append(add,botaoExcluir(group.doctor));cards.append(card);}if(!cards.children.length)cards.textContent='Nenhum médico com dia fixo nesta seleção.';
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
