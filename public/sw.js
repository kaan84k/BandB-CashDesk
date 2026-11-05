const CACHE = 'cashdesk-shell-v2';
async function fetchAndCache(request,key){
  const response=await fetch(request);
  if(response.ok){try{await(await caches.open(CACHE)).put(key,response.clone());}catch{/* Cache restrictions must not break online requests. */}}
  return response;
}
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/','/favicon.svg','/manifest.webmanifest'])));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('cashdesk-shell-')&&k!==CACHE).map(k=>caches.delete(k)))));});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  if(request.mode==='navigate'){
    event.respondWith(fetchAndCache(request,'/').catch(()=>caches.match('/')));return;
  }
  if(url.pathname.startsWith('/assets/')&&['script','style','font','image'].includes(request.destination))event.respondWith(caches.match(request).then(cached=>cached||fetchAndCache(request,request)));
});
