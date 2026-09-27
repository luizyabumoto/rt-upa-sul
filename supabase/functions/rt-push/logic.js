export function allowedEndpoint(endpoint) {
 try { const u=new URL(endpoint); return u.protocol==='https:' && !u.username && !u.password && !u.port && !u.hash && (u.hostname==='web.push.apple.com'||u.hostname==='fcm.googleapis.com'||u.hostname==='updates.push.services.mozilla.com'||u.hostname.endsWith('.push.services.mozilla.com')); } catch {return false;}
}
export function dueItems(items,today) {
 let list;try{list=JSON.parse(items?.['rt-upa:organizer']||'[]');}catch{return [];}
 if(!Array.isArray(list))return [];
 return list.filter(x=>x?.kind==='task'&&x.status!=='Resolvido'&&typeof (x.reminder||x.date)==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x.reminder||x.date)&&(x.reminder||x.date)<=today);
}
export function cuiabaClock(now=new Date()) {
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Cuiaba',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
 return {today:`${parts.year}-${parts.month}-${parts.day}`,hour:Number(parts.hour)};
}
