// No page or API caching: private schedules stay behind authentication.
self.addEventListener('push',event=>{
 let data={};try{data=event.data?.json()||{};}catch{}
 event.waitUntil(self.registration.showNotification('RT UPA Sul',{
  body:data.body||'Abra o RT UPA Sul para conferir seus lembretes.',
  icon:'/icon.png',badge:'/icon.png',tag:data.tag||'rt-pendencias',data:{url:'/?lembretes=1'}
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const client of windows)if(new URL(client.url).origin===self.location.origin){await client.focus();return;}
  await self.clients.openWindow('/?lembretes=1');
 })());
});
