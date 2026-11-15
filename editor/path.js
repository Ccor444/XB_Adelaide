/* Aba Traçado: edita EXT.ai (pontos [x,y,z,vmax,larguraEsq,larguraDir]) sobre o mapa da pista.
   v3: zoom suave no cursor + botões, pinça, grade/escala, camadas, multisseleção (Shift / caixa), duplo clique insere ponto,
   setas movem, refazer, cor por velocidade, imagem do mapa. */
(function(){
const $=E.$;let cv,ctx,ai=[],sel=-1,S=new Set(),bg=null,bb=null,view={cx:0,cz:0,s:1},undo=[],redo=[],asph=[],drag=null,CW=1,CH=1,DPR=1,hover=-1,mouse=null,zb=null,space=false,fitS=1,tw=null;
const SKIP=/tree|peple|lamp|pole|cone|trebg|olive|shado|jumbo|cwin|roof|bldng|tent|canv|truck|tral|crane|cran|logo|fence/;
const cls=n=>/^gras|green|lake|ptmarsh/.test(n)?1:/^grav/.test(n)?1:/rmbld|rumbl/.test(n)?3:/^road|^roa|side0/.test(n)?2:0;
const COL=['#262b33','#2c4a2f','#7b8088','#c8651f'];

const LAY=['bg','grid','w','edge','arr','num','spd'],DEF={bg:1,grid:1,w:1,edge:0,arr:1,num:0,spd:0};
const lay=k=>{const e=$('#pt-l-'+k);return e?e.checked:!!DEF[k]};
E.init_path=async function(){
  cv=$('#pt-cv');ctx=cv.getContext('2d');
  const ext=await E.api.json('data/ext.json');ai=ext.ai.map(a=>a.slice());E.pathExt=ext;
  new ResizeObserver(draw).observe(cv.parentElement);
  cv.onpointerdown=down;cv.onpointermove=move;cv.onpointerup=cv.onpointercancel=up;cv.oncontextmenu=e=>e.preventDefault();cv.ondblclick=dbl;
  cv.onpointerleave=()=>{mouse=null;hover=-1;$('#pt-pos').textContent='—';draw()};
  cv.addEventListener('wheel',e=>{e.preventDefault();if(tw){tw();tw=null}const u=e.deltaMode===1?16:1,r=cv.getBoundingClientRect();zoomAt(Math.exp(-Math.max(-300,Math.min(300,e.deltaY*u))*(e.ctrlKey?.008:.0017)),e.clientX-r.left,e.clientY-r.top)},{passive:false});
  zb=E.zoomBar($('#pt-wrap'),{out:()=>zoomBtn(1/1.5),in:()=>zoomBtn(1.5),fit:fit,reset:fit,label:'—',extra:[{t:'Largada',title:'Ir para a largada (ponto 0)',fn:()=>goTo(0)},{t:'Seleção',title:'Zoom na seleção  ( Z )',fn:zoomSel}]});
  E.on('pt-fit','click',fit);E.on('pt-ins','click',ins);E.on('pt-del','click',del);E.on('pt-start','click',setStart);E.on('pt-rev','click',rev);E.on('pt-y','click',E.guard(autoY));E.on('pt-undo','click',doUndo);E.on('pt-redo','click',doRedo);E.on('pt-save','click',E.guard(save));
  E.on('pt-png','click',()=>{draw();cv.toBlob(b=>E.download('mapa_tracado.png',b))});
  E.on('pt-all','click',()=>{S=new Set(ai.map((_,i)=>i));sel=0;fields();draw()});E.on('pt-none','click',()=>{S.clear();sel=-1;fields();draw()});
  for(const [id,k] of [['pt-x',0],['pt-yv',1],['pt-z',2],['pt-wl',4],['pt-wr',5],['pt-vm',3]])$('#'+id).onchange=()=>{if(sel<0)return;snap();const v=E.num($('#'+id),ai[sel][k]);
    if(k===0||k===2)ai[sel][k]=v;else for(const i of (S.size?S:[sel]))ai[i][k]=v;dirty();draw()};
  E.on('pt-wall','click',()=>{const v=E.ask('Largura (esquerda direita) para TODOS os pontos, ex.: 5 5:','5 5');if(!v)return;const[a,b]=v.split(/[ ,;]+/).map(Number);if(!isFinite(a)||!isFinite(b))return;snap();ai.forEach(p=>{p[4]=a;p[5]=b});fields();dirty();draw()});
  E.on('pt-smooth','click',()=>{snap();const N=ai.length,o=ai.map(p=>p.slice());for(let i=0;i<N;i++){const a=o[(i+N-1)%N],b=o[(i+1)%N];for(const k of[0,2])ai[i][k]=o[i][k]*.5+(a[k]+b[k])*.25}fields();dirty();draw()});
  $('#pt-coll').onchange=E.guard(async()=>{if($('#pt-coll').checked&&!bgc)await buildColl();draw()});
  for(const k of LAY){const e=$('#pt-l-'+k);const v=E.pref('pt.'+k);if(v!==undefined)e.checked=!!v;e.onchange=()=>{E.pref('pt.'+k,e.checked);draw()}}
  document.addEventListener('keydown',key);document.addEventListener('keyup',e=>{if(e.code==='Space'){space=false;cv.classList.remove('grab')}});
  await buildBg();fit();
};
E.show_path=()=>{if(cv){if(bb&&!view.ok)fit();draw()}};
let bgc=null;
async function buildColl(){const o=await E.phy.read(),sc=bb.sc;bgc=document.createElement('canvas');bgc.width=bg.width;bgc.height=bg.height;const c=bgc.getContext('2d'),COLS=['#6b7a99','#3fae4a','#d1a64f','#ff6a1f'];
  for(let s=0;s<4;s++){c.fillStyle=c.strokeStyle=COLS[s];c.beginPath();for(let t=0;t<o.f.length;t++){if(o.f[t]!==s)continue;for(let j=0;j<3;j++){const v=o.i[t*3+j]*3,x=(o.v[v]-bb.mnx)*sc+2,z=(o.v[v+2]-bb.mnz)*sc+2;j?c.lineTo(x,z):c.moveTo(x,z)}c.closePath()}c.fill();c.stroke()}}
async function buildBg(){
  $('#pt-load').textContent='Montando mapa da pista…';
  const t=await E.api.json('data/trk.json'),vb=new Float32Array(await E.api.bin(t.vb.$file)),ib=new Uint16Array(await E.api.bin(t.ib.$file)),S7=7;
  let mnx=1e30,mxx=-1e30,mnz=1e30,mxz=-1e30;const tris=[[],[],[],[]];
  for(const g of t.groups){const n=t.texnames[g.tex];if(g.cat==='shadow'||SKIP.test(n))continue;const c=cls(n);
    for(let k=g.off;k+2<g.off+g.cnt;k+=3){const a=ib[k]*S7,b=ib[k+1]*S7,d=ib[k+2]*S7;
      const ux=vb[b]-vb[a],uy=vb[b+1]-vb[a+1],uz=vb[b+2]-vb[a+2],vx=vb[d]-vb[a],vy=vb[d+1]-vb[a+1],vz=vb[d+2]-vb[a+2];
      const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,l=Math.hypot(nx,ny,nz)||1;if(Math.abs(ny)/l<.6)continue;
      const T=[vb[a],vb[a+2],vb[b],vb[b+2],vb[d],vb[d+2],(vb[a+1]+vb[b+1]+vb[d+1])/3];tris[c].push(T);if(c===2)asph.push(T);
      for(let i=0;i<6;i+=2){mnx=Math.min(mnx,T[i]);mxx=Math.max(mxx,T[i]);mnz=Math.min(mnz,T[i+1]);mxz=Math.max(mxz,T[i+1])}}}
  for(const p of ai){mnx=Math.min(mnx,p[0]);mxx=Math.max(mxx,p[0]);mnz=Math.min(mnz,p[2]);mxz=Math.max(mxz,p[2])}
  const W=mxx-mnx,H=mxz-mnz,sc=Math.min(3600/W,3600/H);bb={mnx,mnz,W,H,sc};
  bg=document.createElement('canvas');bg.width=Math.ceil(W*sc)+4;bg.height=Math.ceil(H*sc)+4;const c=bg.getContext('2d');
  for(let ci=0;ci<4;ci++){c.fillStyle=COL[ci];c.strokeStyle=COL[ci];c.lineWidth=1;c.beginPath();
    for(const T of tris[ci]){c.moveTo((T[0]-mnx)*sc+2,(T[1]-mnz)*sc+2);c.lineTo((T[2]-mnx)*sc+2,(T[3]-mnz)*sc+2);c.lineTo((T[4]-mnx)*sc+2,(T[5]-mnz)*sc+2);c.closePath()}c.fill();c.stroke()}
  $('#pt-load').textContent='';draw()}

/* ---------- câmera do mapa ---------- */
const toS=(x,z)=>[(x-view.cx)*view.s+CW/2,(z-view.cz)*view.s+CH/2];
const toW=(sx,sy)=>[(sx-CW/2)/view.s+view.cx,(sy-CH/2)/view.s+view.cz];
const sLim=()=>[fitS*.25,Math.max(80,fitS*400)];
function fit(){if(!bb)return;const par=cv.parentElement,w=par.clientWidth||800,h=par.clientHeight||600;fitS=Math.min(w/bb.W,h/bb.H)*.92;view={cx:bb.mnx+bb.W/2,cz:bb.mnz+bb.H/2,s:fitS,ok:!!par.clientWidth};draw()}
function zoomAt(k,sx,sy){const [mn,mx]=sLim(),ns=E.clamp(view.s*k,mn,mx);if(ns===view.s)return;const w=toW(sx,sy);view.s=ns;view.cx=w[0]-(sx-CW/2)/ns;view.cz=w[1]-(sy-CH/2)/ns;draw()}
function animTo(t){if(tw)tw();const f={cx:view.cx,cz:view.cz,s:view.s};tw=E.tween(f,t,220,v=>{view.cx=v.cx;view.cz=v.cz;view.s=v.s;draw()},()=>{tw=null})}
function zoomBtn(k){const [mn,mx]=sLim();animTo({cx:view.cx,cz:view.cz,s:E.clamp(view.s*k,mn,mx)})}
function goTo(i){if(i<0||i>=ai.length)return;animTo({cx:ai[i][0],cz:ai[i][2],s:Math.max(view.s,fitS*6)})}
function zoomSel(){const ids=[...S];if(!ids.length&&sel>=0)ids.push(sel);if(!ids.length)return E.toast('Selecione um ponto primeiro',true);
  let a=1e30,b=-1e30,c=1e30,d=-1e30;for(const i of ids){a=Math.min(a,ai[i][0]);b=Math.max(b,ai[i][0]);c=Math.min(c,ai[i][2]);d=Math.max(d,ai[i][2])}
  const [mn,mx]=sLim(),w=Math.max(b-a,20),h=Math.max(d-c,20);animTo({cx:(a+b)/2,cz:(c+d)/2,s:E.clamp(Math.min(CW/w,CH/h)*.6,mn,mx)})}
function spline(i,t){const N=ai.length,P=k=>ai[((i+k)%N+N)%N],t2=t*t,t3=t2*t;return[0,2].map(a=>.5*((2*P(0)[a])+(-P(-1)[a]+P(1)[a])*t+(2*P(-1)[a]-5*P(0)[a]+4*P(1)[a]-P(2)[a])*t2+(-P(-1)[a]+3*P(0)[a]-3*P(1)[a]+P(2)[a])*t3))}

/* cor pela velocidade: lento = vermelho, rápido = verde, livre (>=900) = ciano */
function spdCol(v,lo,hi){if(v>=900)return'#35d0e8';const t=hi>lo?E.clamp((v-lo)/(hi-lo),0,1):.5;return`hsl(${t*120},85%,55%)`}
function grid(){const raw=110/view.s,st=E.niceNum(raw),a=toW(0,0),b=toW(CW,CH);
  ctx.lineWidth=1;ctx.font='10px monospace';ctx.fillStyle='#5d6b7c';
  for(let x=Math.ceil(a[0]/st)*st;x<b[0];x+=st){const sx=Math.round(toS(x,0)[0])+.5;ctx.strokeStyle=Math.abs(x%(st*5))<st*.01?'#2c3643':'#1b222b';ctx.beginPath();ctx.moveTo(sx,0);ctx.lineTo(sx,CH);ctx.stroke();ctx.fillText(+x.toFixed(2),sx+3,CH-4)}
  for(let z=Math.ceil(a[1]/st)*st;z<b[1];z+=st){const sy=Math.round(toS(0,z)[1])+.5;ctx.strokeStyle=Math.abs(z%(st*5))<st*.01?'#2c3643':'#1b222b';ctx.beginPath();ctx.moveTo(0,sy);ctx.lineTo(CW,sy);ctx.stroke();ctx.fillText(+z.toFixed(2),4,sy-3)}}
function scaleBar(){const m=E.niceNum(120/view.s),px=m*view.s,x=16,y=CH-26;ctx.strokeStyle='#e8edf3';ctx.fillStyle='#e8edf3';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,y-5);ctx.lineTo(x,y);ctx.lineTo(x+px,y);ctx.lineTo(x+px,y-5);ctx.stroke();ctx.font='11px monospace';ctx.fillText(m>=1000?m/1000+' km':m+' m',x+4,y-8)}
function draw(){const par=cv.parentElement;const w=par.clientWidth,h=par.clientHeight;if(!w||!h||!ctx)return;
  DPR=Math.min(3,window.devicePixelRatio||1);if(cv.width!==Math.round(w*DPR)||cv.height!==Math.round(h*DPR)){cv.width=Math.round(w*DPR);cv.height=Math.round(h*DPR);cv.style.width=w+'px';cv.style.height=h+'px'}
  CW=w;CH=h;ctx.setTransform(DPR,0,0,DPR,0,0);
  ctx.fillStyle='#0a0c0f';ctx.fillRect(0,0,w,h);
  if(bg&&lay('bg')){const k=view.s/bb.sc,o=toS(bb.mnx-2/bb.sc,bb.mnz-2/bb.sc);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(bg,o[0],o[1],bg.width*k,bg.height*k)}
  if(bgc&&$('#pt-coll').checked){const k=view.s/bb.sc,o=toS(bb.mnx-2/bb.sc,bb.mnz-2/bb.sc);ctx.globalAlpha=.6;ctx.drawImage(bgc,o[0],o[1],bgc.width*k,bgc.height*k);ctx.globalAlpha=1}
  if(lay('grid')){grid()}
  if(zb)zb.label(E.pct(view.s/fitS));
  if(!ai.length)return;const N=ai.length;
  /* larguras */
  const P=[],Lf=[],Rt=[];
  for(let i=0;i<N;i++){const p=ai[i],q=ai[(i+1)%N];let tx=q[0]-p[0],tz=q[2]-p[2];const l=Math.hypot(tx,tz)||1;tx/=l;tz/=l;
    const a=toS(p[0]+tz*p[4],p[2]-tx*p[4]),b=toS(p[0]-tz*p[5],p[2]+tx*p[5]),m=toS(p[0],p[2]);P.push(m);Lf.push(a);Rt.push(b);
    if(lay('w')){ctx.lineWidth=1;ctx.strokeStyle='#4aa3ff99';ctx.beginPath();ctx.moveTo(m[0],m[1]);ctx.lineTo(a[0],a[1]);ctx.stroke();ctx.strokeStyle='#ff5a4d99';ctx.beginPath();ctx.moveTo(m[0],m[1]);ctx.lineTo(b[0],b[1]);ctx.stroke()}}
  if(lay('edge')){for(const [A,c] of [[Lf,'#4aa3ff'],[Rt,'#ff5a4d']]){ctx.strokeStyle=c;ctx.lineWidth=1.5;ctx.beginPath();A.forEach((s,i)=>i?ctx.lineTo(s[0],s[1]):ctx.moveTo(s[0],s[1]));ctx.closePath();ctx.stroke()}}
  /* linha de corrida */
  const spd=lay('spd');let lo=1e9,hi=-1e9;if(spd)for(const p of ai)if(p[3]<900){lo=Math.min(lo,p[3]);hi=Math.max(hi,p[3])}
  ctx.lineWidth=2.5;ctx.lineJoin='round';
  if(spd){for(let i=0;i<N;i++){ctx.strokeStyle=spdCol(ai[i][3],lo,hi);ctx.beginPath();for(let s=0;s<=8;s++){const p=spline(i,s/8),sp=toS(p[0],p[1]);s?ctx.lineTo(sp[0],sp[1]):ctx.moveTo(sp[0],sp[1])}ctx.stroke()}}
  else{ctx.strokeStyle='#ffd24a';ctx.beginPath();for(let i=0;i<N;i++)for(let s=0;s<8;s++){const p=spline(i,s/8),sp=toS(p[0],p[1]);if(!i&&!s)ctx.moveTo(sp[0],sp[1]);else ctx.lineTo(sp[0],sp[1])}ctx.closePath();ctx.stroke()}
  /* setas de sentido */
  if(lay('arr')){let lx=-1e9,ly=-1e9;ctx.fillStyle='#000c';ctx.strokeStyle='#fff';ctx.lineWidth=1;
    for(let i=0;i<N;i++){const a=P[i],b=P[(i+1)%N];if(Math.hypot(a[0]-lx,a[1]-ly)<46)continue;const mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2,ang=Math.atan2(b[1]-a[1],b[0]-a[0]);lx=a[0];ly=a[1];
      ctx.save();ctx.translate(mx,my);ctx.rotate(ang);ctx.beginPath();ctx.moveTo(6,0);ctx.lineTo(-4,-4);ctx.lineTo(-4,4);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore()}}
  /* linha de largada */
  {const a=Lf[0],b=Rt[0];ctx.strokeStyle='#6fd08c';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke()}
  /* pontos */
  const nums=lay('num');ctx.font='11px monospace';let nx=-1e9,ny=-1e9;
  for(let i=0;i<N;i++){const s=P[i],on=S.has(i)||i===sel,hv=i===hover;if(s[0]<-20||s[1]<-20||s[0]>CW+20||s[1]>CH+20)continue;
    ctx.beginPath();ctx.arc(s[0],s[1],on?7:hv?6:4,0,7);ctx.fillStyle=on?'#ff7a2e':i===0?'#6fd08c':hv?'#ffe9a8':'#fff';ctx.fill();ctx.strokeStyle='#000';ctx.lineWidth=1;ctx.stroke();
    const room=nums&&Math.hypot(s[0]-nx,s[1]-ny)>34;if(room){nx=s[0];ny=s[1]}if(on||hv||room){ctx.fillStyle='#fff';ctx.strokeStyle='#000';ctx.lineWidth=3;const tx='#'+i+(hv&&!on?'  v='+ai[i][3]:'');ctx.strokeText(tx,s[0]+10,s[1]-8);ctx.fillText(tx,s[0]+10,s[1]-8)}}
  /* caixa de seleção */
  if(drag&&drag.k==='box'){const x=Math.min(drag.x0,drag.x1),y=Math.min(drag.y0,drag.y1),w2=Math.abs(drag.x1-drag.x0),h2=Math.abs(drag.y1-drag.y0);ctx.fillStyle='#ff7a2e22';ctx.strokeStyle='#ff7a2e';ctx.lineWidth=1;ctx.fillRect(x,y,w2,h2);ctx.strokeRect(x+.5,y+.5,w2,h2)}
  if(lay('grid'))scaleBar();
  let L=0;for(let i=0;i<N;i++){const p=ai[i],q=ai[(i+1)%N];L+=Math.hypot(q[0]-p[0],q[2]-p[2])}$('#pt-stat').textContent=N+' pontos · volta ≈ '+L.toFixed(0)+' m';
  $('#pt-selinfo').textContent=S.size>1?S.size+' pontos selecionados':'';
}

/* ---------- interação ---------- */
function pick(sx,sy,r=11){let best=-1,bd=r*r;ai.forEach((p,i)=>{const s=toS(p[0],p[2]),d=(s[0]-sx)**2+(s[1]-sy)**2;if(d<bd){bd=d;best=i}});return best}
const rel=e=>{const r=cv.getBoundingClientRect();return[e.clientX-r.left,e.clientY-r.top]};
const ptrs=new Map();let pinch=null;
function nearSeg(sx,sy){let best=null,bd=1e30;const N=ai.length;for(let i=0;i<N;i++)for(let s=0;s<8;s++){const t=s/8,a=spline(i,t),b=spline(i,(s+1)/8),A=toS(a[0],a[1]),B=toS(b[0],b[1]);
  const dx=B[0]-A[0],dy=B[1]-A[1],l2=dx*dx+dy*dy||1,u=E.clamp(((sx-A[0])*dx+(sy-A[1])*dy)/l2,0,1),px=A[0]+dx*u,py=A[1]+dy*u,d=(sx-px)**2+(sy-py)**2;if(d<bd){bd=d;best={i,t:t+u/8,d:Math.sqrt(d)}}}return best}
function down(e){cv.setPointerCapture(e.pointerId);const [sx,sy]=rel(e);ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(ptrs.size===2){const a=[...ptrs.values()];pinch={d:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)||1,mx:(a[0].x+a[1].x)/2,my:(a[0].y+a[1].y)/2};drag=null;return}
  if(tw){tw();tw=null}
  const panBtn=e.button===1||e.button===2||space;if(panBtn){drag={k:'pan',x:e.clientX,y:e.clientY};cv.classList.add('grabbing');return}
  const i=pick(sx,sy,e.pointerType==='touch'?20:11);
  if(i>=0){if(e.shiftKey||e.ctrlKey||e.metaKey){if(S.has(i)){S.delete(i);sel=S.size?[...S].pop():-1}else{S.add(i);sel=i}fields();draw();drag={k:'none'};return}
    if(!S.has(i)){S=new Set([i])}sel=i;fields();snap();drag={k:'pt',i,moved:false,w0:toW(sx,sy),orig:[...S].map(j=>[j,ai[j][0],ai[j][2]])};draw()}
  else if(e.shiftKey){drag={k:'box',x0:sx,y0:sy,x1:sx,y1:sy,add:e.ctrlKey||e.metaKey}}
  else drag={k:'pan',x:e.clientX,y:e.clientY,x0:e.clientX,y0:e.clientY,moved:false,bg:true}}
function move(e){const [sx,sy]=rel(e);const p=ptrs.get(e.pointerId);if(p){p.x=e.clientX;p.y=e.clientY}
  mouse=[sx,sy];const w=toW(sx,sy);
  if(pinch&&ptrs.size>=2){const a=[...ptrs.values()],n={d:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)||1,mx:(a[0].x+a[1].x)/2,my:(a[0].y+a[1].y)/2},r=cv.getBoundingClientRect();
    view.cx-=(n.mx-pinch.mx)/view.s;view.cz-=(n.my-pinch.my)/view.s;zoomAt(n.d/pinch.d,n.mx-r.left,n.my-r.top);pinch=n;return}
  if(!drag){const h=pick(sx,sy);if(h!==hover){hover=h;cv.classList.toggle('hov',h>=0);draw()}
    $('#pt-pos').textContent='X '+w[0].toFixed(1)+'   Z '+w[1].toFixed(1)+(h>=0?'   ·   ponto #'+h+'  vel '+ai[h][3]+'  larg '+ai[h][4].toFixed(1)+' / '+ai[h][5].toFixed(1)+'  alt '+ai[h][1].toFixed(1):'');return}
  $('#pt-pos').textContent='X '+w[0].toFixed(1)+'   Z '+w[1].toFixed(1);
  if(drag.k==='pt'){const dx=w[0]-drag.w0[0],dz=w[1]-drag.w0[1];for(const [j,x,z] of drag.orig){ai[j][0]=x+dx;ai[j][2]=z+dz}drag.moved=true;fields();dirty();draw()}
  else if(drag.k==='pan'){view.cx-=(e.clientX-drag.x)/view.s;view.cz-=(e.clientY-drag.y)/view.s;if(drag.bg&&Math.abs(e.clientX-drag.x0)+Math.abs(e.clientY-drag.y0)>3)drag.moved=true;drag.x=e.clientX;drag.y=e.clientY;draw()}
  else if(drag.k==='box'){drag.x1=sx;drag.y1=sy;draw()}}
function up(e){ptrs.delete(e.pointerId);cv.classList.remove('grabbing');if(pinch){if(ptrs.size<2)pinch=null;drag=null;return}
  if(drag){
    if(drag.k==='pt'&&!drag.moved)undo.pop();
    else if(drag.k==='box'){const x0=Math.min(drag.x0,drag.x1),x1=Math.max(drag.x0,drag.x1),y0=Math.min(drag.y0,drag.y1),y1=Math.max(drag.y0,drag.y1);if(!drag.add)S=new Set();
      ai.forEach((p,i)=>{const s=toS(p[0],p[2]);if(s[0]>=x0&&s[0]<=x1&&s[1]>=y0&&s[1]<=y1)S.add(i)});sel=S.size?[...S].pop():-1;fields()}
    else if(drag.k==='pan'&&drag.bg&&!drag.moved&&e.type==='pointerup'){S.clear();sel=-1;fields()}}
  drag=null;draw()}
/* duplo clique: na linha insere ponto; no fundo aproxima */
function dbl(e){const [sx,sy]=rel(e);if(pick(sx,sy)>=0)return;const n=nearSeg(sx,sy);
  if(n&&n.d<14){snap();const a=ai[n.i],b=ai[(n.i+1)%ai.length],p=spline(n.i,n.t),t=n.t,L=k=>a[k]+(b[k]-a[k])*t;ai.splice(n.i+1,0,[p[0],L(1),p[1],a[3],L(4),L(5)]);S=new Set([n.i+1]);sel=n.i+1;fields();dirty();draw();return}
  zoomAt(2,sx,sy)}
function key(e){if(E.cur!=='path'||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||e.altKey&&!e.key.startsWith('Arrow'))return;const k=e.key,ctrl=e.ctrlKey||e.metaKey;
  if(e.code==='Space'){space=true;cv.classList.add('grab');e.preventDefault();return}
  if(ctrl&&k.toLowerCase()==='z'){e.preventDefault();e.shiftKey?doRedo():doUndo()}
  else if(ctrl&&k.toLowerCase()==='y'){e.preventDefault();doRedo()}
  else if(ctrl&&k.toLowerCase()==='a'){e.preventDefault();$('#pt-all').click()}
  else if(ctrl)return;
  else if(k==='Delete'||k==='Backspace'){e.preventDefault();del()}
  else if(k==='Escape'){S.clear();sel=-1;fields();draw()}
  else if(k==='+'||k==='='){zoomBtn(1.4)}else if(k==='-'||k==='_'){zoomBtn(1/1.4)}
  else if(k==='f'||k==='F'||k==='0'||k==='Home'){fit()}
  else if(k==='z'||k==='Z'){zoomSel()}
  else if(k==='g'||k==='G'){const g=$('#pt-l-grid');g.checked=!g.checked;g.onchange()}
  else if(k==='i'||k==='I'){ins()}
  else if(k==='['||k==='ArrowLeft'&&e.altKey||(k==='Tab'&&e.shiftKey)){e.preventDefault();step(-1)}
  else if(k===']'||k==='Tab'){e.preventDefault();step(1)}
  else if(k.startsWith('Arrow')&&S.size){e.preventDefault();const m=e.shiftKey?5:e.altKey?.05:.5,dx=k==='ArrowLeft'?-m:k==='ArrowRight'?m:0,dz=k==='ArrowUp'?-m:k==='ArrowDown'?m:0;snap(true);for(const i of S){ai[i][0]+=dx;ai[i][2]+=dz}fields();dirty();draw()}}
function step(d){if(!ai.length)return;const n=((sel<0?(d>0?-1:0):sel)+d+ai.length)%ai.length;S=new Set([n]);sel=n;fields();const s=toS(ai[n][0],ai[n][2]);if(s[0]<40||s[1]<40||s[0]>CW-40||s[1]>CH-40)animTo({cx:ai[n][0],cz:ai[n][2],s:view.s});draw()}
function fields(){const m=S.size>1;$('#pt-multi').hidden=!m;
  if(sel<0){$('#pt-n').textContent='—';return}const p=ai[sel];$('#pt-n').textContent='#'+sel+(sel===0?' (largada)':'')+(m?' +'+(S.size-1):'');
  $('#pt-x').value=p[0].toFixed(2);$('#pt-yv').value=p[1].toFixed(2);$('#pt-z').value=p[2].toFixed(2);$('#pt-wl').value=p[4].toFixed(2);$('#pt-wr').value=p[5].toFixed(2);$('#pt-vm').value=p[3].toFixed(1)}
let lastSnap=0;
const snap=(merge)=>{const t=Date.now();if(merge&&t-lastSnap<600){lastSnap=t;return}lastSnap=t;undo.push(JSON.stringify(ai));if(undo.length>100)undo.shift();redo=[]};
const restore=s=>{ai=JSON.parse(s);S=new Set([...S].filter(i=>i<ai.length));sel=Math.min(sel,ai.length-1);if(sel>=0&&!S.size)S.add(sel);fields();dirty();draw()};
function doUndo(){const s=undo.pop();if(!s)return E.toast('Nada para desfazer');redo.push(JSON.stringify(ai));restore(s)}
function doRedo(){const s=redo.pop();if(!s)return E.toast('Nada para refazer');undo.push(JSON.stringify(ai));restore(s)}
const dirty=()=>E.setDirty('traçado',true);
function ins(){if(sel<0)return E.toast('Selecione um ponto',true);snap();const a=ai[sel],b=ai[(sel+1)%ai.length],p=spline(sel,.5);ai.splice(sel+1,0,[p[0],(a[1]+b[1])/2,p[1],a[3],(a[4]+b[4])/2,(a[5]+b[5])/2]);S=new Set([sel+1]);sel=sel+1;fields();dirty();draw()}
function del(){const ids=S.size?[...S]:sel>=0?[sel]:[];if(!ids.length)return;if(ai.length-ids.length<8)return E.toast('Mantenha pelo menos 8 pontos',true);snap();const set=new Set(ids);ai=ai.filter((_,i)=>!set.has(i));S.clear();sel=Math.min(Math.min(...ids),ai.length-1);S=new Set([sel]);fields();dirty();draw()}
function setStart(){if(sel<=0)return;snap();ai=ai.slice(sel).concat(ai.slice(0,sel));S=new Set([0]);sel=0;fields();dirty();draw()}
function rev(){if(!confirm('Inverter o sentido de corrida? A IA passa a correr ao contrário.'))return;snap();ai.reverse();ai.forEach(p=>{const t=p[4];p[4]=p[5];p[5]=t});sel=-1;S.clear();fields();draw();dirty()}
function autoY(){if(!asph.length)throw new Error('Mapa ainda carregando');snap();let n=0;
  for(const p of ai){let best=null;for(const T of asph){const d=(T[3]-T[5])*(T[0]-T[4])+(T[4]-T[2])*(T[1]-T[5]);if(Math.abs(d)<1e-9)continue;
      const l1=((T[3]-T[5])*(p[0]-T[4])+(T[4]-T[2])*(p[2]-T[5]))/d,l2=((T[5]-T[1])*(p[0]-T[4])+(T[0]-T[4])*(p[2]-T[5]))/d;if(l1>=0&&l2>=0&&l1+l2<=1){if(best===null||Math.abs(T[6]-p[1])<Math.abs(best-p[1]))best=T[6]}}
    if(best!==null){p[1]=best;n++}}
  fields();dirty();E.toast('Altura ajustada em '+n+' de '+ai.length+' pontos')}
async function save(){const fresh=await E.api.json('data/ext.json');fresh.ai=ai;await E.jsonSave('data/ext.json',fresh);E.setDirty('traçado',false);E.toast('Traçado salvo ('+ai.length+' pontos) — recarregue o jogo')}
})();
