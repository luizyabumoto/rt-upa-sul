export async function mountPush(){
 const host=document.querySelector('#overview-panel');if(!host)return;
 const section=document.createElement('section');section.className='card push-settings';
 section.innerHTML='<h2>Lembretes no celular</h2><p>Um aviso diário a partir das 8h (horário de Cuiabá), quando houver pendências para hoje ou atrasadas. Salve as pendências online para receber. O aviso não mostra nomes nem detalhes.</p><p id="push-status" role="status" aria-live="polite"></p><div class="actions"><button id="push-enable" type="button">Ativar neste aparelho</button><button id="push-test" class="secondary" type="button" hidden>Enviar teste</button><button id="push-disable" class="secondary" type="button" hidden>Desativar neste aparelho</button></div>';
 (host.querySelector('[data-slot="extra"]')||host).append(section);const status=section.querySelector('#push-status'),enable=section.querySelector('#push-enable'),test=section.querySelector('#push-test'),disable=section.querySelector('#push-disable');
 const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone;
 if(ios&&!standalone){status.textContent='No iPhone, abra no Safari → Compartilhar → Adicionar à Tela de Início. Depois abra pelo ícone e toque em Ativar neste aparelho. Requer iOS 16.4 ou superior.';enable.hidden=true;return;}
 if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)){status.textContent='Este navegador não oferece notificações. No iPhone, use o app adicionado à Tela de Início com iOS 16.4 ou superior.';enable.hidden=true;return;}
 let registration,subscription;
 async function api(path,body){const r=await fetch('/api/push/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.error||'Não foi possível concluir.');return data;}
 function active(value){enable.hidden=value;test.hidden=!value;disable.hidden=!value;}
 function busy(value){for(const b of [enable,test,disable])b.disabled=value;}
 try {registration=await navigator.serviceWorker.register('/sw.js',{scope:'/'});await navigator.serviceWorker.ready;subscription=await registration.pushManager.getSubscription();active(false);if(subscription){const check=await api('status',{endpoint:subscription.endpoint});active(check.enabled);status.textContent=check.enabled?'Ativo neste aparelho. Você pode enviar um teste.':'Toque em Ativar para vincular este aparelho à sua conta.';}else status.textContent='Toque em Ativar e permita as notificações quando o iPhone perguntar.';}
 catch{status.textContent='Não foi possível preparar as notificações. Atualize a página e entre novamente.';enable.disabled=true;return;}
 enable.onclick=async()=>{busy(true);try{
  // Permission must be requested directly from this user gesture on iOS.
  const permission=await Notification.requestPermission();if(permission!=='granted')throw new Error('Permissão não concedida. No iPhone, confira Ajustes → Notificações → RT UPA Sul.');
  const config=await api('config',{});const raw=atob(config.publicKey.replace(/-/g,'+').replace(/_/g,'/'));const key=Uint8Array.from(raw,c=>c.charCodeAt(0));
  subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
  await api('subscribe',{subscription:subscription.toJSON()});active(true);status.textContent='Ativado! Toque em Enviar teste para conferir a chegada no celular.';
 }catch(e){status.textContent=e.message;}finally{busy(false);}};
 test.onclick=async()=>{busy(true);try{await api('test',{endpoint:subscription.endpoint});status.textContent='Teste aceito pelo serviço de notificações. Confira a Central de Notificações do iPhone.';}catch(e){status.textContent=e.message;}finally{busy(false);}};
 disable.onclick=async()=>{busy(true);try{await api('disable',{endpoint:subscription.endpoint});await subscription.unsubscribe();subscription=null;active(false);status.textContent='Desativado neste aparelho.';}catch(e){status.textContent=e.message;}finally{busy(false);}};
}
