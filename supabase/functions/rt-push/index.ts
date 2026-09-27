import webpush from 'npm:web-push@3.6.7';
import {allowedEndpoint,dueItems,cuiabaClock} from './logic.js';
const url=Deno.env.get('SUPABASE_URL')!;
const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
async function db(path:string,method='GET',body?:unknown,prefer?:string){
 const r=await fetch(url+'/rest/v1/'+path,{method,headers:{apikey:service,Authorization:`Bearer ${service}`,'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 if(!r.ok)throw new Error('Database request failed'); const text=await r.text();return text?JSON.parse(text):null;
}
const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async(req:Request)=>{
 try{
  if(req.method!=='POST')return reply(405,{error:'Método inválido.'});
  if(Number(req.headers.get('content-length')||0)>8192)return reply(413,{error:'Pedido muito grande.'});
  const config=await db('rpc/rt_push_config','POST',{});
  const cron=req.headers.get('x-rt-cron');let userId:string|null=null;
  if(cron){if(cron!==config?.rt_push_cron_secret)return reply(401,{error:'Acesso inválido.'});}
  else {
   const authorization=req.headers.get('authorization')||'';
   const auth=await fetch(url+'/auth/v1/user',{headers:{apikey:service,Authorization:authorization}});
   if(!auth.ok)return reply(401,{error:'Entre novamente para continuar.'});
   const user=await auth.json();if(user.is_anonymous)return reply(403,{error:'Acesso inválido.'});
   const members=await db('rt_members?user_id=eq.'+encodeURIComponent(user.id)+'&select=user_id');
   if(!members.length)return reply(403,{error:'Acesso inválido.'});userId=user.id;
  }
  const body=await req.json();
  const pushOptions={vapidDetails:{subject:'https://rt-upa-sul.vercel.app',publicKey:config.rt_vapid_public,privateKey:config.rt_vapid_private},TTL:3600,urgency:'normal',contentEncoding:'aes128gcm'};
  if(cron&&body.action==='selftest'){
   const details=webpush.generateRequestDetails({endpoint:'https://web.push.apple.com/selftest',keys:{p256dh:config.rt_vapid_public,auth:'AAAAAAAAAAAAAAAAAAAAAA'}},'RT test',pushOptions);
   return reply(200,{encryptionReady:details.body.length>0,vapidReady:Boolean(details.headers.Authorization||details.headers.authorization)});
  }
  if(!cron&&body.action==='config')return reply(200,{publicKey:config.rt_vapid_public});
  if(!cron&&body.action!=='test')return reply(400,{error:'Ação inválida.'});
  if(!cron&&typeof body.endpoint!=='string')return reply(400,{error:'Ative as notificações primeiro.'});
  const {today,hour}=cuiabaClock();
  if(cron&&(hour<8||hour>=20))return reply(200,{sent:0,outsideWindow:true});
  const subscriptions=await db('rt_push_subscriptions?enabled=eq.true&select=*'+(userId?'&user_id=eq.'+encodeURIComponent(userId)+'&endpoint=eq.'+encodeURIComponent(body.endpoint):''));
  let sent=0,failed=0,skipped=0;
  for(const sub of subscriptions){
   if(!allowedEndpoint(sub.endpoint)){failed++;continue;}
   const members=await db('rt_members?user_id=eq.'+encodeURIComponent(sub.user_id)+'&select=user_id');if(!members.length)continue;
   if(cron){const states=await db('rt_state?user_id=eq.'+encodeURIComponent(sub.user_id)+'&select=items');if(!dueItems(states[0]?.items,today).length)continue;}
   const key=cron?`daily:${today}`:`test:${Math.floor(Date.now()/60000)}`;
   if(!await db('rpc/rt_claim_push','POST',{p_subscription:sub.id,p_key:key})){skipped++;continue;}
   let status=500;
   try{
    const payload=JSON.stringify({title:'RT UPA Sul',body:cron?'Você tem pendências da RT para conferir.':'Notificações ativadas! Seus lembretes chegarão por aqui.',tag:cron?'rt-pendencias':'rt-teste'});
    const details=webpush.generateRequestDetails({...sub.subscription,endpoint:sub.endpoint},payload,pushOptions);
    const result=await fetch(details.endpoint,{method:'POST',headers:details.headers,body:details.body,redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!result.ok)throw {statusCode:result.status};
    status=result.status;sent++;
   }catch(error){status=Number(error.statusCode)||500;failed++;if(status===404||status===410)await db('rt_push_subscriptions?id=eq.'+sub.id,'PATCH',{enabled:false});}
   await db('rt_push_deliveries?subscription_id=eq.'+sub.id+'&delivery_key=eq.'+encodeURIComponent(key),'PATCH',{last_status:status,...(status>=200&&status<300?{delivered_at:new Date().toISOString()}:{})});
  }
  if(!cron&&!subscriptions.length)return reply(400,{error:'Este aparelho ainda não está ativado. Ative novamente.'});
  if(!cron&&failed)return reply(502,{error:'O serviço de notificações não aceitou o teste. Tente ativar novamente.'});
  if(!cron&&!sent&&skipped)return reply(429,{error:'Aguarde um minuto antes de testar novamente.'});
  return reply(200,{sent,failed,skipped});
 }catch{ return reply(500,{error:'Não foi possível enviar agora. Tente novamente.'}); }
});
