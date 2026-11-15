/* Aba Modelos 3D: carro, pista e troféus (formato do próprio jogo). */
(function(){
const $=E.$;let V=null,M=null,sel=-1,undo=[],trkNames=[];
let MODELS=[['track','Pista'],['cup','Troféu · taça'],['box','Troféu · caixa']];  // + um item 'car:<id>' por pasta em cars/
const SKINS=[];
const bin=async p=>await E.api.bin(p);
const carTex=p=>{if(p.tex)return p.tex;const n=p.name,wheel=/^MSH-(FL|FR|BL|BR)/.test(n),blur=/_BAlloy$/.test(n),tyre=/Tyre$/.test(n);return blur?'blur':(tyre||wheel&&!/Disc$/.test(n))?'wheel':'body'};
const KIND_COL={m:[.86,.68,.2,1],d:[.12,.12,.13,1],w:[1,1,1,1]};
E.init_mdl=async function(){
  V=new E.Viewer($('#md-cv'));V.attachControls();V.addToolbar($('#md-cv').parentElement);V.onpick=(h)=>select(h?h.range:-1);
  $('#md-cv').ondblclick=e=>{const r=e.target.getBoundingClientRect(),h=V.pick(e.clientX-r.left,e.clientY-r.top);if(h){V.cam.tx=h.point[0];V.cam.ty=h.point[1];V.cam.tz=h.point[2];V.req()}};
  const idx=await E.api.json('cars/cars.json');const carList=[];
  for(const id of idx.cars){const cj=await E.api.json('cars/'+id+'/car.json');carList.push(['car:'+id,'Carro · '+(cj.short||cj.name||id)])}
  MODELS=[...carList,...MODELS];
  E.fillSelect($('#md-model'),MODELS,'car:'+idx.default);
  $('#md-model').onchange=E.guard(()=>load($('#md-model').value));
  $('#md-skin').onchange=E.guard(()=>loadCarSkin());
  E.on('md-showall','click',()=>{M.hidden.fill(false);refresh(true);list()});
  E.on('md-frame','click',()=>V.frame());E.on('md-undo','click',doUndo);
  E.on('md-apply','click',E.guard(applyX));E.on('md-dup','click',E.guard(dupe));E.on('md-del','click',E.guard(del));
  E.on('md-add','click',E.guard(addPrim));E.on('md-objx','click',E.guard(expObj));
  E.on('md-objin','click',()=>$('#md-objfile').click());
  $('#md-objfile').onchange=E.guard(async e=>{const f=e.target.files[0];e.target.value='';if(f)await impObj(f)});
  E.on('md-save','click',E.guard(save));E.on('md-reload','click',E.guard(()=>load($('#md-model').value,true)));
  $('#md-tex').onchange=()=>{if(M.kind!=='track'||sel<0)return;snap();M.parts[sel].tex=+$('#md-tex').value;edited();refresh();list()};
  $('#md-cat').onchange=()=>{if(M.kind!=='track'||sel<0)return;snap();M.parts[sel].cat=$('#md-cat').value;edited();refresh()};
  $('#md-q').oninput=E.debounce(list,100);
  $('#md-wire').onchange=()=>{V.wire=$('#md-wire').checked;V.req()};$('#md-flat').onchange=()=>{V.flat=$('#md-flat').checked;V.req()};
  E.on('md-hideoth','click',()=>{if(sel<0)return E.toast('Selecione uma peça',true);M.hidden=M.hidden.map((_,i)=>i!==sel);refresh();list()});
  $('#md-name').onchange=()=>{if(M.kind!=='car'||sel<0)return;const n=$('#md-name').value.trim();if(!n)return;snap();M.parts[sel].name=n;edited();list();select(sel)};
  $('#md-mat').onchange=()=>{if(M.kind!=='car'||sel<0)return;snap();const v=$('#md-mat').value;if(v)M.parts[sel].tex=v;else delete M.parts[sel].tex;edited();refresh()};
  E.on('md-mx','click',E.guard(()=>mirror(0)));E.on('md-my','click',E.guard(()=>mirror(1)));E.on('md-mz','click',E.guard(()=>mirror(2)));
  E.on('md-nflip','click',E.guard(flipFaces));E.on('md-center','click',E.guard(toGround));E.on('md-solid','click',E.guard(makeSolid));
  const t=await E.api.json('data/trk.json');trkNames=t.texnames;
  E.fillSelect($('#md-tex'),trkNames.map((n,i)=>[i,i+' · '+n]));
  await load('car:'+idx.default);
};
E.show_mdl=()=>{if(V)V.req()};
async function load(kind,force){
  if(!force&&M&&E.dirty.modelo&&!confirm('Há alterações não salvas no modelo. Descartar?')){$('#md-model').value=M.key;return}
  $('#md-load').textContent='Carregando…';undo=[];sel=-1;
  const key=kind;let carId=null;if(kind.startsWith('car:')){carId=kind.slice(4);kind='car'}
  if(kind==='car'){const j=await E.api.json('cars/'+carId+'/car.json');M={kind,key,carId,json:j,parts:j.objs,paths:{vb:j.vb.$file,ib:j.ib.$file,dd:j.dd.$file,json:'cars/'+carId+'/car.json'},stride:24,colorOff:-1,uvOff:16,
    rng:p=>[p.start,p.count],set:(p,s,c)=>{p.start=s;p.count=c},name:p=>p.name}}
  else if(kind==='track'){const j=await E.api.json('data/trk.json');M={kind,key,json:j,parts:j.groups,paths:{vb:j.vb.$file,ib:j.ib.$file,json:'data/trk.json'},stride:28,colorOff:16,uvOff:20,
    rng:p=>[p.off,p.cnt],set:(p,s,c)=>{p.off=s;p.cnt=c},name:p=>(trkNames[p.tex]||'?')}}
  else{const j=await E.api.json('data/trophy.json'),T=j[kind];M={kind,key,json:j,sub:kind,parts:T.g,paths:{vb:T.vb.$file,ib:T.ib.$file,json:'data/trophy.json'},stride:24,colorOff:-1,uvOff:16,
    rng:p=>[p[0],p[1]],set:(p,s,c)=>{p[0]=s;p[1]=c},name:p=>({m:'metal',w:'madeira',d:'escuro'}[p[2]]||p[2])}}
  M.vb=new Uint8Array(await bin(M.paths.vb));M.ib=new Uint16Array(await bin(M.paths.ib));M.dd=M.paths.dd?new Uint8Array(await bin(M.paths.dd)):null;
  M.hidden=M.parts.map(()=>false);E.setDirty('modelo',false);
  $('#md-title').textContent=MODELS.find(m=>m[0]===key)[1];
  if(kind==='car'){E.fillSelect($('#md-skin'),M.json.skins.map(s=>[s.id,s.name]),M.json.skins[0].id)}
  const tr=kind==='track';$('#md-tex').parentElement.style.display=tr?'':'none';$('#md-cat').parentElement.style.display=tr?'':'none';$('#md-skin').style.display=kind==='car'?'':'none';const car=kind==='car';$('#md-name').parentElement.style.display=car?'':'none';$('#md-mat').parentElement.style.display=car?'':'none';$('#md-solidrow').style.display=tr?'':'none';$('#md-q').value='';
  $('#md-hint').textContent=tr?'Atenção: a colisão do carro usa assets/track/phy.*.bin e não muda com a malha visual. Peças novas aparecem, mas não são sólidas.':kind==='car'?'Pintura e rodas usam as texturas da aba Texturas.':'';
  V.texs.forEach(t=>V.gl.deleteTexture(t));V.texs.clear();
  V.setModel(buildModel());V.frame();list();select(-1);$('#md-load').textContent='';
  if(kind==='car'){const J=M.json;await loadCarSkin(true);await loadImg('wheel',J.wheel.$file);await loadImg('blur',J.blur.$file);for(const k of Object.keys(J.glass||{}))await loadImg(k,J.glass[k].$file)}
  else if(kind==='track')loadTrackTex();else await loadImg('wood','assets/trophy/wood.jpg');
}
async function loadImg(key,path){try{const b=await bin(path),bm=await createImageBitmap(new Blob([b],{type:E.mime(path)}));V.setTexImage(key,bm)}catch(e){console.warn(path,e)}}
async function loadCarSkin(){const s=M.json.skins.find(x=>x.id===$('#md-skin').value)||M.json.skins[0];await loadImg('body',s.file.$file)}
async function loadTrackTex(){const files=M.json.tex.map(t=>t.d.$file);let n=0;const tk=M;const q=files.map((f,i)=>async()=>{if(M!==tk)return;await loadImg('t'+i,f);n++;$('#md-load').textContent='Texturas '+n+'/'+files.length;if(n===files.length)$('#md-load').textContent=''});
  const w=async()=>{while(q.length&&M===tk)await q.shift()()};await Promise.all([w(),w(),w(),w(),w(),w()])}
function buildModel(){
  const ranges=M.parts.map((p,i)=>{const[s,c]=M.rng(p);let tex=null,alpha=false,color=[1,1,1,1];
    if(M.kind==='car'){tex=carTex(p);alpha=tex==='blur'||tex==='gls'||tex==='gtx'}else if(M.kind==='track'){tex='t'+p.tex;alpha=p.cat==='alpha'}else{const k=p[2];if(k==='w')tex='wood';else color=KIND_COL[k]||color}
    return{start:s,count:c,tex,alpha,color,off:M.kind==='car'?p.pos:null,hidden:M.hidden[i],hl:i===sel}});
  return{vb:M.vb,ib:M.ib,stride:M.stride,colorOff:M.colorOff,uvOff:M.uvOff,ranges}}
function refresh(reupload){const m=buildModel();if(reupload||V.model.vb!==M.vb||V.model.ib!==M.ib)V.setModel(m);else{V.model.ranges=m.ranges;V.req()}
  $('#md-info').textContent=(M.vb.length/M.stride)+' vértices · '+(M.ib.length/3|0)+' triângulos'+((M.vb.length/M.stride)>60000?' ⚠ perto do limite (65535)':'')}
function list(){const box=$('#md-list');box.innerHTML='';const q=$('#md-q').value.toLowerCase();
  M.parts.forEach((p,i)=>{if(q&&!String(M.name(p)).toLowerCase().includes(q))return;const[,c]=M.rng(p);const eye=E.el('span',{class:'eye',text:M.hidden[i]?'○':'●',title:'mostrar/ocultar'});
    const it=E.el('div',{class:'it'+(i===sel?' on':'')+(M.hidden[i]?' hid':'')},[E.el('span',{text:M.name(p)+(M.kind==='track'?' · '+p.cat[0]:'')}),E.el('small',{text:c?(c/3|0)+' tri':'excluída'}),eye]);
    eye.onclick=e=>{e.stopPropagation();M.hidden[i]=!M.hidden[i];refresh();list()};
    it.onclick=()=>select(i);it.ondblclick=()=>{const b=V.bounds([{start:M.rng(p)[0],count:c}]);if(b)V.frame([{start:M.rng(p)[0],count:c}])};box.append(it)});
  refresh()}
function select(i){sel=i;M.parts.length&&refresh();E.$$('#md-list .it').forEach((e,k)=>e.classList.toggle('on',k===i));
  const el=E.$$('#md-list .it')[i];if(el)el.scrollIntoView({block:'nearest'});
  if(i<0){$('#md-sel').textContent='nenhuma';$('#md-selinfo').textContent='Clique numa peça no 3D ou na lista. Duplo clique no 3D = novo centro da câmera.';return}
  const p=M.parts[i],[s,c]=M.rng(p),b=V.bounds([{start:s,count:c}]);$('#md-sel').textContent=M.name(p);
  $('#md-selinfo').textContent=b?`${vertsOf(i).length} vértices · tamanho ${(b.mx[0]-b.mn[0]).toFixed(2)} × ${(b.mx[1]-b.mn[1]).toFixed(2)} × ${(b.mx[2]-b.mn[2]).toFixed(2)} · centro ${b.c.map(v=>v.toFixed(2)).join(', ')}`:'peça vazia';
  if(M.kind==='track'){$('#md-tex').value=p.tex;$('#md-cat').value=p.cat}
  if(M.kind==='car'){$('#md-name').value=p.name;$('#md-mat').value=['body','wheel','gls','gtx'].includes(p.tex)?p.tex:''}}
const nv=()=>M.vb.length/M.stride;
function vertsOf(i){const[s,c]=M.rng(M.parts[i]),seen=new Uint8Array(nv()),o=[];for(let k=s;k<s+c;k++){const v=M.ib[k];if(!seen[v]){seen[v]=1;o.push(v)}}return o}
function snap(){undo.push({vb:M.vb.slice(),ib:M.ib.slice(),dd:M.dd?M.dd.slice():null,json:JSON.stringify(M.json),hidden:M.hidden.slice()});if(undo.length>12)undo.shift()}
function doUndo(){const s=undo.pop();if(!s)return;M.vb=s.vb;M.ib=s.ib;M.dd=s.dd;const j=JSON.parse(s.json);Object.assign(M.json,j);
  M.parts=M.kind==='car'?M.json.objs:M.kind==='track'?M.json.groups:M.json[M.sub].g;M.hidden=s.hidden;sel=Math.min(sel,M.parts.length-1);list();refresh(true);select(sel)}
function edited(){E.setDirty('modelo',true)}
function isolate(i){const[s,c]=M.rng(M.parts[i]),n=nv(),out=new Uint8Array(n);
  M.parts.forEach((p,j)=>{if(j===i)return;const[ps,pc]=M.rng(p);for(let k=ps;k<ps+pc;k++)out[M.ib[k]]=1});
  const map=new Map();for(let k=s;k<s+c;k++){const v=M.ib[k];if(out[v]){let id=map.get(v);if(id===undefined){id=n+map.size;map.set(v,id)}M.ib[k]=id}}
  if(!map.size)return;if(n+map.size>65535)throw new Error('Limite de 65535 vértices excedido (vértices compartilhados teriam que ser duplicados).');
  const st=M.stride,nvb=new Uint8Array((n+map.size)*st);nvb.set(M.vb);for(const[v,id]of map)nvb.copyWithin(id*st,v*st,v*st+st);
  // copyWithin acima copia dentro do mesmo array: usa o original ainda intacto em [0,n)
  M.vb=nvb;if(M.dd){const nd=new Uint8Array((n+map.size)*4);nd.set(M.dd);for(const[v,id]of map)nd.copyWithin(id*4,v*4,v*4+4);M.dd=nd}}
function rotM(rx,ry,rz){const a=rx*Math.PI/180,b=ry*Math.PI/180,c=rz*Math.PI/180,ca=Math.cos(a),sa=Math.sin(a),cb=Math.cos(b),sb=Math.sin(b),cc=Math.cos(c),sc=Math.sin(c);
  return[[cb*cc,sa*sb*cc-ca*sc,ca*sb*cc+sa*sc],[cb*sc,sa*sb*sc+ca*cc,ca*sb*sc-sa*cc],[-sb,sa*cb,ca*cb]]}
function xform(vs,t,r,s,pv,flip,rangeIdx){const R=rotM(...r),F=new Float32Array(M.vb.buffer),I8=new Int8Array(M.vb.buffer),S=M.stride>>2;
  for(const v of vs){const o=v*S;let x=(F[o]-pv[0])*s[0],y=(F[o+1]-pv[1])*s[1],z=(F[o+2]-pv[2])*s[2];
    F[o]=R[0][0]*x+R[0][1]*y+R[0][2]*z+pv[0]+t[0];F[o+1]=R[1][0]*x+R[1][1]*y+R[1][2]*z+pv[1]+t[1];F[o+2]=R[2][0]*x+R[2][1]*y+R[2][2]*z+pv[2]+t[2];
    const bo=v*M.stride+12;let nx=I8[bo]/127/s[0],ny=I8[bo+1]/127/s[1],nz=I8[bo+2]/127/s[2];
    let a=R[0][0]*nx+R[0][1]*ny+R[0][2]*nz,b=R[1][0]*nx+R[1][1]*ny+R[1][2]*nz,c=R[2][0]*nx+R[2][1]*ny+R[2][2]*nz;const l=Math.hypot(a,b,c)||1;
    I8[bo]=Math.round(a/l*127);I8[bo+1]=Math.round(b/l*127);I8[bo+2]=Math.round(c/l*127)}
  if(flip&&rangeIdx!==undefined){const[st,c]=M.rng(M.parts[rangeIdx]);for(let k=st;k<st+c;k+=3){const tmp=M.ib[k+1];M.ib[k+1]=M.ib[k+2];M.ib[k+2]=tmp}}}
function readX(){const g=ids=>ids.map(id=>E.num($('#'+id)));return{t:g(['m-tx','m-ty','m-tz']),r:g(['m-rx','m-ry','m-rz']),s:g(['m-sx','m-sy','m-sz']).map(v=>v||1)}}
function applyX(){if(sel<0)return E.toast('Selecione uma peça',true);const{t,r,s}=readX();snap();isolate(sel);const vs=vertsOf(sel),[st,c]=M.rng(M.parts[sel]);
  let pv=[0,0,0];if($('#m-piv').checked){const b=bnd(vs);pv=b.c}
  xform(vs,t,r,s,pv,s[0]*s[1]*s[2]<0,sel);V.setModel(buildModel());edited();select(sel);E.toast('Transformação aplicada (salve para gravar)')}
function bnd(vs){const F=new Float32Array(M.vb.buffer),S=M.stride>>2,mn=[1e30,1e30,1e30],mx=[-1e30,-1e30,-1e30];for(const v of vs)for(let a=0;a<3;a++){const x=F[v*S+a];mn[a]=Math.min(mn[a],x);mx[a]=Math.max(mx[a],x)}return{mn,mx,c:mn.map((v,i)=>(v+mx[i])/2)}}
function meshOf(i){const[s,c]=M.rng(M.parts[i]),F=new Float32Array(M.vb.buffer),I8=new Int8Array(M.vb.buffer),S=M.stride>>2,map=new Map(),m={p:[],n:[],uv:[],idx:[]};
  for(let k=s;k<s+c;k++){const v=M.ib[k];let id=map.get(v);if(id===undefined){id=map.size;map.set(v,id);const o=v*S;m.p.push(F[o],F[o+1],F[o+2]);m.n.push(I8[v*M.stride+12]/127,I8[v*M.stride+13]/127,I8[v*M.stride+14]/127);m.uv.push(F[v*S+(M.uvOff>>2)],F[v*S+(M.uvOff>>2)+1])}m.idx.push(id)}return m}
function dupe(){if(sel<0)return E.toast('Selecione uma peça',true);const m=meshOf(sel),{t,r,s}=readX(),R=rotM(...r);
  const cx=[0,0,0];for(let i=0;i<m.p.length;i+=3)for(let a=0;a<3;a++)cx[a]+=m.p[i+a]/(m.p.length/3);const pv=$('#m-piv').checked?cx:[0,0,0];
  for(let i=0;i<m.p.length;i+=3){const x=(m.p[i]-pv[0])*s[0],y=(m.p[i+1]-pv[1])*s[1],z=(m.p[i+2]-pv[2])*s[2];m.p[i]=R[0][0]*x+R[0][1]*y+R[0][2]*z+pv[0]+t[0];m.p[i+1]=R[1][0]*x+R[1][1]*y+R[1][2]*z+pv[1]+t[1];m.p[i+2]=R[2][0]*x+R[2][1]*y+R[2][2]*z+pv[2]+t[2];
    const nx=m.n[i]/s[0],ny=m.n[i+1]/s[1],nz=m.n[i+2]/s[2];m.n[i]=R[0][0]*nx+R[0][1]*ny+R[0][2]*nz;m.n[i+1]=R[1][0]*nx+R[1][1]*ny+R[1][2]*nz;m.n[i+2]=R[2][0]*nx+R[2][1]*ny+R[2][2]*nz}
  if(s[0]*s[1]*s[2]<0)for(let k=0;k<m.idx.length;k+=3){const tmp=m.idx[k+1];m.idx[k+1]=m.idx[k+2];m.idx[k+2]=tmp}
  const p=M.parts[sel];addMesh(m,{name:(M.name(p)||'peca')+'_copia',tex:p.tex,cat:p.cat,kind:p[2],pos:p.pos})}
function prepSel(){if(sel<0)throw new Error('Selecione uma peça');snap();isolate(sel);return vertsOf(sel)}
function flipWind(i){const[st,c]=M.rng(M.parts[i]);for(let k=st;k+2<st+c;k+=3){const t=M.ib[k+1];M.ib[k+1]=M.ib[k+2];M.ib[k+2]=t}}
function mirror(axis){const vs=prepSel(),pv=$('#m-piv').checked?bnd(vs).c[axis]:0,F=new Float32Array(M.vb.buffer),I8=new Int8Array(M.vb.buffer),S=M.stride>>2;
  for(const v of vs){F[v*S+axis]=2*pv-F[v*S+axis];const o=v*M.stride+12+axis;I8[o]=Math.max(-127,-I8[o])}
  if(M.dd){const d8=new Int8Array(M.dd.buffer);for(const v of vs)d8[v*4+axis]=Math.max(-127,-d8[v*4+axis])}
  flipWind(sel);V.setModel(buildModel());edited();select(sel);E.toast('Peça espelhada')}
function flipFaces(){const vs=prepSel(),I8=new Int8Array(M.vb.buffer);for(const v of vs)for(let a=0;a<3;a++){const o=v*M.stride+12+a;I8[o]=Math.max(-127,-I8[o])}
  if(M.dd){const d8=new Int8Array(M.dd.buffer);for(const v of vs)for(let a=0;a<3;a++)d8[v*4+a]=Math.max(-127,-d8[v*4+a])}
  flipWind(sel);V.setModel(buildModel());edited();select(sel);E.toast('Faces/normais invertidas')}
function toGround(){const vs=prepSel(),b=bnd(vs);xform(vs,[0,-b.mn[1],0],[0,0,0],[1,1,1],[0,0,0],false);V.setModel(buildModel());edited();select(sel)}
async function makeSolid(){if(M.kind!=='track'||sel<0)throw new Error('Selecione uma peça da pista');const m=meshOf(sel),pos=[];
  for(const k of m.idx)pos.push(m.p[k*3],m.p[k*3+1],m.p[k*3+2]);const n=await E.phy.appendTris(pos,+$('#md-solidsurf').value);E.toast(n+' triângulos adicionados à colisão e salvos (aba Colisão)')}
function del(){if(sel<0)return;snap();const p=M.parts[sel],[s]=M.rng(p);M.set(p,s,0);edited();list();select(sel);refresh()}
function addMesh(m,o){const n=m.p.length/3,n0=nv(),st=M.stride;if(n0+n>65535)throw new Error('Limite de 65535 vértices: não cabe mais geometria neste modelo.');
  snap();const nvb=new Uint8Array((n0+n)*st);nvb.set(M.vb);const dv=new DataView(nvb.buffer);
  for(let v=0;v<n;v++){const off=(n0+v)*st;dv.setFloat32(off,m.p[v*3],true);dv.setFloat32(off+4,m.p[v*3+1],true);dv.setFloat32(off+8,m.p[v*3+2],true);
    const nl=Math.hypot(m.n[v*3],m.n[v*3+1],m.n[v*3+2])||1;for(let a=0;a<3;a++)dv.setInt8(off+12+a,Math.round(m.n[v*3+a]/nl*127));
    if(M.colorOff>=0){for(let a=0;a<4;a++)dv.setUint8(off+M.colorOff+a,255)}
    dv.setFloat32(off+M.uvOff,m.uv[v*2],true);dv.setFloat32(off+M.uvOff+4,m.uv[v*2+1],true)}
  if(M.dd){const nd=new Uint8Array((n0+n)*4);nd.set(M.dd);for(let v=0;v<n;v++)for(let a=0;a<3;a++)nd[(n0+v)*4+a]=nvb[(n0+v)*st+12+a];M.dd=nd}
  const st0=M.ib.length,nib=new Uint16Array(st0+m.idx.length);nib.set(M.ib);for(let k=0;k<m.idx.length;k++)nib[st0+k]=m.idx[k]+n0;M.vb=nvb;M.ib=nib;
  const cnt=m.idx.length;
  if(M.kind==='car')M.parts.push({name:o.name||'MSH-Novo',pos:o.pos?o.pos.slice():[0,0,0],fv:n0,nv:n,start:st0,count:cnt,mat:'carmetal'});
  else if(M.kind==='track')M.parts.push({tex:o.tex!==undefined?+o.tex:+$('#md-tex').value||0,cat:o.cat||$('#md-cat').value||'opaque',off:st0,cnt});
  else M.parts.push([st0,cnt,o.kind||'m']);
  M.hidden.push(false);edited();V.setModel(buildModel());list();select(M.parts.length-1)}
function prim(kind,w,h,d,uvs){const m={p:[],n:[],uv:[],idx:[]};const quad=(a,b,c,dd,n,uw,uh)=>{const i=m.p.length/3;[a,b,c,dd].forEach(p=>{m.p.push(...p);m.n.push(...n)});m.uv.push(0,uh*uvs,uw*uvs,uh*uvs,uw*uvs,0,0,0);m.idx.push(i,i+1,i+2,i,i+2,i+3)};
  const x=w/2,y=h/2,z=d/2;
  if(kind==='plane'){quad([-x,0,z],[x,0,z],[x,0,-z],[-x,0,-z],[0,1,0],w,d)}
  else if(kind==='box'){quad([-x,-y,z],[x,-y,z],[x,y,z],[-x,y,z],[0,0,1],w,h);quad([x,-y,-z],[-x,-y,-z],[-x,y,-z],[x,y,-z],[0,0,-1],w,h);
    quad([x,-y,z],[x,-y,-z],[x,y,-z],[x,y,z],[1,0,0],d,h);quad([-x,-y,-z],[-x,-y,z],[-x,y,z],[-x,y,-z],[-1,0,0],d,h);
    quad([-x,y,z],[x,y,z],[x,y,-z],[-x,y,-z],[0,1,0],w,d);quad([-x,-y,-z],[x,-y,-z],[x,-y,z],[-x,-y,z],[0,-1,0],w,d)}
  else if(kind==='ramp'){const tri=(a,b,c,n)=>{const i=m.p.length/3;[a,b,c].forEach(p=>{m.p.push(...p);m.n.push(...n)});m.uv.push(0,d*uvs,w*uvs,d*uvs,0,0);m.idx.push(i,i+1,i+2)};
    const L=Math.hypot(d,h)||1;quad([-x,-y,-z],[x,-y,-z],[x,-y,z],[-x,-y,z],[0,-1,0],w,d);quad([-x,-y,z],[x,-y,z],[x,y,-z],[-x,y,-z],[0,h/L,d/L],w,L);
    quad([x,-y,-z],[-x,-y,-z],[-x,y,-z],[x,y,-z],[0,0,-1],w,h);tri([-x,-y,-z],[-x,-y,z],[-x,y,-z],[-1,0,0]);tri([x,-y,z],[x,-y,-z],[x,y,-z],[1,0,0])}
  else{const N=20;for(let i=0;i<N;i++){const a0=i/N*Math.PI*2,a1=(i+1)/N*Math.PI*2,c0=Math.cos(a0),s0=Math.sin(a0),c1=Math.cos(a1),s1=Math.sin(a1),r=w/2;
    const base=m.p.length/3;m.p.push(c0*r,-y,s0*r,c1*r,-y,s1*r,c1*r,y,s1*r,c0*r,y,s0*r);m.n.push(c0,0,s0,c1,0,s1,c1,0,s1,c0,0,s0);
    const u0=i/N*Math.PI*w*uvs,u1=(i+1)/N*Math.PI*w*uvs;m.uv.push(u0,h*uvs,u1,h*uvs,u1,0,u0,0);m.idx.push(base,base+1,base+2,base,base+2,base+3);
    const b2=m.p.length/3;m.p.push(0,y,0,c0*r,y,s0*r,c1*r,y,s1*r);m.n.push(0,1,0,0,1,0,0,1,0);m.uv.push(.5,.5,.5+c0*.5,.5+s0*.5,.5+c1*.5,.5+s1*.5);m.idx.push(b2,b2+2,b2+1)}}
  return m}
function addPrim(){const k=$('#ad-kind').value,w=E.num($('#ad-w'),2),h=E.num($('#ad-h'),2),d=E.num($('#ad-d'),2),uvs=E.num($('#ad-uv'),1)||1,m=prim(k,w,h,d,uvs);
  const c=V.cam,pos=$('#ad-cam').checked?[c.tx,c.ty+(k==='plane'?0:h/2),c.tz]:['ad-x','ad-y','ad-z'].map(id=>E.num($('#'+id)));
  for(let i=0;i<m.p.length;i+=3){m.p[i]+=pos[0];m.p[i+1]+=pos[1];m.p[i+2]+=pos[2]}addMesh(m,{name:'MSH-Prim_'+k})}
async function impObj(f){const txt=await f.text(),sc=E.num($('#ob-s'),1)||1,fv=$('#ob-fv').checked,P=[],T=[],N=[],m={p:[],n:[],uv:[],idx:[]},map=new Map();
  const get=(arr,i,w)=>{i=parseInt(i);if(i<0)i=arr.length/w+i+1;return i-1};
  for(const line of txt.split(/\r?\n/)){const a=line.trim().split(/\s+/);if(a[0]==='v')P.push(+a[1],+a[2],+a[3]);else if(a[0]==='vt')T.push(+a[1],+a[2]);else if(a[0]==='vn')N.push(+a[1],+a[2],+a[3]);
    else if(a[0]==='f'){const ids=[];for(const tok of a.slice(1)){const[vi,ti,ni]=tok.split('/'),key=tok,pi=get(P,vi,3);let id=map.get(key);
        if(id===undefined){id=m.p.length/3;map.set(key,id);m.p.push(P[pi*3]*sc,P[pi*3+1]*sc,P[pi*3+2]*sc);
          if(ti){const t=get(T,ti,2);m.uv.push(T[t*2],fv?1-T[t*2+1]:T[t*2+1])}else m.uv.push(0,0);
          if(ni){const n=get(N,ni,3);m.n.push(N[n*3],N[n*3+1],N[n*3+2])}else m.n.push(0,0,0)}ids.push(id)}
      for(let i=1;i+1<ids.length;i++)m.idx.push(ids[0],ids[i],ids[i+1])}}
  if(!m.idx.length)throw new Error('OBJ sem faces');
  for(let k=0;k<m.idx.length;k+=3){const[a,b,c]=[m.idx[k],m.idx[k+1],m.idx[k+2]];if(m.n[a*3]===0&&m.n[a*3+1]===0&&m.n[a*3+2]===0){
    const u=[0,1,2].map(i=>m.p[b*3+i]-m.p[a*3+i]),v=[0,1,2].map(i=>m.p[c*3+i]-m.p[a*3+i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];for(const q of[a,b,c])if(m.n[q*3]===0&&m.n[q*3+1]===0&&m.n[q*3+2]===0)m.n.splice(q*3,3,...n)}}
  addMesh(m,{name:'MSH-'+f.name.replace(/\.obj$/i,'')});E.toast('OBJ importado: '+m.p.length/3+' vértices, '+m.idx.length/3+' triângulos')}
function expObj(){let ids=sel>=0?[sel]:M.parts.map((_,i)=>i).filter(i=>!M.hidden[i]&&M.rng(M.parts[i])[1]);const out=['# XB Adelaide '+M.kind];let off=1;
  for(const i of ids){const m=meshOf(i);out.push('o '+M.name(M.parts[i]).replace(/\s/g,'_')+'_'+i);
    for(let k=0;k<m.p.length;k+=3)out.push(`v ${m.p[k]} ${m.p[k+1]} ${m.p[k+2]}`);for(let k=0;k<m.uv.length;k+=2)out.push(`vt ${m.uv[k]} ${1-m.uv[k+1]}`);for(let k=0;k<m.n.length;k+=3)out.push(`vn ${m.n[k]} ${m.n[k+1]} ${m.n[k+2]}`);
    for(let k=0;k<m.idx.length;k+=3){const f=[0,1,2].map(j=>{const n=m.idx[k+j]+off;return n+'/'+n+'/'+n});out.push('f '+f.join(' '))}off+=m.p.length/3}
  E.download(M.kind+(sel>=0?'_'+M.name(M.parts[sel]):'')+'.obj',out.join('\n'),'text/plain')}
async function save(){if(!M)return;const P=M.paths;await E.api.save(P.vb,M.vb);await E.api.save(P.ib,M.ib);if(P.dd)await E.api.save(P.dd,M.dd);
  const fresh=await E.api.json(P.json);if(M.kind==='car')fresh.objs=M.json.objs;else if(M.kind==='track')fresh.groups=M.json.groups;else fresh[M.sub].g=M.json[M.sub].g;await E.jsonSave(P.json,fresh);
  E.setDirty('modelo',false);E.toast('Modelo salvo — recarregue o jogo para ver ('+P.json+')')}
})();
