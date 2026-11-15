/* Service worker do XB Adelaide: rede primeiro (sempre pega a versão nova), com cópia local para abrir sem internet depois da 1ª visita. */
const CACHE='xbadl-v1';
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['./','./index.html','./manifest.webmanifest','./assets/pwa/any-192.png','./assets/pwa/any-512.png'])).catch(()=>{}))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const r=e.request,u=new URL(r.url);
  if(r.method!=='GET'||u.origin!==location.origin||/\/(api|editor)(\/|$)/.test(u.pathname)||r.headers.has('range'))return;
  e.respondWith(fetch(r).then(res=>{if(res.ok){const cp=res.clone();caches.open(CACHE).then(c=>c.put(r,cp)).catch(()=>{})}return res}).catch(()=>caches.match(r).then(m=>m||caches.match('./index.html'))))});
