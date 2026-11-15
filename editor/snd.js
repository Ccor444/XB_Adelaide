/* Aba Sons: forma de onda, cortes, ganho, fades, loop contínuo, velocidade, mono, importar, versões. */
(function(){
const $=E.$;let vw={a:0,b:1},szb=null,AC,cur=null,work=null,src=null,undo=[],sndJson=null;
E.init_snd=async function(){
  AC=new (window.AudioContext||window.webkitAudioContext)();
  try{sndJson=await E.api.json('data/snd.json')}catch(e){}
  setupWave();list();$('#sn-q').oninput=list;E.sub('saved',E.debounce(()=>{if(E.cur==='snd')list()},400));
  $('#sn-gain').oninput=()=>$('#sn-gainv').textContent=$('#sn-gain').value;
  E.on('sn-play','click',play);E.on('sn-stop','click',stop);E.on('sn-apply','click',apply);E.on('sn-norm','click',norm);E.on('sn-undo','click',doUndo);
  E.on('sn-fade','click',E.guard(fades));E.on('sn-rev','click',()=>edit(w=>w.ch.forEach(c=>c.reverse())));
  E.on('sn-mono','click',()=>edit(w=>{const n=w.ch[0].length,m=new Float32Array(n);for(const c of w.ch)for(let i=0;i<n;i++)m[i]+=c[i]/w.ch.length;w.ch=[m]}));
  E.on('sn-loopfix','click',E.guard(loopfix));E.on('sn-trim','click',()=>edit(trim));E.on('sn-resample','click',E.guard(resample));E.on('sn-sr','click',E.guard(srToggle));
  E.on('sn-replace','click',()=>$('#sn-file').click());
  $('#sn-file').onchange=E.guard(async e=>{const f=e.target.files[0];e.target.value='';if(!f||!cur)return;const b=await AC.decodeAudioData(await f.arrayBuffer());push();setWork(fromBuf(b));E.setDirty('som',true)});
  E.on('sn-new','click',()=>$('#sn-newf').click());
  $('#sn-newf').onchange=E.guard(async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;const b=await AC.decodeAudioData(await f.arrayBuffer());
    const def=f.name.replace(/\.[^.]+$/,'').replace(/[^\w.-]+/g,'_')+'.wav',n=E.ask('Nome do arquivo em assets/sounds/:',def);if(!n)return;const p='assets/sounds/'+n;
    await E.api.save(p,wav(fromBuf(b)));
    if(sndJson&&!sndJson.files[n]){const j=await E.api.json('data/snd.json');j.files[n]={$file:p};await E.jsonSave('data/snd.json',j);sndJson=j}
    list();await open(p);E.toast('Som criado e registrado em snd.json → use em Configurações → Som')});
  E.on('sn-dl','click',()=>work&&E.download(cur.split('/').pop(),wav(work),'audio/wav'));
  E.on('sn-save','click',E.guard(async()=>{if(!work)return;await E.api.save(cur,wav(work));E.setDirty('som',false);E.toast('Som salvo: '+cur)}));
  E.on('sn-reload','click',E.guard(()=>open(cur)));
  $('#sn-vers').onfocus=E.guard(async()=>{if(!cur)return;const v=await E.api.backups(cur),s=$('#sn-vers');s.innerHTML='<option value="">Versões anteriores…</option>';v.forEach(t=>s.append(E.el('option',{value:t,text:t})))});
  E.on('sn-restore','click',E.guard(async()=>{const ts=$('#sn-vers').value;if(!ts||!cur)return;await E.api.restore(cur,ts);await open(cur);E.toast('Versão restaurada')}));
};
E.open_snd=p=>open(p);
function list(){const q=$('#sn-q').value.toLowerCase(),box=$('#sn-list');box.innerHTML='';
  E.tree.filter(f=>/\.(wav|mp3|ogg)$/i.test(f.p)&&(!q||f.p.toLowerCase().includes(q))).forEach(f=>{
    const d=E.el('div',{class:'it'+(f.p===cur?' on':'')},[E.el('span',{text:f.p.split('/').pop()}),E.el('small',{text:E.fmtKB(f.s)})]);d.onclick=E.guard(()=>open(f.p));box.append(d)})}
const fromBuf=b=>({sr:b.sampleRate,ch:[...Array(b.numberOfChannels).keys()].map(i=>b.getChannelData(i).slice())});
async function open(p){if(E.dirty.som&&cur!==p&&!confirm('Há alterações não salvas neste som. Descartar?'))return;stop();cur=p;undo=[];vw={a:0,b:1};
  const b=await AC.decodeAudioData(await E.api.bin(p));setWork(fromBuf(b));E.setDirty('som',false);$('#sn-title').textContent=p;list();
  const n=p.split('/').pop(),use=[];if(sndJson){const c=sndJson.cfg;c.on.forEach((x,i)=>x.f===n&&use.push('motor acelerando #'+i));c.off.forEach((x,i)=>x.f===n&&use.push('motor aliviando #'+i));
    for(const k in c.tire)if(c.tire[k].f===n)use.push('pneu '+k);for(const k in c.one)if(c.one[k]===n)use.push('efeito '+k)}
  $('#sn-use').textContent=use.length?'Usado no jogo como: '+use.join(', '):'Não usado em snd.json'}
function setWork(w){work=w;$('#sn-t0').value=0;$('#sn-t1').value=0;$('#sn-gain').value=100;$('#sn-gainv').textContent=100;info();wave()}
function info(){const n=work.ch[0].length;$('#sn-info').textContent=`${(n/work.sr).toFixed(3)} s · ${work.sr} Hz · ${work.ch.length} canal(is) · pico ${peak().toFixed(2)} · ${n} amostras`}
const peak=()=>{let m=0;for(const c of work.ch)for(let i=0;i<c.length;i++){const v=Math.abs(c[i]);if(v>m)m=v}return m};
function selRange(){if(!work)return null;const t0=Math.max(0,E.num($('#sn-t0'))),t1=E.num($('#sn-t1')),d=work.ch[0].length/work.sr;if(t0<=0&&t1<=0)return null;return[t0,t1>0?Math.min(d,t1):d]}
function wave(){const cv=$('#sn-cv'),c=cv.getContext('2d'),W=cv.width,H=cv.height,d=work.ch[0],n=d.length,s0=vw.a*n,s1=vw.b*n,step=(s1-s0)/W,dur=n/work.sr;
  c.fillStyle='#080a0d';c.fillRect(0,0,W,H);
  const sr=selRange();if(sr){const x0=(sr[0]*work.sr-s0)/step,x1=(sr[1]*work.sr-s0)/step;c.fillStyle='#ff7a2e2e';c.fillRect(x0,0,x1-x0,H);c.fillStyle='#ff7a2e';c.fillRect(x0,0,1,H);c.fillRect(x1-1,0,1,H)}
  /* régua de tempo */
  const span=(s1-s0)/work.sr,tick=E.niceNum(span/8);c.font='11px monospace';c.fillStyle='#586374';c.strokeStyle='#1c222a';c.lineWidth=1;
  for(let t=Math.ceil(s0/work.sr/tick)*tick;t<s1/work.sr;t+=tick){const x=(t*work.sr-s0)/step|0;c.beginPath();c.moveTo(x+.5,0);c.lineTo(x+.5,H);c.stroke();c.fillText(t.toFixed(tick<.01?3:tick<.1?2:tick<1?1:0)+'s',x+3,11)}
  c.strokeStyle='#2a323d';c.beginPath();c.moveTo(0,H/2);c.lineTo(W,H/2);c.stroke();c.strokeStyle='#ff7a2e';c.beginPath();
  if(step<1){/* muito aproximado: liga as amostras */for(let i=Math.floor(s0);i<=Math.ceil(s1)&&i<n;i++){const x=(i-s0)/step,y=H/2-d[i]*H/2;i===Math.floor(s0)?c.moveTo(x,y):c.lineTo(x,y)}}
  else for(let x=0;x<W;x++){let mn=1,mx=-1;const a=s0+x*step|0,b=Math.min(n,Math.max(a+1,s0+(x+1)*step|0));for(let i=a;i<b;i+=Math.max(1,(b-a)/48|0)){const v=d[i];if(v<mn)mn=v;if(v>mx)mx=v}c.moveTo(x,H/2-mx*H/2);c.lineTo(x,H/2-mn*H/2)}c.stroke();
  if(szb)szb.label(span>=1?span.toFixed(2)+' s':(span*1000).toFixed(0)+' ms')}
function zoomW(k,f){if(!work)return;const n=work.ch[0].length,span=vw.b-vw.a,min=Math.min(1,Math.max(64,n/5000)/n);f=f==null?.5:f;const pos=vw.a+span*f,ns=E.clamp(span*k,min,1);let a=pos-f*ns;a=E.clamp(a,0,1-ns);vw={a,b:a+ns};wave()}
function setupWave(){const cv=$('#sn-cv'),host=$('#sn-wrap');
  szb=E.zoomBar(host,{out:()=>zoomW(1.6),in:()=>zoomW(1/1.6),fit:()=>{vw={a:0,b:1};work&&wave()},reset:()=>{vw={a:0,b:1};work&&wave()},label:'—'});
  const fx=e=>{const r=cv.getBoundingClientRect();return E.clamp((e.clientX-r.left)/r.width,0,1)},tm=f=>(vw.a+(vw.b-vw.a)*f)*work.ch[0].length/work.sr;let drag=null;
  cv.addEventListener('wheel',e=>{e.preventDefault();if(!work)return;if(e.shiftKey){const sp=vw.b-vw.a,a=E.clamp(vw.a+Math.sign(e.deltaY)*sp*.15,0,1-sp);vw={a,b:a+sp};wave();return}
    const u=e.deltaMode===1?16:1;zoomW(Math.exp(Math.max(-300,Math.min(300,e.deltaY*u))*.0016),fx(e))},{passive:false});
  cv.oncontextmenu=e=>e.preventDefault();
  cv.onpointerdown=e=>{if(!work)return;cv.setPointerCapture(e.pointerId);const f=fx(e);drag=(e.shiftKey||e.button===1||e.button===2)?{k:'pan',x:e.clientX}:{k:'sel',f0:f,moved:false}};
  cv.onpointermove=e=>{if(!drag||!work)return;
    if(drag.k==='pan'){const r=cv.getBoundingClientRect(),sp=vw.b-vw.a,a=E.clamp(vw.a-(e.clientX-drag.x)/r.width*sp,0,1-sp);vw={a,b:a+sp};drag.x=e.clientX;wave();return}
    const f=fx(e);if(Math.abs(f-drag.f0)*cv.clientWidth<3&&!drag.moved)return;drag.moved=true;let a=tm(drag.f0),b=tm(f);if(a>b)[a,b]=[b,a];$('#sn-t0').value=a.toFixed(3);$('#sn-t1').value=b.toFixed(3);wave()};
  cv.onpointerup=cv.onpointercancel=()=>{drag=null};
  cv.ondblclick=()=>{$('#sn-t0').value=0;$('#sn-t1').value=0;work&&wave()};
  $('#sn-t0').addEventListener('input',()=>work&&wave());$('#sn-t1').addEventListener('input',()=>work&&wave());
  document.addEventListener('keydown',e=>{if(E.cur!=='snd'||e.ctrlKey||e.metaKey||e.altKey||/INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName))return;
    if(e.code==='Space'){e.preventDefault();src?stop():play()}else if(e.key==='+'||e.key==='=')zoomW(1/1.6);else if(e.key==='-'||e.key==='_')zoomW(1.6);else if(e.key==='0'||e.key==='f'||e.key==='F'){vw={a:0,b:1};work&&wave()}})}
function play(){if(!work)return;stop();AC.resume();const b=AC.createBuffer(work.ch.length,work.ch[0].length,work.sr);work.ch.forEach((c,i)=>b.copyToChannel(c,i));src=AC.createBufferSource();src.buffer=b;src.loop=$('#sn-loop').checked;src.connect(AC.destination);const sr=selRange();
  if(sr&&sr[1]-sr[0]>.01){src.loopStart=sr[0];src.loopEnd=sr[1];src.start(0,sr[0],src.loop?undefined:sr[1]-sr[0])}else src.start()}
function stop(){try{src&&src.stop()}catch(e){}src=null}
const clone=w=>({sr:w.sr,ch:w.ch.map(c=>c.slice())});
function push(){if(work){undo.push(clone(work));if(undo.length>15)undo.shift()}}
function doUndo(){const s=undo.pop();if(!s)return;setWork(s);E.setDirty('som',true)}
function edit(fn){if(!work)return;push();fn(work);setWork(work);E.setDirty('som',true)}
function apply(){if(!work)return;const g=+$('#sn-gain').value/100,t0=Math.max(0,E.num($('#sn-t0'))),t1=E.num($('#sn-t1')),n=work.ch[0].length,a=Math.min(n-1,t0*work.sr|0),b=t1>0?Math.min(n,t1*work.sr|0):n;
  if(b-a<64)return E.toast('Trecho muito curto',true);edit(w=>{w.ch=w.ch.map(c=>{const o=c.slice(a,b);for(let i=0;i<o.length;i++)o[i]=Math.max(-1,Math.min(1,o[i]*g));return o})})}
function norm(){if(!work)return;const p=peak();if(!p)return;const g=.95/p;$('#sn-gain').value=Math.round(g*100);$('#sn-gainv').textContent=Math.round(g*100)}
function fades(){const fi=E.num($('#sn-fi'))/1000*work.sr|0,fo=E.num($('#sn-fo'))/1000*work.sr|0;edit(w=>w.ch.forEach(c=>{const n=c.length;for(let i=0;i<Math.min(fi,n);i++)c[i]*=i/fi;for(let i=0;i<Math.min(fo,n);i++)c[n-1-i]*=i/fo}))}
function trim(w){const th=.01,n=w.ch[0].length;let a=0,b=n-1;const lvl=i=>Math.max(...w.ch.map(c=>Math.abs(c[i])));while(a<n&&lvl(a)<th)a++;while(b>a&&lvl(b)<th)b--;w.ch=w.ch.map(c=>c.slice(a,b+1))}
/* emenda o final no começo com crossfade: a cauda se mistura com o início e o arquivo encurta pelo tamanho do fade */
function loopfix(){const xf=Math.max(1,E.num($('#sn-xf'),120)/1000*work.sr|0);if(work.ch[0].length<xf*3)throw new Error('Som curto demais para esse fade');
  edit(w=>w.ch=w.ch.map(c=>{const n=c.length,o=new Float32Array(n-xf);o.set(c.subarray(0,n-xf));for(let i=0;i<xf;i++){const t=i/xf;o[i]=c[i]*t+c[n-xf+i]*(1-t)}return o}))}
function resample(){const r=E.num($('#sn-rate'),1);if(r<=0.1||r>8)throw new Error('Velocidade entre 0,1 e 8');
  edit(w=>w.ch=w.ch.map(c=>{const n=Math.floor(c.length/r),o=new Float32Array(n);for(let i=0;i<n;i++){const p=i*r,a=p|0,f=p-a;o[i]=c[a]*(1-f)+(c[Math.min(a+1,c.length-1)]*f)}return o}))}
function srToggle(){const to=work.sr>30000?22050:44100,r=to/work.sr;edit(w=>{w.ch=w.ch.map(c=>{const n=Math.floor(c.length*r),o=new Float32Array(n);for(let i=0;i<n;i++){const p=i/r,a=p|0,f=p-a;o[i]=c[a]*(1-f)+c[Math.min(a+1,c.length-1)]*f}return o});w.sr=to})}
function wav(w){const ch=w.ch.length,n=w.ch[0].length,buf=new ArrayBuffer(44+n*ch*2),dv=new DataView(buf),W=(o,s)=>[...s].forEach((c,i)=>dv.setUint8(o+i,c.charCodeAt(0)));
  W(0,'RIFF');dv.setUint32(4,36+n*ch*2,true);W(8,'WAVE');W(12,'fmt ');dv.setUint32(16,16,true);dv.setUint16(20,1,true);dv.setUint16(22,ch,true);dv.setUint32(24,w.sr,true);dv.setUint32(28,w.sr*ch*2,true);dv.setUint16(32,ch*2,true);dv.setUint16(34,16,true);W(36,'data');dv.setUint32(40,n*ch*2,true);
  let o=44;for(let i=0;i<n;i++)for(let c=0;c<ch;c++){const v=Math.max(-1,Math.min(1,w.ch[c][i]));dv.setInt16(o,v<0?v*32768:v*32767,true);o+=2}return buf}
})();
