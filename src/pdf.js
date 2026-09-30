import {nomeArquivo} from './calendar.js';
export function mountPdf(storage){
 const root=document.querySelector('#pdf-panel');
 root.innerHTML=`<div class="section-heading"><div><p class="eyebrow">PRONTA PARA IMPRIMIR</p><h2>Exportar escala em PDF</h2><p>Folhas A4 em paisagem, com fundo branco e vínculos em cores.</p></div></div><form id="pdf-form" class="card"><div class="form-grid"><label>Ano do PDF<input name="year" type="number" min="2020" max="2100" required></label><label>Mês do PDF<select name="month"></select></label><label>Quinzena do PDF<select name="half"><option value="1">1ª · dias 1 a 15</option><option value="2">2ª · dia 16 ao fim do mês</option></select></label><label>Escala para exportar<select name="kind"><option value="regular">Médica · diurno e noturno</option><option value="cinderela">Cinderelas · 6 horas</option></select></label><label>Distribuição nas folhas<select name="layout"><option value="compact">Quinzena inteira · 1 folha (igual ao Excel)</option><option value="weekly">Uma semana por folha · letras maiores</option></select></label></div><p class="notice">Mesmo desenho do Excel: postos nas linhas, dias nas colunas, faixas de diurno, noturno e visita, e cor de fundo pelo vínculo. O arquivo inclui os ajustes e as coberturas confirmadas atuais, sem suas anotações pessoais.</p><button type="submit">Baixar PDF em paisagem</button><p id="pdf-status" role="status" aria-live="polite"></p><div id="pdf-links" class="actions"></div><p>Depois de baixar, abra o PDF para imprimir. No iPhone, abra o arquivo e use Compartilhar → Imprimir. Se necessário, selecione A4, paisagem e ajustar à página.</p></form>`;
 const form=root.querySelector('form');let lastUrl;const links=root.querySelector('#pdf-links');
 const months=document.querySelector('#month');for(const option of months.options)form.elements.month.add(new Option(option.text,option.value));
 function period(){for(const k of ['year','month','half'])form.elements[k].value=document.querySelector('#'+k).value;}
 // Imprimir / PDF fica dentro da aba Escala: a janela abre já com a quinzena que está na tela.
 const dialog=document.querySelector('#pdf-dialog');
 document.querySelector('#open-pdf').addEventListener('click',()=>{period();dialog.showModal();});
 document.querySelector('#close-pdf').addEventListener('click',()=>dialog.close());
 period();
 form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button'),status=root.querySelector('#pdf-status');button.disabled=true;status.textContent='Preparando PDF…';try{
  const items={};for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key.startsWith('rt-upa:'))items[key]=storage.getItem(key);}
  const payload={items};for(const k of ['year','month','half'])payload[k]=Number(form.elements[k].value);for(const k of ['kind','layout'])payload[k]=form.elements[k].value;
  const response=await fetch('/api/export-pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(!response.ok){let message='Não foi possível gerar o PDF. Tente novamente.';try{message=(await response.json()).error||message;}catch{}throw new Error(message);}
  if(lastUrl)URL.revokeObjectURL(lastUrl);const url=lastUrl=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download=nomeArquivo(payload.kind==='cinderela'?'cinderela':'regular',payload.year,payload.month,payload.half,'pdf');a.textContent='Baixar novamente';const open=document.createElement('a');open.href=url;open.target='_blank';open.rel='noopener';open.textContent='Abrir PDF';links.replaceChildren(open,a);a.click();status.textContent='PDF pronto para '+payload.month+'/'+payload.year+' · '+payload.half+'ª quinzena. Use Abrir PDF para conferir ou imprimir.';
 }catch(error){status.textContent=error.message;}finally{button.disabled=false;}};
}
