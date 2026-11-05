const CACHE = 'cashdesk-shell-__CASHDESK_BUILD_ID__';
const PRECACHE = __CASHDESK_PRECACHE__;
const STATIC = ['/favicon.svg','/manifest.webmanifest','/icon-180.png','/icon-192.png','/icon-512.png'];
async function fetchAndCache(request,key){
  const response=await fetch(request);
  if(response.ok){try{await(await caches.open(CACHE)).put(key,response.clone());}catch{/* Cache restrictions must not break online requests. */}}
  return response;
}
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/',...STATIC,...PRECACHE])));});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{
  const keys=(await caches.keys()).filter(k=>k.startsWith('cashdesk-shell-'));
  const previous=keys.filter(k=>k!==CACHE).at(-1);
  await Promise.all(keys.filter(k=>k!==CACHE&&k!==previous).map(k=>caches.delete(k)));
  await self.clients.claim();
})());});
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  if(request.mode==='navigate'){
    event.respondWith(fetchAndCache(request,'/').catch(()=>caches.match('/')));return;
  }
  if(STATIC.includes(url.pathname)||(url.pathname.startsWith('/assets/')&&['script','style','font','image'].includes(request.destination)))event.respondWith(caches.match(request,{ignoreVary:true}).then(cached=>cached||fetchAndCache(request,request)));
});
