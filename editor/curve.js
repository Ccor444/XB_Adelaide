/* Editor de curva [[x,y],...]: arraste pontos, duplo clique no vazio adiciona, Shift+clique (ou botão direito) em ponto remove. */
(function(){
E.curve=function(host,o){
  const cv=E.el('canvas',{class:'cvs'});host.append(cv);let pts=o.pts.map(p=>p.slice()),drag=-1;const H=o.h||160,pad={l:40,r:10,t:8,b:20};
  const xr=()=>{const mx=Math.max(o.xmax||0,...pts.map(p=>p[0]),1e-9);return[o.xmin||0,mx*(o.xmax?1:1.05)]};
  const yr=()=>[0,Math.max(o.ymax||0,...pts.map(p=>p[1]),1e-9)*(o.ymax?1:1.1)];
  const dpr=Math.min(2,devicePixelRatio||1);
  function size(){const w=cv.clientWidth||400;if(cv.width!==w*dpr|0){cv.width=w*dpr;cv.height=H*dpr}cv.style.height=H+'px'}
  const tx=(x,w)=>{const[a,b]=xr();return pad.l+(x-a)/(b-a)*(w-pad.l-pad.r)},ty=(y)=>{const[a,b]=yr();return H-pad.b-(y-a)/(b-a)*(H-pad.t-pad.b)};
  const fx=(sx,w)=>{const[a,b]=xr();return a+(sx-pad.l)/(w-pad.l-pad.r)*(b-a)},fy=sy=>{const[a,b]=yr();return a+(H-pad.b-sy)/(H-pad.t-pad.b)*(b-a)};
  function draw(){size();const w=cv.width/dpr,c=cv.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,H);c.fillStyle='#080a0d';c.fillRect(0,0,w,H);
    c.font='10px monospace';c.fillStyle='#8b97a6';c.strokeStyle='#1c222a';const[x0,x1]=xr(),[y0,y1]=yr();
    for(let i=0;i<=4;i++){const y=y0+(y1-y0)*i/4,sy=ty(y);c.beginPath();c.moveTo(pad.l,sy);c.lineTo(w-pad.r,sy);c.stroke();c.fillText((o.yfmt||(v=>+v.toFixed(2)))(y),2,sy+3)}
    for(let i=0;i<=5;i++){const x=x0+(x1-x0)*i/5,sx=tx(x,w);c.beginPath();c.moveTo(sx,pad.t);c.lineTo(sx,H-pad.b);c.stroke();c.fillText((o.xfmt||(v=>Math.round(v)))(x),sx-10,H-6)}
    if(o.extra)o.extra(c,{tx:x=>tx(x,w),ty,w,H});
    if(!pts.length)return;c.strokeStyle='#ff7a2e';c.lineWidth=2;c.beginPath();pts.forEach((p,i)=>{const sx=tx(p[0],w),sy=ty(p[1]);i?c.lineTo(sx,sy):c.moveTo(sx,sy)});c.stroke();
    pts.forEach((p,i)=>{c.beginPath();c.arc(tx(p[0],w),ty(p[1]),i===drag?6:4,0,7);c.fillStyle=i===drag?'#fff':'#ffd24a';c.fill()})}
  const pos=e=>{const r=cv.getBoundingClientRect();return[e.clientX-r.left,e.clientY-r.top]};
  const hit=(sx,sy)=>{const w=cv.clientWidth;let b=-1,bd=100;pts.forEach((p,i)=>{const d=(tx(p[0],w)-sx)**2+(ty(p[1])-sy)**2;if(d<bd){bd=d;b=i}});return b};
  const emit=()=>o.onchange&&o.onchange(pts.map(p=>p.slice()));
  const sortP=()=>{const cur=drag>=0?pts[drag]:null;pts.sort((a,b)=>a[0]-b[0]);if(cur)drag=pts.indexOf(cur)};
  cv.onpointerdown=e=>{const[sx,sy]=pos(e),i=hit(sx,sy);if(i>=0&&(e.shiftKey||e.button===2)){if(pts.length>2){pts.splice(i,1);drag=-1;draw();emit()}return}
    if(i>=0){drag=i;cv.setPointerCapture(e.pointerId);draw()}};
  cv.ondblclick=e=>{const[sx,sy]=pos(e),w=cv.clientWidth;if(hit(sx,sy)>=0)return;pts.push([E.fix(fx(sx,w),o.xdec??4),E.fix(Math.max(0,fy(sy)),4)]);sortP();draw();emit()};
  cv.onpointermove=e=>{if(drag<0)return;const[sx,sy]=pos(e),w=cv.clientWidth;let x=fx(sx,w),y=Math.max(0,fy(sy));if(o.ymax)y=Math.min(o.ymax,y);if(o.xmax)x=Math.min(o.xmax,x);
    const lo=drag>0?pts[drag-1][0]:(o.xmin||0),hi=drag<pts.length-1?pts[drag+1][0]:1e12;x=Math.max(lo,Math.min(hi,x));pts[drag]=[E.fix(x,o.xdec??4),E.fix(y,4)];draw();emit()};
  cv.onpointerup=cv.onpointercancel=()=>{drag=-1;draw()};cv.oncontextmenu=e=>e.preventDefault();
  new ResizeObserver(draw).observe(cv);draw();
  return{redraw:draw,set(p){pts=p.map(q=>q.slice());draw()},get:()=>pts.map(p=>p.slice())}};
})();
