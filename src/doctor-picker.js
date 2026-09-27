export const searchText=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
export function matchingDoctors(options,query){const terms=searchText(query).split(' ').filter(Boolean);return terms.length?Array.from(options).filter(o=>o.value&&terms.every(t=>searchText(o.textContent).includes(t))).slice(0,10):[];}
// Keep the native selector available for accessibility and explicit vacancy selection.
export function doctorPicker(select){
 if(select._doctorPicker){select._doctorPicker();return;}
 const wrap=document.createElement('div');wrap.className='doctor-picker';
 const label=document.createElement('label');label.textContent='Buscar por nome ou CRM';
 const input=document.createElement('input');input.type='search';input.placeholder='Digite e escolha uma sugestão';input.autocomplete='off';input.disabled=select.disabled;
 const list=document.createElement('div');list.className='doctor-suggestions';const status=document.createElement('small');status.setAttribute('role','status');label.append(input);wrap.append(label,list,status);(select.closest('label')||select).before(wrap);
 const reset=()=>{input.value='';list.replaceChildren();status.textContent='';input.disabled=select.disabled;};select._doctorPicker=reset;
 input.addEventListener('input',()=>{list.replaceChildren();const matches=matchingDoctors(select.options,input.value);status.textContent=input.value.trim()&&!matches.length?'Nenhum resultado. Cadastre em Médicos e fixos.':'';for(const option of matches){const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=option.textContent;button.onclick=()=>{select.value=option.value;reset();select.dispatchEvent(new Event('change',{bubbles:true}));};list.append(button);}});
 select.addEventListener('change',reset);
}

export function doctorSearchButton(select){const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Buscar médico';button.disabled=select.disabled;button.onclick=()=>{doctorPicker(select);button.hidden=true;select.previousElementSibling?.querySelector('input')?.focus();};select.after(button);}
