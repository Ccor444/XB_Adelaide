/* Sistema de arquivos virtual do editor.
   Backends (todos expõem a mesma interface, então o resto do editor não sabe de onde vêm os arquivos):
     ServerFS  – http://localhost com serve.py (API /api/*)                       → lê e grava no disco
     DirFS     – pasta escolhida pelo navegador (File System Access API)          → lê e grava no disco, sem servidor, também em file://
     MemFS     – pasta enviada por <input webkitdirectory> ou um .zip              → edita em memória; exporte um .zip
   E.api = fachada usada por todas as abas (tree/bin/text/json/save/del/rename/backups/restore/blobUrl). */
(function(){
const enc=new TextEncoder(),dec=new TextDecoder();
const SKIP=/(^|\/)(\.git|node_modules|_backup|__pycache__|\.idea|\.vscode)(\/|$)|(^|\/)(\.DS_Store|Thumbs\.db)$|\.tmp$/;
const MIMES={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',svg:'image/svg+xml',wav:'audio/wav',mp3:'audio/mpeg',ogg:'audio/ogg',json:'application/json',js:'text/javascript',css:'text/css',html:'text/html',txt:'text/plain',md:'text/plain',py:'text/plain',bat:'text/plain',sh:'text/plain',bin:'application/octet-stream'};
E.mimeOf=p=>MIMES[(p.split('.').pop()||'').toLowerCase()]||'application/octet-stream';
E.mime=p=>/\.webp$/i.test(p)?'image/webp':/\.jpe?g$/i.test(p)?'image/jpeg':'image/png';
const toU8=async d=>{if(typeof d==='string')return enc.encode(d);if(d instanceof Uint8Array)return d;if(d instanceof ArrayBuffer)return new Uint8Array(d);
  if(ArrayBuffer.isView(d))return new Uint8Array(d.buffer,d.byteOffset,d.byteLength);if(d instanceof Blob)return new Uint8Array(await d.arrayBuffer());throw new Error('tipo de dado inválido')};
const pad=n=>String(n).padStart(2,'0');
const stamp=()=>{const d=new Date();return d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+'-'+pad(d.getHours())+pad(d.getMinutes())+pad(d.getSeconds())};
const dirOf=p=>{const i=p.lastIndexOf('/');return i<0?'':p.slice(0,i)};
const cleanPath=p=>{p=String(p).replace(/\\/g,'/').replace(/^\.?\/+/,'').replace(/\/{2,}/g,'/');if(!p||p.split('/').some(s=>s==='..'||s===''))throw new Error('Caminho inválido: '+p);return p};
E.cleanPath=cleanPath;

/* ---------------- ServerFS ---------------- */
class ServerFS{
  constructor(base,full){this.kind='server';this.base=base;this.label='servidor local ('+location.host+')';this.full=full;this.nativeBackup=true;this.writable=true}
  async tree(){const r=await fetch(this.base+'api/tree',{cache:'no-store'});if(!r.ok)throw new Error('API /api/tree → HTTP '+r.status);return r.json()}
  async read(p){const r=await fetch(this.base+p.split('/').map(encodeURIComponent).join('/')+'?v='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error(p+' → HTTP '+r.status);return new Uint8Array(await r.arrayBuffer())}
  async post(path,q,body){const r=await fetch(this.base+path+'?'+q,{method:'POST',body});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j}
  async write(p,u8){return this.post('api/save','path='+encodeURIComponent(p),u8)}
  async remove(p){if(!this.full)throw new Error('Este serve.py é antigo: substitua pelo serve.py novo para excluir arquivos');return this.post('api/delete','path='+encodeURIComponent(p))}
  async backups(p){return(await fetch(this.base+'api/backups?path='+encodeURIComponent(p),{cache:'no-store'})).json()}
  async restore(p,ts){return this.post('api/restore','path='+encodeURIComponent(p)+'&ts='+encodeURIComponent(ts))}
}

/* ---------------- DirFS (File System Access API) ---------------- */
class DirFS{
  constructor(root){this.kind='dir';this.root=root;this.label='pasta “'+root.name+'”';this.dirs=new Map([['',root]]);this.writable=true}
  async dir(path,create){
    if(this.dirs.has(path))return this.dirs.get(path);
    const parent=await this.dir(dirOf(path),create),h=await parent.getDirectoryHandle(path.slice(path.lastIndexOf('/')+1),{create});this.dirs.set(path,h);return h}
  async fh(p,create){return(await this.dir(dirOf(p),create)).getFileHandle(p.slice(p.lastIndexOf('/')+1),{create})}
  async tree(){const out=[];this.dirs=new Map([['',this.root]]);
    const walk=async(h,pre)=>{for await(const[n,e]of h.entries()){const p=pre?pre+'/'+n:n;if(SKIP.test(p))continue;
      if(e.kind==='directory'){this.dirs.set(p,e);await walk(e,p)}else{const f=await e.getFile();out.push({p,s:f.size})}}};
    await walk(this.root,'');return out}
  async read(p){return new Uint8Array(await(await(await this.fh(p,false)).getFile()).arrayBuffer())}
  async exists(p){try{await this.fh(p,false);return true}catch(e){return false}}
  async write(p,u8){const w=await(await this.fh(p,true)).createWritable();await w.write(u8);await w.close()}
  async remove(p){const d=await this.dir(dirOf(p),false);await d.removeEntry(p.slice(p.lastIndexOf('/')+1))}
  async putBackup(ts,p,old){const bp='_backup/'+ts+'/'+p;if(await this.exists(bp))return;await this.write(bp,old)}
  async backups(p){const out=[];try{const b=await this.dir('_backup',false);for await(const[n,e]of b.entries())if(e.kind==='directory'&&await this.exists('_backup/'+n+'/'+p))out.push(n)}catch(e){}return out.sort().reverse().slice(0,40)}
  async getBackup(p,ts){return this.read('_backup/'+ts+'/'+p)}
}

/* ---------------- MemFS (pasta enviada / zip) ---------------- */
class MemFS{
  constructor(label){this.kind='mem';this.label=label;this.files=new Map();this.hist=new Map();this.writable=true}
  async tree(){return[...this.files].map(([p,f])=>({p,s:f.size}))}
  async read(p){const f=this.files.get(p);if(!f)throw new Error(p+' → não encontrado no projeto');
    if(f.u8)return f.u8;if(f.file)return new Uint8Array(await f.file.arrayBuffer());return f.lazy()}
  async exists(p){return this.files.has(p)}
  async write(p,u8){this.files.set(p,{u8,size:u8.length})}
  async remove(p){this.files.delete(p)}
  async putBackup(ts,p,old){let a=this.hist.get(p);if(!a)this.hist.set(p,a=[]);if(a.some(x=>x.ts===ts))return;a.unshift({ts,data:old.slice()});if(a.length>8)a.pop()}
  async backups(p){return(this.hist.get(p)||[]).map(x=>x.ts)}
  async getBackup(p,ts){const x=(this.hist.get(p)||[]).find(y=>y.ts===ts);if(!x)throw new Error('versão não encontrada');return x.data}
}

/* ---------------- fachada ---------------- */
E.ver={};E.changed=new Set();E.tree=[];E.treeMap={};E.fs=null;
const urlCache=new Map();
const sortTree=t=>t.sort((a,b)=>a.p<b.p?-1:1);
const setTree=t=>{E.tree=sortTree(t);E.treeMap=Object.fromEntries(E.tree.map(f=>[f.p,f]))};
const bump=p=>{E.ver[p]=Date.now();for(const k of[...urlCache.keys()])if(k.startsWith(p+'|')){const u=urlCache.get(k);urlCache.delete(k);u.then(x=>URL.revokeObjectURL(x)).catch(()=>{})}};
E.api={
  get kind(){return E.fs?E.fs.kind:null},
  async tree(){if(!E.fs)return[];setTree(await E.fs.tree());return E.tree},
  async bin(p){const u=await E.fs.read(p);return u.buffer.slice(u.byteOffset,u.byteOffset+u.byteLength)},   // ArrayBuffer isolado
  async u8(p){return E.fs.read(p)},
  async text(p){return dec.decode(await E.fs.read(p))},
  async json(p){return JSON.parse(await this.text(p))},
  has(p){return!!E.treeMap[p]},
  async save(p,data){
    p=cleanPath(p);const fs=E.fs;if(!fs)throw new Error('Nenhum projeto aberto');const u8=await toU8(data);
    if(!fs.nativeBackup&&fs.putBackup){try{const old=await fs.read(p);await fs.putBackup(stamp(),p,old)}catch(e){}}
    await fs.write(p,u8);bump(p);E.changed.add(p);
    const t=E.treeMap[p];if(t)t.s=u8.length;else{const n={p,s:u8.length};E.tree.push(n);sortTree(E.tree);E.treeMap[p]=n}
    E.emit('saved',p);return{ok:true,size:u8.length}},
  async del(p){const fs=E.fs;if(!fs.nativeBackup&&fs.putBackup){try{await fs.putBackup(stamp(),p,await fs.read(p))}catch(e){}}
    await fs.remove(p);bump(p);E.changed.add(p);delete E.treeMap[p];E.tree=E.tree.filter(f=>f.p!==p);E.emit('saved',p)},
  async rename(a,b){b=cleanPath(b);if(E.treeMap[b])throw new Error('Já existe: '+b);const u=await E.fs.read(a);await this.save(b,u);await this.del(a)},
  async backups(p){return E.fs.backups?E.fs.backups(p):[]},
  async restore(p,ts){const fs=E.fs;if(fs.nativeBackup){await fs.restore(p,ts)}else{const old=await fs.getBackup(p,ts);await this.save(p,old)}bump(p);E.changed.add(p);E.emit('saved',p);return{ok:true}},
  /* URL de objeto (blob:) para <img>/<audio>; funciona igual em file://, http:// e pasta local. DDS vira PNG. */
  blobUrl(p){const k=p+'|'+(E.ver[p]||0);if(!urlCache.has(k))urlCache.set(k,(async()=>{
      const u8=await E.fs.read(p);if(/\.dds$/i.test(p)){const c=E.dds.toCanvas(u8);const b=await new Promise(r=>c.toBlob(r,'image/png'));return URL.createObjectURL(b)}
      return URL.createObjectURL(new Blob([u8],{type:E.mimeOf(p)}))})());return urlCache.get(k)},
  /* referência a arquivos para a prévia do jogo */
  async exportZip(onlyChanged,onProgress){
    const list=E.tree.filter(f=>!onlyChanged||E.changed.has(f.p)),ents=[];let i=0;
    for(const f of list){ents.push({name:f.p,data:await E.fs.read(f.p)});if(onProgress)onProgress(++i,list.length)}
    return XZip.write(ents)}
};
E.stamp=stamp;
E.toU8=toU8;

/* ---------------- abrir projeto ---------------- */
const hasPicker=typeof window.showDirectoryPicker==='function';
const IDB={
  open(){return new Promise((res,rej)=>{const r=indexedDB.open('xb-editor',1);r.onupgradeneeded=()=>r.result.createObjectStore('h');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})},
  async get(k){try{const d=await this.open();return await new Promise(res=>{const q=d.transaction('h').objectStore('h').get(k);q.onsuccess=()=>res(q.result);q.onerror=()=>res(null)})}catch(e){return null}},
  async set(k,v){try{const d=await this.open();await new Promise(res=>{const t=d.transaction('h','readwrite');t.objectStore('h').put(v,k);t.oncomplete=res;t.onerror=res})}catch(e){}}
};
async function detectServer(){
  if(!/^https?:$/.test(location.protocol))return null;
  const base=new URL('../',location.href).href;
  try{const r=await fetch(base+'api/ping',{cache:'no-store'});if(r.ok){const j=await r.json();if(j&&j.xb)return new ServerFS(base,true)}}catch(e){}
  try{const r=await fetch(base+'api/tree',{cache:'no-store'});if(r.ok)return new ServerFS(base,false)}catch(e){}
  return null}
const stripRoot=paths=>{ // acha o prefixo (pasta raiz) do projeto: o que vem antes de js/game.js
  const g=paths.find(p=>/(^|\/)js\/game\.js$/.test(p))||paths.find(p=>/(^|\/)data\/trk\.json$/.test(p));
  if(g){const m=g.match(/^(.*?)(js\/game\.js|data\/trk\.json)$/);return m[1]}
  const first=new Set(paths.map(p=>p.split('/')[0]));return first.size===1?[...first][0]+'/':''};
async function memFromFiles(fileList){
  const arr=[...fileList].map(f=>({f,p:(f.webkitRelativePath||f.name).replace(/\\/g,'/')}));
  const pre=stripRoot(arr.map(x=>x.p)),fs=new MemFS('pasta enviada (memória)');
  for(const{f,p}of arr){const q=p.startsWith(pre)?p.slice(pre.length):p;if(!q||SKIP.test(q))continue;fs.files.set(q,{file:f,size:f.size})}
  return fs}
async function memFromZip(file){
  const ents=await XZip.read(await file.arrayBuffer()),pre=stripRoot(ents.map(e=>e.name)),fs=new MemFS('zip “'+file.name+'” (memória)');
  for(const e of ents){const q=e.name.startsWith(pre)?e.name.slice(pre.length):e.name;if(!q||SKIP.test(q))continue;fs.files.set(q,{lazy:e.read,size:e.size})}
  return fs}
E.openFS=async fs=>{
  E.fs=fs;await E.api.tree();
  if(!E.tree.length)throw new Error('Pasta vazia');
  if(!E.treeMap['data/trk.json']&&!E.treeMap['js/game.js'])throw new Error('Isto não parece a pasta do jogo (não achei data/trk.json nem js/game.js). Escolha a pasta que contém index.html, data/, cars/ e assets/.');
  E.emit('open',fs)};
E.openDirHandle=async h=>{const fs=new DirFS(h);await E.openFS(fs);IDB.set('last',h)};

E.initProject=async function(){
  const ov=E.$('#open'),msg=E.$('#op-msg'),say=(t,err)=>{msg.textContent=t;msg.className=err?'err':''};
  const forced=sessionStorage.getItem('xb:pick')==='1';sessionStorage.removeItem('xb:pick');
  const done=()=>{ov.classList.remove('on')};
  const tryOpen=async f=>{try{say('Abrindo…');await f();done();return true}catch(e){console.error(e);say(e.message||String(e),true);return false}};
  if(!forced){const sv=await detectServer();if(sv&&await tryOpen(()=>E.openFS(sv)))return}
  // opções manuais
  ov.classList.add('on');
  const last=await IDB.get('last');
  const btnLast=E.$('#op-last');
  if(last&&hasPicker){btnLast.hidden=false;btnLast.textContent='↻ Reabrir pasta “'+last.name+'”';
    btnLast.onclick=()=>tryOpen(async()=>{if(await last.requestPermission({mode:'readwrite'})!=='granted')throw new Error('Permissão negada para a pasta');await E.openDirHandle(last)})}
  E.$('#op-dir').hidden=!hasPicker;E.$('#op-nopick').hidden=hasPicker;
  E.$('#op-dir').onclick=()=>tryOpen(async()=>{let h;try{h=await window.showDirectoryPicker({mode:'readwrite',id:'xbgame'})}catch(e){if(e&&e.name==='AbortError')throw new Error('Cancelado');throw e}await E.openDirHandle(h)});
  E.$('#op-zip').onclick=()=>E.$('#op-zipf').click();
  E.$('#op-files').onclick=()=>E.$('#op-dirf').click();
  E.$('#op-zipf').onchange=e=>{const f=e.target.files[0];e.target.value='';if(f)tryOpen(async()=>E.openFS(await memFromZip(f)))};
  E.$('#op-dirf').onchange=e=>{const fl=e.target.files;if(fl&&fl.length)tryOpen(async()=>E.openFS(await memFromFiles(fl)))};
  ov.ondragover=e=>{e.preventDefault()};
  ov.ondrop=e=>{e.preventDefault();const f=[...e.dataTransfer.files].find(x=>/\.zip$/i.test(x.name));if(f)tryOpen(async()=>E.openFS(await memFromZip(f)));else say('Solte um arquivo .zip do projeto',true)};
  const pr=location.protocol==='file:'?'Você abriu o editor direto do arquivo (file://). Tudo funciona; só é preciso dizer onde está o jogo.':'Servidor sem API de edição detectado. Escolha a pasta do jogo.';
  say(pr+' '+(hasPicker?'“Abrir pasta” lê e grava direto nos arquivos.':'Este navegador não grava direto em pastas: abra a pasta ou o .zip, edite e use “Exportar .zip”.'))
};
E.changeProject=()=>{if(Object.values(E.dirty||{}).some(Boolean)&&!confirm('Há alterações não salvas. Trocar de projeto mesmo assim?'))return;
  if(E.fs&&E.fs.kind==='mem'&&E.changed.size&&!confirm('Este projeto está na memória: alterações salvas aqui serão perdidas se você não exportar o .zip. Trocar mesmo assim?'))return;
  sessionStorage.setItem('xb:pick','1');window.onbeforeunload=null;location.reload()};
E.hasPicker=hasPicker;
E.MemFS=MemFS;E.DirFS=DirFS;E.ServerFS=ServerFS;
})();
