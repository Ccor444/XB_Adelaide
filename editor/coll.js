/* Aba Colisão: edita assets/track/phy.v.bin (vértices float32 xyz), phy.i.bin (índices uint16) e phy.f.bin (superfície por triângulo).
   O jogo usa triângulos com inclinação < ~70° como CHÃO (com superfície) e os mais inclinados como PAREDE.
   Código de superfície no arquivo: 0 asfalto/concreto · 1 grama · 2 cascalho · 3 zebra. */
(function(){
const $=E.$;
const SURF=[{n:'Asfalto / concreto',s:'asfalto',c:[.50,.56,.66]},{n:'Grama',s:'grama',c:[.25,.62,.30]},{n:'Cascalho',s:'cascalho',c:[.80,.66,.38]},{n:'Zebra (kerb)',s:'zebra',c:[.96,.42,.12]}];
const WALL_NY=.35,WALL_COL=[.85,.25,.65],SCEN=/tree|peple|lamp|pole|cone|trebg|olive|shado|green|jumbo|cwin|roof|bldng|tent|canv|truck|tral|crane|cran|logo|fence/;
let V=null,C=null,sel=null,ny=null,cen=null,undo=[],redo=[],tool='tri',show=[1,1,1,1,1],ghost=null,space=false,brushing=false,gpu=null,needBuild=true,vis=[],loaded=false;

/* ----------- E.phy: leitura/gravação dos arquivos (também usada pela aba Modelos) ----------- */
const phy={
  async read(){const ex=await E.api.json('data/ext.json'),P=ex.phy,[v,i,f]=await Promise.all([E.api.bin(P.v.$file),E.api.bin(P.i.$file),E.api.bin(P.f.$file)]);
    const o={ex,v:new Float32Array(v),i:new Uint16Array(i),f:new Uint8Array(f)};if(o.i.length!==o.f.length*3)throw new Error('phy.i e phy.f não combinam ('+o.i.length/3+' vs '+o.f.length+')');return o},
  compact(o){const nv=o.v.length/3,map=new Int32Array(nv).fill(-1);let n=0;for(let k=0;k<o.i.length;k++){const v=o.i[k];if(map[v]<0)map[v]=n++}
    const v=new Float32Array(n*3);for(let k=0;k<nv;k++)if(map[k]>=0){v[map[k]*3]=o.v[k*3];v[map[k]*3+1]=o.v[k*3+1];v[map[k]*3+2]=o.v[k*3+2]}
    const i=new Uint16Array(o.i.length);for(let k=0;k<i.length;k++)i[k]=map[o.i[k]];return{v,i,f:o.f}},
  async write(o,ex){const c=phy.compact(o);if(c.v.length/3>65535)throw new Error('Limite de 65535 vértices excedido ('+c.v.length/3+')');
    ex=ex||await E.api.json('data/ext.json');const P=ex.phy;
    await E.api.save(P.v.$file,c.v);await E.api.save(P.i.$file,c.i);await E.api.save(P.f.$file,c.f);
    P.nv=c.v.length/3;P.nt=c.f.length;await E.jsonSave('data/ext.json',ex);return c},
  /* adiciona triângulos soltos (pos = x,y,z × 3 por triângulo) com a superfície dada e grava direto */
  async appendTris(pos,surf){if(E.dirty['colisão'])throw new Error('A aba Colisão tem alterações não salvas: salve ou recarregue primeiro');
    const o=await phy.read(),n=pos.length/9,nv=o.v.length/3;if(nv+n*3>65535)throw new Error('Não cabe: limite de 65535 vértices na colisão');
    const v=new Float32Array(o.v.length+pos.length);v.set(o.v);v.set(pos,o.v.length);const i=new Uint16Array(o.i.length+n*3);i.set(o.i);for(let k=0;k<n*3;k++)i[o.i.length+k]=nv+k;
    const f=new Uint8Array(o.f.length+n);f.set(o.f);f.fill(surf,o.f.length);await phy.write({v,i,f},o.ex);if(loaded)await reload(true);return n}
};
E.phy=phy;

/* ----------- shaders / GPU ----------- */
const VS=`#version 300 es
in vec3 a_p;in vec4 a_c;uniform mat4 u_vp;uniform float u_bias;out vec4 v_c;out vec3 v_w;
void main(){v_c=a_c;v_w=a_p;gl_Position=u_vp*vec4(a_p,1.);gl_Position.z-=u_bias*gl_Position.w;}`;
const FS=`#version 300 es
precision highp float;in vec4 v_c;in vec3 v_w;uniform float u_lit;out vec4 o;
void main(){float l=1.;if(u_lit>.5){vec3 n=cross(dFdx(v_w),dFdy(v_w));float q=length(n);l=q>1e-9?.55+.45*abs(dot(n/q,normalize(vec3(.4,.8,.3)))):1.;}o=vec4(v_c.rgb*l,v_c.a);}`;
function initGpu(gl){const sh=(t,s)=>{const o=gl.createShader(t);gl.shaderSource(o,s);gl.compileShader(o);if(!gl.getShaderParameter(o,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(o));return o};
  const p=gl.createProgram();gl.attachShader(p,sh(gl.VERTEX_SHADER,VS));gl.attachShader(p,sh(gl.FRAGMENT_SHADER,FS));gl.bindAttribLocation(p,0,'a_p');gl.bindAttribLocation(p,1,'a_c');gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));
  const mk=()=>{const vao=gl.createVertexArray(),vbo=gl.createBuffer();gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,vbo);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,16,0);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,4,gl.UNSIGNED_BYTE,true,16,12);gl.bindVertexArray(null);return{vao,vbo,n:0}};
  gpu={gl,p,tri:mk(),line:mk(),u:{vp:gl.getUniformLocation(p,'u_vp'),bias:gl.getUniformLocation(p,'u_bias'),lit:gl.getUniformLocation(p,'u_lit')}}}

/* ----------- dados derivados ----------- */
function derive(){const nt=C.f.length,V3=C.v;ny=new Float32Array(nt);cen=new Float32Array(nt*3);
  if(!sel||sel.length!==nt)sel=new Uint8Array(nt);
  for(let t=0;t<nt;t++){const a=C.i[t*3]*3,b=C.i[t*3+1]*3,c=C.i[t*3+2]*3;
    const ux=V3[b]-V3[a],uy=V3[b+1]-V3[a+1],uz=V3[b+2]-V3[a+2],vx=V3[c]-V3[a],vy=V3[c+1]-V3[a+1],vz=V3[c+2]-V3[a+2];
    const nx=uy*vz-uz*vy,nyy=uz*vx-ux*vz,nz=ux*vy-uy*vx,l=Math.hypot(nx,nyy,nz);ny[t]=l<1e-9?-1:Math.abs(nyy)/l;
    cen[t*3]=(V3[a]+V3[b]+V3[c])/3;cen[t*3+1]=(V3[a+1]+V3[b+1]+V3[c+1])/3;cen[t*3+2]=(V3[a+2]+V3[b+2]+V3[c+2])/3}}
const isWall=t=>ny[t]<WALL_NY;
const showTri=t=>ny[t]<0?false:isWall(t)?show[4]:show[C.f[t]&3];
function build(){
  if(!gpu||!C)return;const gl=gpu.gl,nt=C.f.length;vis=[];for(let t=0;t<nt;t++)if(showTri(t))vis.push(t);
  const buf=new ArrayBuffer(vis.length*3*16),F=new Float32Array(buf),U=new Uint8Array(buf),walls=$('#co-walls').checked;
  vis.forEach((t,k)=>{let col=SURF[C.f[t]&3].c;if(walls&&isWall(t))col=WALL_COL;
    let r=col[0],g=col[1],b=col[2];if(sel[t]){r=r*.25+.75;g=g*.25+.5;b=b*.25+.12}
    for(let j=0;j<3;j++){const vi=C.i[t*3+j]*3,o=(k*3+j)*4;F[o]=C.v[vi];F[o+1]=C.v[vi+1];F[o+2]=C.v[vi+2];const q=(k*3+j)*16+12;U[q]=r*255;U[q+1]=g*255;U[q+2]=b*255;U[q+3]=255}});
  gl.bindBuffer(gl.ARRAY_BUFFER,gpu.tri.vbo);gl.bufferData(gl.ARRAY_BUFFER,buf,gl.DYNAMIC_DRAW);gpu.tri.n=vis.length*3;
  // arestas: todas (contorno) ou só as selecionadas
  const all=$('#co-edges').checked,eds=[];for(const t of vis)if(all||sel[t])eds.push(t);
  const lb=new ArrayBuffer(eds.length*6*16),LF=new Float32Array(lb),LU=new Uint8Array(lb);
  eds.forEach((t,k)=>{const s=!!sel[t];for(let e=0;e<3;e++)for(let j=0;j<2;j++){const vi=C.i[t*3+(e+j)%3]*3,idx=k*6+e*2+j,o=idx*4;LF[o]=C.v[vi];LF[o+1]=C.v[vi+1];LF[o+2]=C.v[vi+2];const q=idx*16+12;
      if(s){LU[q]=255;LU[q+1]=190;LU[q+2]=60}else{LU[q]=14;LU[q+1]=18;LU[q+2]=24}LU[q+3]=255}});
  gl.bindBuffer(gl.ARRAY_BUFFER,gpu.line.vbo);gl.bufferData(gl.ARRAY_BUFFER,lb,gl.DYNAMIC_DRAW);gpu.line.n=eds.length*6;needBuild=false}
function onFrame(gl,M){
  if(!C)return;if(!gpu)initGpu(gl);if(needBuild)build();
  gl.useProgram(gpu.p);gl.uniformMatrix4fv(gpu.u.vp,false,M);gl.enable(gl.DEPTH_TEST);gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(-1,-2);
  gl.bindVertexArray(gpu.tri.vao);gl.uniform1f(gpu.u.lit,1);gl.uniform1f(gpu.u.bias,0);gl.drawArrays(gl.TRIANGLES,0,gpu.tri.n);gl.disable(gl.POLYGON_OFFSET_FILL);
  gl.bindVertexArray(gpu.line.vao);gl.uniform1f(gpu.u.lit,0);gl.uniform1f(gpu.u.bias,.00015);gl.drawArrays(gl.LINES,0,gpu.line.n);gl.bindVertexArray(null)}

/* ----------- histórico ----------- */
const snapState=()=>({v:C.v.slice(),i:C.i.slice(),f:C.f.slice(),sel:sel.slice()});
function push(){undo.push(snapState());if(undo.length>30)undo.shift();redo=[]}
function restore(s){C={v:s.v.slice(),i:s.i.slice(),f:s.f.slice()};sel=s.sel.slice();after(true)}
function doUndo(){const s=undo.pop();if(!s)return;redo.push(snapState());restore(s)}
function doRedo(){const s=redo.pop();if(!s)return;undo.push(snapState());restore(s)}
function after(mark){derive();needBuild=true;V.req();stats();if(mark)E.setDirty('colisão',true)}

/* ----------- seleção / picking ----------- */
function pickTri(e){const r=V.cv.getBoundingClientRect(),{o,d}=V.ray(e.clientX-r.left,e.clientY-r.top);let best=1e30,bt=-1;const F=C.v,I=C.i;
  for(const t of vis){const a=I[t*3]*3,b=I[t*3+1]*3,c=I[t*3+2]*3;
    const e1x=F[b]-F[a],e1y=F[b+1]-F[a+1],e1z=F[b+2]-F[a+2],e2x=F[c]-F[a],e2y=F[c+1]-F[a+1],e2z=F[c+2]-F[a+2];
    const px=d[1]*e2z-d[2]*e2y,py=d[2]*e2x-d[0]*e2z,pz=d[0]*e2y-d[1]*e2x,det=e1x*px+e1y*py+e1z*pz;if(Math.abs(det)<1e-12)continue;const inv=1/det;
    const tx=o[0]-F[a],ty=o[1]-F[a+1],tz=o[2]-F[a+2],u=(tx*px+ty*py+tz*pz)*inv;if(u<0||u>1)continue;
    const qx=ty*e1z-tz*e1y,qy=tz*e1x-tx*e1z,qz=tx*e1y-ty*e1x,v=(d[0]*qx+d[1]*qy+d[2]*qz)*inv;if(v<0||u+v>1)continue;
    const dist=(e2x*qx+e2y*qy+e2z*qz)*inv;if(dist>0&&dist<best){best=dist;bt=t}}
  return bt<0?null:{t:bt,p:[o[0]+d[0]*best,o[1]+d[1]*best,o[2]+d[2]*best]}}
function setSel(ts,mode){ // mode: 'set' | 'add' | 'sub'
  if(mode==='set')sel.fill(0);for(const t of ts)sel[t]=mode==='sub'?0:1;needBuild=true;V.req();stats()}
function clickPick(e){if(tool==='pan')return;const h=pickTri(e),mode=e.altKey?'sub':e.shiftKey?'add':'set';
  if(!h){if(mode==='set'){sel.fill(0);needBuild=true;V.req();stats()}return}
  if(tool==='conn'){setSel(connected(h.t),mode);return}
  if(tool==='brush'){brushDab(h.p,mode==='sub'?'sub':'add');return}
  setSel([h.t],mode);info(h.t)}
function brushDab(p,mode){const r=+$('#co-r').value,r2=r*r,ts=[];for(const t of vis){const dx=cen[t*3]-p[0],dy=cen[t*3+1]-p[1],dz=cen[t*3+2]-p[2];if(dx*dx+dy*dy+dz*dz<=r2)ts.push(t)}setSel(ts,mode)}
function brushAt(e){const h=pickTri(e);if(h)brushDab(h.p,e.altKey?'sub':'add')}
function connected(t0){ // mesma superfície e mesma classe (chão/parede), ligados por vértices (soldados por posição)
  const key=new Map(),vid=new Int32Array(C.v.length/3);let n=0;
  for(let k=0;k<vid.length;k++){const s=Math.round(C.v[k*3]*500)+','+Math.round(C.v[k*3+1]*500)+','+Math.round(C.v[k*3+2]*500);let id=key.get(s);if(id===undefined){id=n++;key.set(s,id)}vid[k]=id}
  const adj=Array.from({length:n},()=>[]);for(const t of vis)for(let j=0;j<3;j++)adj[vid[C.i[t*3+j]]].push(t);
  const cls=t=>isWall(t)?9:C.f[t],c0=cls(t0),seen=new Uint8Array(C.f.length),st=[t0],out=[];seen[t0]=1;
  while(st.length){const t=st.pop();out.push(t);for(let j=0;j<3;j++)for(const u of adj[vid[C.i[t*3+j]]])if(!seen[u]&&cls(u)===c0){seen[u]=1;st.push(u)}}return out}
const selList=()=>{const o=[];for(let t=0;t<sel.length;t++)if(sel[t])o.push(t);return o};
function info(t){const a=C.i[t*3]*3,b=C.i[t*3+1]*3,c=C.i[t*3+2]*3,F=C.v;
  const ux=F[b]-F[a],uy=F[b+1]-F[a+1],uz=F[b+2]-F[a+2],vx=F[c]-F[a],vy=F[c+1]-F[a+1],vz=F[c+2]-F[a+2],ar=Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)/2;
  $('#co-info').textContent='tri #'+t+' · '+(isWall(t)?'PAREDE':SURF[C.f[t]&3].s)+' · inclinação '+(Math.acos(Math.min(1,ny[t]))*180/Math.PI).toFixed(0)+'° · '+ar.toFixed(1)+' m² · y≈'+cen[t*3+1].toFixed(2)}

/* ----------- operações ----------- */
function needSel(){const l=selList();if(!l.length)throw new Error('Nada selecionado: clique num triângulo, use o pincel ou “Tudo”');return l}
function setSurface(s){const l=needSel();push();for(const t of l)C.f[t]=s;after(true);E.toast(l.length+' triângulo(s) → '+SURF[s].n)}
function delSel(){const l=needSel();push();const keep=[];for(let t=0;t<C.f.length;t++)if(!sel[t])keep.push(t);
  const i=new Uint16Array(keep.length*3),f=new Uint8Array(keep.length);keep.forEach((t,k)=>{i.set(C.i.subarray(t*3,t*3+3),k*3);f[k]=C.f[t]});C.i=i;C.f=f;sel=new Uint8Array(f.length);after(true);E.toast(l.length+' triângulo(s) excluídos')}
function separate(){ // duplica vértices dos triângulos selecionados que são compartilhados com não selecionados
  const nv=C.v.length/3,used=new Uint8Array(nv);for(let t=0;t<C.f.length;t++)if(!sel[t])for(let j=0;j<3;j++)used[C.i[t*3+j]]=1;
  const map=new Map(),add=[];for(let t=0;t<C.f.length;t++)if(sel[t])for(let j=0;j<3;j++){const v=C.i[t*3+j];if(used[v]){let id=map.get(v);if(id===undefined){id=nv+map.size;map.set(v,id);add.push(v)}C.i[t*3+j]=id}}
  if(!add.length)return 0;if(nv+add.length>65535)throw new Error('Limite de 65535 vértices excedido');
  const v=new Float32Array((nv+add.length)*3);v.set(C.v);add.forEach((s,k)=>{v.set(C.v.subarray(s*3,s*3+3),(nv+k)*3)});C.v=v;return add.length}
function selVerts(l){const s=new Set();for(const t of l)for(let j=0;j<3;j++)s.add(C.i[t*3+j]);return[...s]}
function moveSel(dx,dy,dz){const l=needSel();push();if(!$('#co-weld').checked)separate();for(const v of selVerts(l)){C.v[v*3]+=dx;C.v[v*3+1]+=dy;C.v[v*3+2]+=dz}after(true)}
function flatten(){const l=needSel();push();const vs=selVerts(l);let y=0;for(const v of vs)y+=C.v[v*3+1];y/=vs.length;if(!$('#co-weld').checked)separate();for(const v of selVerts(l))C.v[v*3+1]=y;after(true);E.toast('Altura nivelada em y='+y.toFixed(3))}
function smooth(){const l=needSel();push();const nb=new Map(),vs=new Set(selVerts(l));
  for(let t=0;t<C.f.length;t++)for(let j=0;j<3;j++){const a=C.i[t*3+j];if(!vs.has(a))continue;let s=nb.get(a);if(!s)nb.set(a,s=new Set());s.add(C.i[t*3+(j+1)%3]);s.add(C.i[t*3+(j+2)%3])}
  const ny2=new Map();for(const[v,s]of nb){let y=0;for(const u of s)y+=C.v[u*3+1];ny2.set(v,C.v[v*3+1]*.5+y/s.size*.5)}for(const[v,y]of ny2)C.v[v*3+1]=y;after(true)}
function addGeom(pos,surf){ // pos: triângulos soltos (9 floats cada)
  const n=pos.length/9,nv=C.v.length/3;if(nv+n*3>65535)throw new Error('Limite de 65535 vértices excedido');
  const v=new Float32Array(C.v.length+pos.length);v.set(C.v);v.set(pos,C.v.length);const i=new Uint16Array(C.i.length+n*3);i.set(C.i);for(let k=0;k<n*3;k++)i[C.i.length+k]=nv+k;
  const f=new Uint8Array(C.f.length+n);f.set(C.f);f.fill(surf,C.f.length);const s=new Uint8Array(f.length);s.fill(1,C.f.length);C={v,i,f};sel=s}
function primTris(kind,w,h,d,rotDeg,at){const x=w/2,y=h/2,z=d/2,T=[];const q=(a,b,c,dd)=>{T.push(...a,...b,...c,...a,...c,...dd)};const tr=(a,b,c)=>T.push(...a,...b,...c);
  if(kind==='plane')q([-x,0,z],[x,0,z],[x,0,-z],[-x,0,-z]);
  else if(kind==='wall'){q([-x,0,0],[x,0,0],[x,h,0],[-x,h,0])}
  else if(kind==='box'){q([-x,0,z],[x,0,z],[x,h,z],[-x,h,z]);q([x,0,-z],[-x,0,-z],[-x,h,-z],[x,h,-z]);q([x,0,z],[x,0,-z],[x,h,-z],[x,h,z]);q([-x,0,-z],[-x,0,z],[-x,h,z],[-x,h,-z]);q([-x,h,z],[x,h,z],[x,h,-z],[-x,h,-z])}
  else{q([-x,0,z],[x,0,z],[x,h,-z],[-x,h,-z]);q([x,0,-z],[-x,0,-z],[-x,h,-z],[x,h,-z]);tr([-x,0,-z],[-x,0,z],[-x,h,-z]);tr([x,0,z],[x,0,-z],[x,h,-z])}
  const a=rotDeg*Math.PI/180,ca=Math.cos(a),sa=Math.sin(a);for(let k=0;k<T.length;k+=3){const X=T[k],Z=T[k+2];T[k]=X*ca+Z*sa+at[0];T[k+1]+=at[1];T[k+2]=-X*sa+Z*ca+at[2]}return new Float32Array(T)}
function addPrim(){push();const c=V.cam,pos=primTris($('#co-pk').value,E.num($('#co-pw'),10),E.num($('#co-ph'),2),E.num($('#co-pd'),10),E.num($('#co-pr')),[c.tx,c.ty,c.tz]);
  addGeom(pos,+$('#co-ps').value);after(true);E.toast(pos.length/9+' triângulos adicionados na mira da câmera (selecionados — mova com Δ)')}
function parseObj(txt,scale){const P=[],T=[];for(const line of txt.split(/\r?\n/)){const a=line.trim().split(/\s+/);if(a[0]==='v')P.push(+a[1]*scale,+a[2]*scale,+a[3]*scale);
    else if(a[0]==='f'){const ids=a.slice(1).map(tok=>{let i=parseInt(tok.split('/')[0]);if(i<0)i=P.length/3+i+1;return i-1});for(let i=1;i+1<ids.length;i++)for(const id of[ids[0],ids[i],ids[i+1]])T.push(P[id*3],P[id*3+1],P[id*3+2])}}
  if(!T.length)throw new Error('OBJ sem faces');return new Float32Array(T)}
function exportObj(){const l=selList(),ts=l.length?l:[...Array(C.f.length).keys()],out=['# XB Adelaide — colisão (g = superfície)'];const map=new Map();let n=0;
  for(const t of ts)for(let j=0;j<3;j++){const v=C.i[t*3+j];if(!map.has(v)){map.set(v,++n);out.push(`v ${C.v[v*3]} ${C.v[v*3+1]} ${C.v[v*3+2]}`)}}
  for(let s=0;s<4;s++){const fs=ts.filter(t=>C.f[t]===s);if(!fs.length)continue;out.push('g '+SURF[s].s);for(const t of fs)out.push(`f ${map.get(C.i[t*3])} ${map.get(C.i[t*3+1])} ${map.get(C.i[t*3+2])}`)}
  E.download('colisao'+(l.length?'_selecao':'')+'.obj',out.join('\n'),'text/plain')}
async function regen(){
  if(!confirm('Substituir TODA a colisão pelos triângulos opacos da pista visual (como o jogo faz como reserva)? Cenário (árvores, prédios…) é ignorado.'))return;
  const t=await E.api.json('data/trk.json'),vb=new Float32Array(await E.api.bin(t.vb.$file)),ib=new Uint16Array(await E.api.bin(t.ib.$file)),S=7,pos=[],surf=[];
  for(const g of t.groups){if(g.cat!=='opaque')continue;const nm=t.texnames[g.tex];if(SCEN.test(nm))continue;
    const sf=/^gras/.test(nm)?1:/^grav/.test(nm)?2:/rmbld|rumbl/.test(nm)?3:0;
    for(let k=g.off;k+2<g.off+g.cnt;k+=3){for(let j=0;j<3;j++){const v=ib[k+j]*S;pos.push(vb[v],vb[v+1],vb[v+2])}surf.push(sf)}}
  push();C={v:new Float32Array(0),i:new Uint16Array(0),f:new Uint8Array(0)};sel=new Uint8Array(0);
  // monta por superfície
  const n=surf.length;if(n*3>65535){ // soldar vértices por posição para caber
    const key=new Map(),vv=[],ii=[];for(let k=0;k<n*3;k++){const s=Math.round(pos[k*3]*1000)+','+Math.round(pos[k*3+1]*1000)+','+Math.round(pos[k*3+2]*1000);let id=key.get(s);if(id===undefined){id=vv.length/3;key.set(s,id);vv.push(pos[k*3],pos[k*3+1],pos[k*3+2])}ii.push(id)}
    if(vv.length/3>65535)throw new Error('Pista visual tem vértices demais ('+vv.length/3+') para virar colisão');C={v:new Float32Array(vv),i:new Uint16Array(ii),f:new Uint8Array(surf)}}
  else{C={v:new Float32Array(pos),i:Uint16Array.from({length:n*3},(_,k)=>k),f:new Uint8Array(surf)}}
  sel=new Uint8Array(C.f.length);after(true);frame();E.toast('Colisão regenerada: '+C.f.length+' triângulos (salve para gravar)')}

/* ----------- UI ----------- */
function stats(){if(!C)return;const cnt=[0,0,0,0];let walls=0,degen=0,ns=0;for(let t=0;t<C.f.length;t++){if(ny[t]<0)degen++;else if(isWall(t))walls++;else cnt[C.f[t]&3]++;if(sel[t])ns++}
  $('#co-n').textContent=ns;let mn=[1e30,1e30,1e30],mx=[-1e30,-1e30,-1e30];for(let k=0;k<C.v.length;k+=3)for(let a=0;a<3;a++){mn[a]=Math.min(mn[a],C.v[k+a]);mx[a]=Math.max(mx[a],C.v[k+a])}
  $('#co-stats').innerHTML=SURF.map((s,i)=>s.s+': <b>'+cnt[i]+'</b>').join(' · ')+'<br>paredes: <b>'+walls+'</b> · degenerados: '+degen+'<br>'+C.f.length+' triângulos · '+C.v.length/3+' vértices<br>área: x '+mn[0].toFixed(0)+'…'+mx[0].toFixed(0)+' · y '+mn[1].toFixed(1)+'…'+mx[1].toFixed(1)+' · z '+mn[2].toFixed(0)+'…'+mx[2].toFixed(0);
  $('#co-info').textContent=C.f.length+' triângulos · '+ns+' selecionados'}
function frame(){if(!C||!C.v.length)return;let mn=[1e30,1e30,1e30],mx=[-1e30,-1e30,-1e30];for(let k=0;k<C.v.length;k+=3)for(let a=0;a<3;a++){mn[a]=Math.min(mn[a],C.v[k+a]);mx[a]=Math.max(mx[a],C.v[k+a])}
  const c=V.cam;c.tx=(mn[0]+mx[0])/2;c.ty=(mn[1]+mx[1])/2;c.tz=(mn[2]+mx[2])/2;const r=Math.hypot(mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2])/2;c.dist=Math.max(5,r*1.9);c.pit=.9;V.far=Math.max(500,r*30);V.req()}
async function loadGhost(){const t=await E.api.json('data/trk.json');if(!E.treeMap[t.vb.$file])return;const vb=new Uint8Array(await E.api.bin(t.vb.$file)),ib=new Uint16Array(await E.api.bin(t.ib.$file));
  ghost={vb,ib,stride:28,colorOff:16,uvOff:20,ranges:t.groups.map(g=>({start:g.off,count:g.cnt,tex:null,alpha:false,color:[.34,.38,.46,1],hidden:g.cat!=='opaque'||SCEN.test(t.texnames[g.tex]),_h:g.cat!=='opaque'||SCEN.test(t.texnames[g.tex])}))};applyGhost()}
function applyGhost(){if(!ghost)return;const m=$('#co-ghost').value;V.wire=m==='wire';ghost.ranges.forEach(r=>{r.hidden=m==='off'||r._h;r.color=m==='solid'?[.24,.27,.33,1]:[.34,.38,.46,1]});V.setModel(ghost);V.req()}
async function reload(keep){const o=await phy.read();C={v:o.v,i:o.i,f:o.f};sel=new Uint8Array(C.f.length);undo=[];redo=[];derive();needBuild=true;E.setDirty('colisão',false);stats();if(!keep)frame();V.req()}
async function save(){if(!C)return;const c=await phy.write(C);C=c;sel=new Uint8Array(C.f.length);derive();needBuild=true;E.setDirty('colisão',false);stats();V.req();E.toast('Colisão salva: '+C.f.length+' triângulos, '+C.v.length/3+' vértices — recarregue o jogo')}

E.init_coll=async function(){
  V=new E.Viewer($('#co-cv'));V.attachControls();V.addToolbar($('#co-cv').parentElement,frame);V.pick=()=>null;V.onpick=(_,e)=>clickPick(e);V.onframe=onFrame;
  const cvEl=$('#co-cv'),pd=cvEl.onpointerdown,pm=cvEl.onpointermove,pu=cvEl.onpointerup;
  cvEl.onpointerdown=e=>{if(C&&tool==='brush'&&e.button===0&&!e.shiftKey&&!space){brushing=true;cvEl.setPointerCapture(e.pointerId);brushAt(e);return}pd(e)};
  cvEl.onpointermove=e=>{if(brushing){brushAt(e);return}pm(e)};
  cvEl.onpointerup=e=>{if(brushing){brushing=false;return}pu(e)};
  document.addEventListener('keydown',e=>{if(e.code==='Space'&&E.cur==='coll')space=true;if(E.cur!=='coll'||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;
    if(e.key==='Delete'){e.preventDefault();E.guard(delSel)()}else if(e.key==='Escape'){sel.fill(0);needBuild=true;V.req();stats()}
    else if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();e.shiftKey?doRedo():doUndo()}else if((e.ctrlKey||e.metaKey)&&e.key==='y'){e.preventDefault();doRedo()}});
  document.addEventListener('keyup',e=>{if(e.code==='Space')space=false});
  // chips de exibição
  const chips=$('#co-show');[...SURF.map(s=>[s.n,s.c]),['Paredes',WALL_COL]].forEach(([n,c],i)=>{const l=E.el('label',{},[E.el('input',{type:'checkbox',checked:''}),E.el('i',{style:`background:rgb(${c.map(v=>v*255|0)})`}),n]);
    l.firstChild.onchange=e=>{show[i]=e.target.checked?1:0;needBuild=true;V.req()};chips.append(l)});
  const setRow=$('#co-setsurf');SURF.forEach((s,i)=>setRow.append(E.el('button',{text:'→ '+s.s,title:'Define a superfície dos selecionados: '+s.n,onclick:E.guard(()=>setSurface(i))})));
  E.fillSelect($('#co-ps'),SURF.map((s,i)=>[i,s.s]),0);
  $('#co-ghost').onchange=applyGhost;$('#co-walls').onchange=$('#co-edges').onchange=()=>{needBuild=true;V.req()};
  $('#co-r').oninput=()=>$('#co-rv').textContent=$('#co-r').value;
  $('#co-tool').onclick=e=>{const b=e.target.closest('button');if(!b)return;tool=b.dataset.k;E.$$('#co-tool button').forEach(x=>x.classList.toggle('on',x===b))};
  E.on('co-all','click',()=>{setSel(vis,'set')});E.on('co-none','click',()=>setSel([],'set'));
  E.on('co-inv','click',()=>{const ts=vis.filter(t=>!sel[t]);setSel(ts,'set')});
  E.on('co-bysurf','click',()=>{const s=+$('#co-ps').value;setSel(vis.filter(t=>!isWall(t)&&C.f[t]===s),'set')});
  E.on('co-bywall','click',()=>setSel(vis.filter(isWall),'set'));
  E.on('co-undo','click',doUndo);E.on('co-redo','click',doRedo);E.on('co-frame','click',frame);E.on('co-save','click',E.guard(save));E.on('co-reload','click',E.guard(async()=>{if(E.dirty['colisão']&&!confirm('Descartar alterações não salvas?'))return;await reload()}));
  E.on('co-del','click',E.guard(delSel));E.on('co-sep','click',E.guard(()=>{const l=needSel();push();const n=separate();after(true);E.toast(n+' vértices duplicados')}));
  E.on('co-move','click',E.guard(()=>moveSel(E.num($('#co-dx')),E.num($('#co-dy')),E.num($('#co-dz')))));
  E.on('co-up','click',E.guard(()=>moveSel(0,.1,0)));E.on('co-dn','click',E.guard(()=>moveSel(0,-.1,0)));
  E.on('co-flat','click',E.guard(flatten));E.on('co-smooth','click',E.guard(smooth));
  E.on('co-padd','click',E.guard(addPrim));
  E.on('co-objin','click',()=>$('#co-objfile').click());
  $('#co-objfile').onchange=E.guard(async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;const sc=parseFloat(E.ask('Escala do OBJ (1 = metros):','1'));if(!isFinite(sc))return;
    const pos=parseObj(await f.text(),sc);push();addGeom(pos,+$('#co-ps').value);after(true);E.toast('OBJ importado: '+pos.length/9+' triângulos (selecionados)')});
  E.on('co-objx','click',exportObj);E.on('co-regen','click',E.guard(regen));
  $('#co-load').textContent='Carregando colisão…';
  await reload();loaded=true;$('#co-load').textContent='';
  loadGhost().catch(e=>console.warn('pista visual indisponível',e));
};
E.show_coll=()=>{if(V)V.req()};
})();
