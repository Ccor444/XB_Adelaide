/* Aba Texturas: pintura, formas, carimbo, filtros, redimensionar, DDS (leitura), mosaico, salvar no formato original. */
(function(){
const $=E.$;let space=false,panning=null,needFit=false,zb=null,cv,ctx,cur=null,undo=[],redo=[],tool='brush',zoom=1,drawing=false,last=null,trk=null,trkNames={},snapImg=null,startPt=null,cloneSrc=null,cloneOff=null,cloneSnap=null,listObs=null;
const CATS=[['all','Todas'],['track','Pista'],['car','Carros'],['ui','HUD'],['trophy','Troféu'],['other','Céu / outros']];
const IMG=/\.(webp|jpe?g|png|dds)$/i;
function catOf(p){if(p.startsWith('assets/track/textures/'))return'track';if(p.startsWith('cars/'))return'car';if(p.startsWith('assets/ui/'))return'ui';if(p.startsWith('assets/trophy/'))return'trophy';return'other'}
const hex2rgb=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
const isJpg=()=>cur&&cur.mime==='image/jpeg';
E.init_tex=async function(){
  cv=$('#tx-cv');ctx=cv.getContext('2d',{willReadFrequently:true});
  try{trk=await E.api.json('data/trk.json');trk.tex.forEach((t,i)=>{if(t.d&&t.d.$file)trkNames[t.d.$file]={name:t.name,i}})}catch(e){trk=null}
  E.fillSelect($('#tx-cat'),CATS,'all');
  $('#tx-q').oninput=$('#tx-cat').onchange=E.debounce(list,100);list();
  $('#tx-tool').onclick=e=>{const b=e.target.closest('button');if(!b)return;tool=b.dataset.k;E.$$('#tx-tool button').forEach(x=>x.classList.toggle('on',x===b))};
  $('#tx-size').oninput=()=>$('#tx-sizev').textContent=$('#tx-size').value;$('#tx-hard').oninput=()=>$('#tx-hardv').textContent=$('#tx-hard').value;
  $('#tx-zoom').oninput=()=>setZoomAt(2**(+$('#tx-zoom').value));
  zb=E.zoomBar($('#tx-center'),{cls:'up',out:()=>setZoomAt(zoom/1.25),in:()=>setZoomAt(zoom*1.25),fit:fit,reset:()=>setZoomAt(1),label:'100%'});
  const wrap=$('#tx-wrap');wrap.addEventListener('contextmenu',e=>e.preventDefault());
  E.on('tx-fit','click',fit);E.on('tx-z1','click',()=>setZoom(1));E.on('tx-undo','click',doUndo);E.on('tx-redo','click',doRedo);
  $('#tx-chan').onchange=()=>{$('#tx-wrap').classList.toggle('alphaview',$('#tx-chan').checked);cv.style.filter=''};
  for(const id of['br','co','sa','hu'])$('#tx-'+id).oninput=preview;
  E.on('tx-reset','click',()=>{for(const[id,v]of[['br',100],['co',100],['sa',100],['hu',0]])$('#tx-'+id).value=v;preview()});
  E.on('tx-apply','click',applyAdj);
  E.on('tx-fh','click',()=>xform('fh'));E.on('tx-fv','click',()=>xform('fv'));E.on('tx-rot','click',()=>xform('rot'));
  E.on('tx-inv','click',()=>pix(d=>{for(let i=0;i<d.length;i+=4){d[i]=255-d[i];d[i+1]=255-d[i+1];d[i+2]=255-d[i+2]}}));
  E.on('tx-gray','click',()=>pix(d=>{for(let i=0;i<d.length;i+=4){const g=.299*d[i]+.587*d[i+1]+.114*d[i+2];d[i]=d[i+1]=d[i+2]=g}}));
  E.on('tx-blur','click',()=>conv([1,2,1,2,4,2,1,2,1],16));E.on('tx-sharp','click',()=>conv([0,-1,0,-1,5,-1,0,-1,0],1));
  E.on('tx-offs','click',E.guard(offset));E.on('tx-keyout','click',keyout);
  E.on('tx-resize','click',E.guard(resize));
  $('#tx-rw').oninput=()=>{if($('#tx-lock').checked&&cur&&E.num($('#tx-rw')))$('#tx-rh').value=Math.round(E.num($('#tx-rw'))*cv.height/cv.width)};
  $('#tx-rh').oninput=()=>{if($('#tx-lock').checked&&cur&&E.num($('#tx-rh')))$('#tx-rw').value=Math.round(E.num($('#tx-rh'))*cv.width/cv.height)};
  E.on('tx-replace','click',()=>$('#tx-file').click());
  $('#tx-file').onchange=E.guard(async e=>{const f=e.target.files[0];e.target.value='';if(!f||!cur)return;const bm=await createImageBitmap(f);push();
    if($('#tx-newsize').checked){cv.width=bm.width;cv.height=bm.height}
    ctx.clearRect(0,0,cv.width,cv.height);ctx.drawImage(bm,0,0,cv.width,cv.height);dirty();fit();tile()});
  E.on('tx-export','click',E.guard(async()=>{const b=await blob();E.download(cur.path.split('/').pop().replace(/\.dds$/i,'.png'),b)}));
  E.on('tx-save','click',E.guard(save));E.on('tx-saveas','click',E.guard(saveAs));E.on('tx-reload','click',E.guard(()=>open(cur.path,true)));
  $('#tx-vers').onfocus=E.guard(loadVers);
  E.on('tx-restore','click',E.guard(async()=>{const ts=$('#tx-vers').value;if(!ts||!cur)return;await E.api.restore(cur.path,ts);await open(cur.path,true);E.toast('Versão restaurada')}));
  cv.onpointerdown=E.guard(down);cv.onpointermove=move;cv.onpointerup=cv.onpointercancel=up;
  $('#tx-wrap').addEventListener('wheel',e=>{e.preventDefault();const u=e.deltaMode===1?16:1;setZoomAt(zoom*Math.exp(-Math.max(-300,Math.min(300,e.deltaY*u))*(e.ctrlKey?.008:.0018)),e.clientX,e.clientY)},{passive:false});
  document.addEventListener('keydown',e=>{if(e.code==='Space'&&E.cur==='tex'&&!/INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName)){space=true;wrap.classList.add('pan');e.preventDefault()}});
  document.addEventListener('keyup',e=>{if(e.code==='Space'){space=false;wrap.classList.remove('pan')}});
  document.addEventListener('keydown',e=>{if(E.cur!=='tex'||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;
    if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();e.shiftKey?doRedo():doUndo()}else if((e.ctrlKey||e.metaKey)&&e.key==='y'){e.preventDefault();doRedo()}
    else if(!e.ctrlKey&&!e.metaKey&&(e.key==='+'||e.key==='='))setZoomAt(zoom*1.25);else if(!e.ctrlKey&&!e.metaKey&&(e.key==='-'||e.key==='_'))setZoomAt(zoom/1.25);else if(e.key==='0')fit();else if(e.key==='1')setZoomAt(1);
    else if(e.key==='['){$('#tx-size').value=Math.max(1,+$('#tx-size').value*.8|0);$('#tx-size').oninput()}else if(e.key===']'){$('#tx-size').value=Math.min(300,Math.ceil(+$('#tx-size').value*1.25));$('#tx-size').oninput()}});
  E.sub('open',()=>{});
};
E.open_tex=async p=>{$('#tx-q').value='';$('#tx-cat').value='all';list();await open(p);const t=E.$$('#tx-list .th').find(x=>x.title===p);if(t)t.scrollIntoView({block:'center'})};

function list(){
  const q=$('#tx-q').value.toLowerCase(),c=$('#tx-cat').value,box=$('#tx-list');box.innerHTML='';if(listObs)listObs.disconnect();
  listObs=new IntersectionObserver(es=>{for(const en of es)if(en.isIntersecting){const im=en.target;listObs.unobserve(im);E.api.blobUrl(im.dataset.p).then(u=>{im.src=u}).catch(()=>{im.alt='!'})}},{root:box.parentElement,rootMargin:'200px'});
  const items=E.tree.filter(f=>IMG.test(f.p)&&(c==='all'||catOf(f.p)===c)).map(f=>({p:f.p,n:(trkNames[f.p]&&trkNames[f.p].name)||f.p.split('/').slice(-2).join('/')}))
    .filter(x=>!q||x.n.toLowerCase().includes(q)||x.p.toLowerCase().includes(q));
  for(const it of items){const im=E.el('img',{'data-p':it.p,alt:''});const d=E.el('div',{class:'th'+(cur&&cur.path===it.p?' on':''),title:it.p},[im,E.el('span',{text:it.n})]);d.onclick=E.guard(()=>open(it.p));box.append(d);listObs.observe(im)}
}
async function decode(path){
  const u8=await E.api.u8(path);
  if(/\.dds$/i.test(path)){const c=E.dds.toCanvas(u8);return{src:c,w:c.width,h:c.height,mime:'image/png',dds:true}}
  const bm=await createImageBitmap(new Blob([u8],{type:E.mime(path)}));return{src:bm,w:bm.width,h:bm.height,mime:E.mime(path)}}
async function open(path,force){
  if(!force&&E.dirty.textura&&cur&&cur.path!==path&&!confirm('Há alterações não salvas nesta textura. Descartar?'))return;
  const im=await decode(path);
  cv.width=im.w;cv.height=im.h;ctx.clearRect(0,0,cv.width,cv.height);ctx.drawImage(im.src,0,0);
  const info=trkNames[path];cur={path,name:info?info.name:path.split('/').pop(),mime:im.mime,w:im.w,h:im.h,idx:info?info.i:-1,dds:!!im.dds};
  undo=[];redo=[];cloneSrc=null;E.setDirty('textura',false);$('#tx-title').textContent=cur.name+' · '+im.w+'×'+im.h+' · '+path;
  $('#tx-vers').innerHTML='<option value="">Versões anteriores…</option>';$('#tx-rw').value=im.w;$('#tx-rh').value=im.h;
  $('#tx-note').textContent=cur.dds?'DDS é só leitura: use “Salvar como PNG novo…”':cur.mime==='image/jpeg'?'JPEG: sem transparência':cur.mime==='image/webp'?'WebP: salva em WebP (qualidade abaixo)':'';
  let used='';if(cur.idx>=0&&trk){const g=trk.groups.filter(x=>x.tex===cur.idx);used='Textura #'+cur.idx+' da pista · usada em '+g.length+' grupo(s) ('+[...new Set(g.map(x=>x.cat))].join('/')+')'}
  $('#tx-used').textContent=used;
  $('#tx-wrap').dataset.alpha=cur.mime==='image/jpeg'?'0':'1';cv.style.filter='';fit();tile();E.$$('#tx-list .th').forEach(t=>t.classList.toggle('on',t.title===path));
}
function pt(e){const r=cv.getBoundingClientRect();return[(e.clientX-r.left)*cv.width/r.width,(e.clientY-r.top)*cv.height/r.height]}
let sCache=null;
function getStamp(size,hard,color){const key=size+'|'+hard+'|'+color;if(sCache&&sCache.key===key)return sCache.c;
  const s=Math.max(1,Math.round(size)),c=document.createElement('canvas');c.width=c.height=s;const g=c.getContext('2d'),r=s/2,rgb=hex2rgb(color).join(',');
  const gr=g.createRadialGradient(r,r,0,r,r,r),h=hard/100;gr.addColorStop(0,`rgba(${rgb},1)`);gr.addColorStop(Math.min(.999,h),`rgba(${rgb},1)`);gr.addColorStop(1,`rgba(${rgb},0)`);
  g.fillStyle=gr;g.beginPath();g.arc(r,r,r,0,7);g.fill();sCache={key,c};return c}
function tiles(x,y,r,fn){fn(x,y);if(!$('#tx-seam').checked)return;const W=cv.width,H=cv.height;for(const dx of[-W,0,W])for(const dy of[-H,0,H])if(dx||dy){if(x+dx>-r&&x+dx<W+r&&y+dy>-r&&y+dy<H+r)fn(x+dx,y+dy)}}
function dab(a,b){const s=+$('#tx-size').value,op=+$('#tx-op').value/100,step=Math.max(1,s/5),dx=b[0]-a[0],dy=b[1]-a[1],n=Math.max(1,Math.ceil(Math.hypot(dx,dy)/step));
  ctx.save();ctx.globalAlpha=op;
  if(tool==='erase'){if(isJpg()){ctx.restore();return drawStamp(a,b,n,s,'#ffffff',op)}ctx.globalCompositeOperation='destination-out'}
  const stp=tool==='clone'?null:getStamp(s,+$('#tx-hard').value,tool==='erase'?'#000000':$('#tx-color').value);
  for(let i=0;i<=n;i++){const x=a[0]+dx*i/n,y=a[1]+dy*i/n;
    if(tool==='clone'&&cloneOff){tiles(x,y,s,(px,py)=>{ctx.save();ctx.beginPath();ctx.arc(px,py,s/2,0,7);ctx.clip();ctx.drawImage(cloneSnap,cloneOff[0],cloneOff[1]);ctx.restore()})}
    else tiles(x,y,s,(px,py)=>ctx.drawImage(stp,px-s/2,py-s/2,s,s))}
  ctx.restore()}
function drawStamp(a,b,n,s,color,op){const stp=getStamp(s,+$('#tx-hard').value,color),dx=b[0]-a[0],dy=b[1]-a[1];ctx.save();ctx.globalAlpha=op;
  for(let i=0;i<=n;i++)tiles(a[0]+dx*i/n,a[1]+dy*i/n,s,(px,py)=>ctx.drawImage(stp,px-s/2,py-s/2,s,s));ctx.restore()}
function shape(a,b){const s=+$('#tx-size').value,fill=$('#tx-fillshape').checked;ctx.save();ctx.globalAlpha=+$('#tx-op').value/100;ctx.strokeStyle=ctx.fillStyle=$('#tx-color').value;ctx.lineWidth=Math.max(1,s/4);ctx.lineCap='round';
  ctx.beginPath();if(tool==='line'){ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke()}
  else if(tool==='rect'){const x=Math.min(a[0],b[0]),y=Math.min(a[1],b[1]),w=Math.abs(b[0]-a[0]),h=Math.abs(b[1]-a[1]);fill?ctx.fillRect(x,y,w,h):ctx.strokeRect(x,y,w,h)}
  else{ctx.ellipse((a[0]+b[0])/2,(a[1]+b[1])/2,Math.abs(b[0]-a[0])/2,Math.abs(b[1]-a[1])/2,0,0,7);fill?ctx.fill():ctx.stroke()}ctx.restore()}
function flood(x,y){const W=cv.width,H=cv.height;if(x<0||y<0||x>=W||y>=H)return;const im=ctx.getImageData(0,0,W,H),d=im.data,tol=+$('#tx-tol').value;
  const[fr,fg,fb]=hex2rgb($('#tx-color').value),fa=Math.round(+$('#tx-op').value*2.55);
  const i0=(y*W+x)*4,t=[d[i0],d[i0+1],d[i0+2],d[i0+3]],seen=new Uint8Array(W*H),st=[x,y];
  const ok=i=>Math.abs(d[i]-t[0])<=tol&&Math.abs(d[i+1]-t[1])<=tol&&Math.abs(d[i+2]-t[2])<=tol&&Math.abs(d[i+3]-t[3])<=tol;
  while(st.length){const cy=st.pop(),cx=st.pop();let xx=cx;while(xx>=0&&!seen[cy*W+xx]&&ok((cy*W+xx)*4))xx--;xx++;let up=false,dn=false;
    while(xx<W&&!seen[cy*W+xx]&&ok((cy*W+xx)*4)){const k=cy*W+xx;seen[k]=1;const o=k*4,a=fa/255;d[o]=d[o]*(1-a)+fr*a;d[o+1]=d[o+1]*(1-a)+fg*a;d[o+2]=d[o+2]*(1-a)+fb*a;d[o+3]=Math.max(d[o+3],fa);
      if(cy>0){const u=!seen[k-W]&&ok((k-W)*4);if(u&&!up)st.push(xx,cy-1);up=u}
      if(cy<H-1){const v=!seen[k+W]&&ok((k+W)*4);if(v&&!dn)st.push(xx,cy+1);dn=v}xx++}}
  ctx.putImageData(im,0,0)}
async function down(e){if(!cur)return;cv.setPointerCapture(e.pointerId);
  if(space||e.button===1||e.button===2){panning={x:e.clientX,y:e.clientY};$('#tx-wrap').classList.add('panning');return}
  const p=pt(e);
  if(tool==='pick'){const d=ctx.getImageData(p[0]|0,p[1]|0,1,1).data;$('#tx-color').value='#'+[...d].slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join('');return}
  if(tool==='fill'){push();flood(p[0]|0,p[1]|0);dirty();tile();return}
  if(tool==='clone'&&e.altKey){cloneSrc=p;E.toast('Origem do carimbo definida');return}
  if(tool==='clone'){if(!cloneSrc)return E.toast('Alt+clique para escolher a origem',true);cloneOff=[0,0];cloneSnap=document.createElement('canvas');cloneSnap.width=cv.width;cloneSnap.height=cv.height;cloneSnap.getContext('2d').drawImage(cv,0,0);cloneOff=[cloneSrc[0]-p[0],cloneSrc[1]-p[1]]}
  push();drawing=true;last=p;startPt=p;
  if(tool==='line'||tool==='rect'||tool==='ellipse'){snapImg=ctx.getImageData(0,0,cv.width,cv.height)}else dab(p,p)}
function move(e){if(!cur)return;if(panning){const w=$('#tx-wrap');w.scrollLeft-=e.clientX-panning.x;w.scrollTop-=e.clientY-panning.y;panning.x=e.clientX;panning.y=e.clientY;return}const p=pt(e);const px=ctx.getImageData(Math.max(0,Math.min(cv.width-1,p[0]|0)),Math.max(0,Math.min(cv.height-1,p[1]|0)),1,1).data;
  $('#tx-pos').textContent=(p[0]|0)+', '+(p[1]|0)+'  rgba('+px.join(',')+')';
  if(!drawing)return;
  if(snapImg){ctx.putImageData(snapImg,0,0);shape(startPt,p)}else{dab(last,p);last=p}}
function up(e){if(panning){panning=null;$('#tx-wrap').classList.remove('panning');return}if(!drawing)return;if(snapImg){ctx.putImageData(snapImg,0,0);shape(startPt,pt(e));snapImg=null}drawing=false;cloneSnap=tool==='clone'?cloneSnap:null;dirty();tile()}
function push(){if(!cur)return;undo.push({w:cv.width,h:cv.height,d:ctx.getImageData(0,0,cv.width,cv.height)});if(undo.length>20)undo.shift();redo=[]}
function doUndo(){const s=undo.pop();if(!s)return;redo.push({w:cv.width,h:cv.height,d:ctx.getImageData(0,0,cv.width,cv.height)});cv.width=s.w;cv.height=s.h;ctx.putImageData(s.d,0,0);setZoom(zoom);dirty();tile()}
function doRedo(){const s=redo.pop();if(!s)return;undo.push({w:cv.width,h:cv.height,d:ctx.getImageData(0,0,cv.width,cv.height)});cv.width=s.w;cv.height=s.h;ctx.putImageData(s.d,0,0);setZoom(zoom);dirty();tile()}
function dirty(){E.setDirty('textura',true)}
function setZoom(z){zoom=Math.min(32,Math.max(.05,z));if(!cur)return;cv.style.width=cv.width*zoom+'px';cv.style.height=cv.height*zoom+'px';cv.style.imageRendering=zoom<1?'auto':'pixelated';
  $('#tx-zoom').value=Math.log2(zoom);$('#tx-zv').textContent=E.pct(zoom);if(zb)zb.label(E.pct(zoom))}
/* zoom mantendo parado o ponto da imagem sob o cursor (cx,cy em px de tela; sem eles, centro da área visível) */
function setZoomAt(z,cx,cy){if(!cur)return setZoom(z);const w=$('#tx-wrap'),wr=w.getBoundingClientRect();if(cx==null){cx=wr.left+wr.width/2;cy=wr.top+wr.height/2}
  const r=cv.getBoundingClientRect(),fx=(cx-r.left)/r.width,fy=(cy-r.top)/r.height;setZoom(z);const r2=cv.getBoundingClientRect();w.scrollLeft+=r2.left+fx*r2.width-cx;w.scrollTop+=r2.top+fy*r2.height-cy}
function fit(){const w=$('#tx-wrap');needFit=!w.clientWidth;w.scrollLeft=w.scrollTop=0;setZoom(Math.min((w.clientWidth-40)/cv.width,(w.clientHeight-40)/cv.height,4))}
E.show_tex=()=>{if(cur&&needFit)fit()};
function preview(){cv.style.filter=`brightness(${$('#tx-br').value}%) contrast(${$('#tx-co').value}%) saturate(${$('#tx-sa').value}%) hue-rotate(${$('#tx-hu').value}deg)`}
function applyAdj(){if(!cur)return;push();const t=document.createElement('canvas');t.width=cv.width;t.height=cv.height;const c=t.getContext('2d');
  c.filter=`brightness(${$('#tx-br').value}%) contrast(${$('#tx-co').value}%) saturate(${$('#tx-sa').value}%) hue-rotate(${$('#tx-hu').value}deg)`;c.drawImage(cv,0,0);
  ctx.clearRect(0,0,cv.width,cv.height);ctx.drawImage(t,0,0);E.$('#tx-reset').click();cv.style.filter='';dirty();tile()}
function xform(k){if(!cur)return;push();const t=document.createElement('canvas');t.width=cv.width;t.height=cv.height;t.getContext('2d').drawImage(cv,0,0);
  if(k==='rot'){cv.width=t.height;cv.height=t.width}ctx.save();ctx.clearRect(0,0,cv.width,cv.height);
  if(k==='fh'){ctx.translate(cv.width,0);ctx.scale(-1,1)}else if(k==='fv'){ctx.translate(0,cv.height);ctx.scale(1,-1)}else{ctx.translate(cv.width,0);ctx.rotate(Math.PI/2)}
  ctx.drawImage(t,0,0);ctx.restore();setZoom(zoom);dirty();tile()}
function pix(fn){if(!cur)return;push();const im=ctx.getImageData(0,0,cv.width,cv.height);fn(im.data,im);ctx.putImageData(im,0,0);dirty();tile()}
function conv(k,div){if(!cur)return;push();const W=cv.width,H=cv.height,im=ctx.getImageData(0,0,W,H),s=im.data,o=new Uint8ClampedArray(s.length);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){for(let c=0;c<4;c++){let a=0;for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){const xx=(x+i+W)%W,yy=(y+j+H)%H;a+=s[(yy*W+xx)*4+c]*k[(j+1)*3+i+1]}o[(y*W+x)*4+c]=a/div}}
  im.data.set(o);ctx.putImageData(im,0,0);dirty();tile()}
function offset(){if(!cur)return;const v=E.ask('Deslocar quantos pixels? (x, y) — a imagem dá a volta:','0, '+(cv.height>>1));if(!v)return;const[dx,dy]=v.split(/[ ,;]+/).map(Number);if(!isFinite(dx)||!isFinite(dy))return;
  push();const t=document.createElement('canvas');t.width=cv.width;t.height=cv.height;t.getContext('2d').drawImage(cv,0,0);ctx.clearRect(0,0,cv.width,cv.height);
  const W=cv.width,H=cv.height,ox=((dx%W)+W)%W,oy=((dy%H)+H)%H;for(const a of[-W,0])for(const b of[-H,0])ctx.drawImage(t,ox+a,oy+b);dirty();tile()}
function keyout(){if(!cur)return;const[r,g,b]=hex2rgb($('#tx-color').value),tol=+$('#tx-tol').value*2;pix(d=>{for(let i=0;i<d.length;i+=4)if(Math.abs(d[i]-r)+Math.abs(d[i+1]-g)+Math.abs(d[i+2]-b)<=tol*1.5)d[i+3]=0});
  if(isJpg())E.toast('JPEG não guarda transparência: a cor sairá preta',true)}
function resize(){if(!cur)return;const w=Math.round(E.num($('#tx-rw'))),h=Math.round(E.num($('#tx-rh')));if(w<1||h<1||w>8192||h>8192)throw new Error('Tamanho inválido');if(w===cv.width&&h===cv.height)return;
  push();const t=document.createElement('canvas');t.width=cv.width;t.height=cv.height;t.getContext('2d').drawImage(cv,0,0);cv.width=w;cv.height=h;ctx.imageSmoothingQuality='high';ctx.drawImage(t,0,0,w,h);setZoom(zoom);fit();dirty();tile();
  if(cur.idx>=0)E.toast('Tamanho da textura mudou: ao salvar o trk.json é atualizado (UVs continuam valendo, pois são normalizados)')}
const blob=()=>new Promise(r=>cv.toBlob(r,cur.mime,+$('#tx-q2').value/100));
async function save(){if(!cur)return;if(cur.dds)throw new Error('DDS é só leitura. Use “Salvar como PNG novo…”.');
  const b=await blob();if(!b)throw new Error('Falha ao gerar a imagem');if(b.type!==cur.mime)throw new Error('Este navegador não gera '+cur.mime+' (gerou '+b.type+'). Use Chrome/Edge/Firefox ou “Salvar como PNG novo…”.');
  const buf=await b.arrayBuffer();await E.api.save(cur.path,buf);
  if(cur.idx>=0&&(cur.w!==cv.width||cur.h!==cv.height)){const j=await E.api.json('data/trk.json');j.tex[cur.idx].w=cv.width;j.tex[cur.idx].h=cv.height;await E.jsonSave('data/trk.json',j);trk=j}
  cur.w=cv.width;cur.h=cv.height;E.setDirty('textura',false);E.toast('Salvo: '+cur.path+' ('+E.fmtKB(buf.byteLength)+')');list()}
async function saveAs(){if(!cur)return;const def=cur.path.replace(/\.[a-z0-9]+$/i,'')+'_novo.png',p=E.ask('Salvar PNG em:',def);if(!p)return;
  const b=await new Promise(r=>cv.toBlob(r,'image/png'));await E.api.save(p,await b.arrayBuffer());E.toast('Salvo: '+p+' — aponte um JSON para ele para usar no jogo');list()}
async function loadVers(){if(!cur)return;const v=await E.api.backups(cur.path),s=$('#tx-vers');s.innerHTML='<option value="">Versões anteriores…</option>';v.forEach(t=>s.append(E.el('option',{value:t,text:t.replace(/^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d).*/,'$3/$2/$1 $4:$5:$6')})))}
function tile(){if(!cur)return;try{const u=cv.toDataURL('image/png');const t=$('#tx-tile');t.style.backgroundImage=`url(${u})`;t.style.backgroundSize=Math.min(128,cv.width)+'px auto'}catch(e){}}
})();
