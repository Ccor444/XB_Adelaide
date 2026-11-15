"use strict";
const $=id=>document.getElementById(id);
const clamp=(x,a,b)=>x<a?a:x>b?b:x, lerp=(a,b,t)=>a+(b-a)*t;
const wrapPI=a=>{while(a>Math.PI)a-=2*Math.PI;while(a<-Math.PI)a+=2*Math.PI;return a};

/* ================= 1. Matemática ================= */
const M4={
  mul(a,b){const o=new Float32Array(16);
    for(let c=0;c<4;c++)for(let r=0;r<4;r++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];o[c*4+r]=s}return o},
  persp(fov,asp,n,f){const t=1/Math.tan(fov/2),nf=1/(n-f);
    return new Float32Array([t/asp,0,0,0, 0,t,0,0, 0,0,(f+n)*nf,-1, 0,0,2*f*n*nf,0])},
  look(e,c,u){let z=[e[0]-c[0],e[1]-c[1],e[2]-c[2]];let l=Math.hypot(...z);z=z.map(v=>v/l);
    let x=[u[1]*z[2]-u[2]*z[1],u[2]*z[0]-u[0]*z[2],u[0]*z[1]-u[1]*z[0]];l=Math.hypot(...x);x=x.map(v=>v/l);
    const y=[z[1]*x[2]-z[2]*x[1],z[2]*x[0]-z[0]*x[2],z[0]*x[1]-z[1]*x[0]];
    return {m:new Float32Array([x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0,
      -(x[0]*e[0]+x[1]*e[1]+x[2]*e[2]),-(y[0]*e[0]+y[1]*e[1]+y[2]*e[2]),-(z[0]*e[0]+z[1]*e[1]+z[2]*e[2]),1]),r:x,u:y,f:[-z[0],-z[1],-z[2]]}},
  rotX(a){const c=Math.cos(a),s=Math.sin(a);return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1])},
  rotY(a){const c=Math.cos(a),s=Math.sin(a);return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1])},
  trans(x,y,z){return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1])},
  basis(r,u,f,p){return new Float32Array([r[0],r[1],r[2],0, u[0],u[1],u[2],0, f[0],f[1],f[2],0, p[0],p[1],p[2],1])},
  flipZ(m){m[2]=-m[2];m[6]=-m[6];m[10]=-m[10];m[14]=-m[14];return m}
};
// O mundo do jogo usa a mão esquerda (Direct3D) e Z para a frente. Ao desenhar, Z é espelhado.
const IDENT_FLIP=M4.flipZ(new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]));

/* ================= 2. WebGL ================= */
const canvas=$('gl');
const COARSE=!!(window.matchMedia&&matchMedia('(pointer:coarse)').matches);   // celular/tablet: sem MSAA (caro em GPU móvel), anisotropia menor
const gl=canvas.getContext('webgl2',{antialias:!COARSE,alpha:false,powerPreference:'high-performance'});
if(!gl){$('load').textContent='Este navegador não suporta WebGL2. Abra em um navegador atualizado.';throw new Error('no webgl2')}
/* ---- Desempenho: níveis de qualidade (0 = máximo ... 4 = mínimo) + governador automático (ver frame()). Valores = teto; os dados em data/*.json continuam valendo se forem menores. ---- */
const TIERS=[ // rs=escala de resolução, cap/near=pedestres, hfar=casas, lodK=distâncias de LOD (menor = LOD mais cedo), tfar=árvores, gq=grama
  {rs:1.00,cap:140,near:75,hfar:1100,lodK:1.00,tfar:520,gq:1.00},
  {rs:.90,cap:100,near:60,hfar:900,lodK:.80,tfar:420,gq:.80},
  {rs:.80,cap:70,near:50,hfar:700,lodK:.65,tfar:320,gq:.60},
  {rs:.70,cap:45,near:40,hfar:550,lodK:.50,tfar:250,gq:.45},
  {rs:.60,cap:30,near:35,hfar:450,lodK:.40,tfar:200,gq:.30}];
const Q={tier:0,rs:1,lodK:1,mode:'auto'};   // mode: 'auto' | 0..4 (fixo)
const FR=new Float32Array(20);   // 5 planos do frustum (normal GL + d)
function setFrustum(m){const r=i=>[m[i],m[4+i],m[8+i],m[12+i]],r0=r(0),r1=r(1),r2=r(2),r3=r(3),L=[[1,r0],[-1,r0],[1,r1],[-1,r1],[1,r2]];
  L.forEach(([sg,q],k)=>{const a=r3[0]+sg*q[0],b=r3[1]+sg*q[1],c=r3[2]+sg*q[2],d=r3[3]+sg*q[3],l=Math.hypot(a,b,c)||1;FR[k*4]=a/l;FR[k*4+1]=b/l;FR[k*4+2]=c/l;FR[k*4+3]=d/l})}
function inFr(x,y,z,r){for(let k=0;k<20;k+=4)if(FR[k]*x+FR[k+1]*y+FR[k+2]*z+FR[k+3]<-r)return false;return true}   // esfera (coordenadas GL)
function program(vs,fs){
  if(/fogMix|u_fogC/.test(fs))fs=fs.replace(/(precision\s+\w+\s+float;)/,'$1\n'+FOGDECL);
  if(/acov\(/.test(fs))fs=fs.replace(/(precision\s+\w+\s+float;)/,'$1\n'+ACOV);
  const mk=(t,src)=>{const s=gl.createShader(t);gl.shaderSource(s,src);gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s)+src.slice(0,80));return s};
  const p=gl.createProgram();gl.attachShader(p,mk(gl.VERTEX_SHADER,vs));gl.attachShader(p,mk(gl.FRAGMENT_SHADER,fs));
  gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));
  {const bi=gl.getUniformBlockIndex(p,'Fog');if(bi!==gl.INVALID_INDEX)gl.uniformBlockBinding(p,bi,0)}
  const u={};const n=gl.getProgramParameter(p,gl.ACTIVE_UNIFORMS);
  for(let i=0;i<n;i++){const nm=gl.getActiveUniform(p,i).name;u[nm.replace('[0]','')]=gl.getUniformLocation(p,nm)}
  return {p,u}}
/* ---- Névoa/clima: um bloco de uniformes (UBO, binding 0) lido por todos os shaders que usam fogMix(). start/end em metros; máximo de mistura; liga a mistura do céu.
   Valores vêm de data/timecyc.json (timecyc.dat do GTA SA) + data/fog.json; "Clássico" = névoa antiga fixa. ---- */
const FOG='u_fogC.rgb';
const FOGDECL=`layout(std140) uniform Fog{vec4 u_fogC;vec4 u_fogR;};
vec3 fogMixS(vec3 c,float d,float k){return mix(c,u_fogC.rgb,smoothstep(u_fogR.x*k,u_fogR.y*k,d)*u_fogR.z);}
vec3 fogMix(vec3 c,float d){return fogMixS(c,d,1.);}`;
const ACOV=`float acov(sampler2D s,vec2 uv,float a){vec2 q=uv*vec2(textureSize(s,0));vec2 dx=dFdx(q),dy=dFdy(q);float l=max(0.,.5*log2(max(max(dot(dx,dx),dot(dy,dy)),1e-6)));return a*(1.+.45*min(l,4.));}`;
const fogBuf=gl.createBuffer();gl.bindBuffer(gl.UNIFORM_BUFFER,fogBuf);gl.bufferData(gl.UNIFORM_BUFFER,32,gl.DYNAMIC_DRAW);gl.bindBufferBase(gl.UNIFORM_BUFFER,0,fogBuf);
const FOG_CLASSIC={c:[.66,.72,.77],s:160,e:1300,m:.9,sky:0};
function fogSet(f){gl.bindBuffer(gl.UNIFORM_BUFFER,fogBuf);gl.bufferSubData(gl.UNIFORM_BUFFER,0,new Float32Array([f.c[0],f.c[1],f.c[2],0,f.s,f.e,f.m,f.sky]))}
fogSet(FOG_CLASSIC);
const EQ=`vec2 eq(vec3 d){return vec2(atan(d.x,-d.z)/6.2831853+.5,.5-asin(clamp(d.y,-1.,1.))/3.1415927);}`;

const skyP=program(`#version 300 es
out vec2 v_n;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);v_n=p*2.-1.;gl_Position=vec4(v_n,1.,1.);}`,
`#version 300 es
precision highp float;in vec2 v_n;out vec4 o;uniform sampler2D u_sky;uniform vec3 u_r,u_u,u_f;uniform vec2 u_t;
${EQ}
void main(){vec3 d=normalize(u_f+v_n.x*u_t.x*u_r+v_n.y*u_t.y*u_u);
 vec3 c=textureLod(u_sky,eq(d),0.).rgb*1.04;
 float K=clamp(1.-u_fogR.y/1700.,0.,1.)*u_fogR.z;
 float hz=pow(1.-clamp(d.y,0.,1.),mix(9.,1.6,K));
 float w=clamp(max(hz*(.3+.7*K),K*K*.85),0.,1.)*u_fogR.w;
 o=vec4(mix(c,u_fogC.rgb,w),1.);}`);

const trkP=program(`#version 300 es
layout(location=0) in vec3 a_pos;layout(location=1) in vec3 a_nrm;layout(location=2) in vec4 a_col;layout(location=3) in vec2 a_uv;
uniform mat4 u_vp;uniform vec3 u_eye;out vec2 v_uv;out vec4 v_col;out float v_d;out vec3 v_w;
void main(){vec3 w=vec3(a_pos.xy,-a_pos.z);v_w=w;gl_Position=u_vp*vec4(w,1.);v_uv=a_uv;v_col=a_col;v_d=length(w-u_eye);}`,
`#version 300 es
precision highp float;in vec2 v_uv;in vec4 v_col;in float v_d;in vec3 v_w;out vec4 o;
uniform sampler2D u_tex;uniform float u_gain;uniform int u_mode;uniform vec4 u_sp[4];uniform vec4 u_sd[4];
uniform highp sampler2DShadow u_sm;uniform mat4 u_sM;uniform float u_shOn;
float shadowAt(vec3 w,float bias){vec3 q=(u_sM*vec4(w,1.)).xyz*.5+.5;
 if(q.x<0.||q.x>1.||q.y<0.||q.y>1.||q.z>1.)return 0.;
 float e=min(min(q.x,1.-q.x),min(q.y,1.-q.y)),fd=smoothstep(0.,.08,e),s=0.;
 for(int i=-1;i<=1;i++)for(int j=-1;j<=1;j++)s+=texture(u_sm,vec3(q.xy+vec2(float(i),float(j))*(1.3/2048.),q.z-bias));
 return (1.-s/9.)*fd;}
void main(){vec4 t=texture(u_tex,v_uv);
 if(u_mode==2){o=vec4(0.,0.,0.,t.a*.9);return;}
 if(u_mode==1&&acov(u_tex,v_uv,t.a)<.5)discard;
 if(u_mode==3){float L=dot(t.rgb,vec3(.3,.59,.11));t.rgb=mix(vec3(.40,.50,.19)*(.55+.9*L),t.rgb,.38);}   // chão de grama: menos contraste, combina com o gramado 3D
 vec3 c=t.rgb*v_col.rgb*u_gain;
 if(u_mode!=1){
  if(u_shOn>0.)c*=1.-.5*shadowAt(v_w,.0012);
  for(int i=0;i<4;i++){if(u_sp[i].w<=0.)continue;vec3 d=v_w-u_sp[i].xyz;float L=length(d);float ca=dot(d/L,u_sd[i].xyz);   // faróis: cone no chão
   float k=smoothstep(.86,.97,ca)*u_sp[i].w/(1.+L*L/340.);c+=vec3(1.,.92,.74)*k*t.rgb*1.5;}}
 vec3 ov=max(c-.62,0.);c=min(c,vec3(.62))+.38*(1.-exp(-ov/.38)); // ombro suave: mantém detalhe nas áreas claras
 o=vec4(fogMix(c,v_d),1.);}`);

const DENT_NOISE=`float h31(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float vn3(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
 return mix(mix(mix(h31(i),h31(i+vec3(1.,0.,0.)),f.x),mix(h31(i+vec3(0.,1.,0.)),h31(i+vec3(1.,1.,0.)),f.x),f.y),
            mix(mix(h31(i+vec3(0.,0.,1.)),h31(i+vec3(1.,0.,1.)),f.x),mix(h31(i+vec3(0.,1.,1.)),h31(i+vec3(1.,1.,1.)),f.x),f.y),f.z);}`;
// Amassado: cada batida vira um "dent" (posição local, direção do impacto, profundidade, raio).
// A deformação é uma curva suave (gaussiana anisotrópica) com ondulação de baixa frequência — sem ruído por vértice.
const carP=program(`#version 300 es
layout(location=0) in vec3 a_pos;layout(location=1) in vec3 a_nrm;layout(location=3) in vec2 a_uv;layout(location=4) in vec3 a_d;
uniform mat4 u_vp,u_model;uniform vec4 u_dp[8];uniform vec4 u_dd[8];uniform float u_dmgOn;
out vec3 v_n,v_w,v_lp;out vec2 v_uv;out float v_dent;
${DENT_NOISE}
void main(){
 vec3 p=a_pos,n=normalize(a_nrm),gH=vec3(0.);float dent=0.;
 if(u_dmgOn>.5){
  for(int i=0;i<8;i++){
   float A=u_dd[i].w;if(A<=.001)continue;
   vec3 dir=u_dd[i].xyz;float s=u_dp[i].w;vec3 q=a_pos-u_dp[i].xyz;
   vec3 t=normalize(vec3(-dir.z,0.,dir.x)+vec3(1e-4,0.,0.));vec3 v=cross(dir,t);
   float sn=s*1.2,st=s*1.7,sv=s*1.05;
   float qn=dot(q,dir),qt=dot(q,t),qv=dot(q,v);
   float e=qn*qn/(sn*sn)+qt*qt/(st*st)+qv*qv/(sv*sv);
   if(e>4.)continue;
   float g=(exp(-e)-.0183)/.9817;
   float m=.92+.16*vn3(a_pos*3.+float(i)*7.3);
   float amp=A*g*m;
   p+=dir*amp-(t*qt+v*qv)*(.4*amp/s);
   dent+=amp;
   gH+=dot(n,dir)*(-2.*amp)*(qn/(sn*sn)*dir+qt/(st*st)*t+qv/(sv*sv)*v);
  }
  n=normalize(n-(gH-n*dot(n,gH)));
 }
 vec4 w=u_model*vec4(p,1.);v_w=w.xyz;v_n=mat3(u_model)*n;v_uv=a_uv;v_lp=a_pos;v_dent=dent/.2;gl_Position=u_vp*w;}`,
`#version 300 es
precision highp float;in vec3 v_n,v_w,v_lp;in vec2 v_uv;in float v_dent;out vec4 o;
uniform sampler2D u_tex,u_sky;uniform mat4 u_model;uniform vec3 u_cam,u_sun,u_emis;uniform float u_refl,u_spec,u_alpha,u_cut,u_cuty;
uniform highp sampler2DShadow u_sm;uniform mat4 u_sM;uniform float u_shOn;
float shadowAt(vec3 w,float bias){vec3 q=(u_sM*vec4(w,1.)).xyz*.5+.5;
 if(q.x<0.||q.x>1.||q.y<0.||q.y>1.||q.z>1.)return 0.;
 float e=min(min(q.x,1.-q.x),min(q.y,1.-q.y)),fd=smoothstep(0.,.08,e),s=0.;
 for(int i=-1;i<=1;i++)for(int j=-1;j<=1;j++)s+=texture(u_sm,vec3(q.xy+vec2(float(i),float(j))*(1.3/2048.),q.z-bias));
 return (1.-s/9.)*fd;}
${EQ}
${DENT_NOISE}
void main(){
 if(v_lp.z<u_cut||v_lp.y<u_cuty)discard;
 vec4 t=texture(u_tex,v_uv);vec3 alb=pow(t.rgb,vec3(2.2));
 vec3 N=normalize(v_n);if(!gl_FrontFacing)N=-N;
 float dn=clamp(v_dent,0.,1.);
 if(dn>.02){
  // micro-vincos do metal amassado + tinta lascada/arranhada
  vec3 lp=v_lp*6.;float c=vn3(lp),e=.15;
  vec3 gr=vec3(vn3(lp+vec3(e,0.,0.))-c,vn3(lp+vec3(0.,e,0.))-c,vn3(lp+vec3(0.,0.,e))-c)/e;
  lp=v_lp*17.;c=vn3(lp);gr+=.5*vec3(vn3(lp+vec3(e,0.,0.))-c,vn3(lp+vec3(0.,e,0.))-c,vn3(lp+vec3(0.,0.,e))-c)/e;
  gr=mat3(u_model)*gr;
  N=normalize(N-(gr-N*dot(N,gr))*.07*smoothstep(.03,.45,dn));
  float scr=vn3(v_lp*42.+3.)*.55+vn3(v_lp*95.)*.45;
  alb*=1.-.26*smoothstep(.15,.9,dn);
  float chip=smoothstep(.63,.73,scr)*smoothstep(.35,1.,dn)*.6;
  alb=mix(alb,vec3(.15,.145,.14),chip);
 }
 vec3 V=normalize(u_cam-v_w),H=normalize(u_sun+V);
 float nv=max(dot(N,V),0.),diff=max(dot(N,u_sun),0.);
 if(u_shOn>0.)diff*=1.-.72*shadowAt(v_w+N*.05,.0035);
 vec3 hemi=mix(vec3(.10,.10,.09),vec3(.42,.5,.62),N.y*.5+.5);
 float F=.04+.96*pow(1.-nv,5.);
 vec3 R=reflect(-V,N);
 vec3 env=pow(textureLod(u_sky,eq(R),3.).rgb,vec3(2.2));
 vec3 col=alb*(hemi+diff*vec3(1.,.96,.9)*1.05);
 col+=env*u_refl*(1.-.55*dn)*mix(.4,1.,F);
 col+=vec3(1.)*pow(max(dot(N,H),0.),110.)*u_spec*(1.-.5*dn)*diff;
 col+=u_emis;
 col=1.-exp(-col*1.15);
 vec3 g=pow(col,vec3(1./2.2));
 float d=length(v_w-u_cam);g=fogMix(g,d);
 o=vec4(g,t.a*u_alpha);}`);

const blobP=program(`#version 300 es
layout(location=0) in vec2 a_p;uniform mat4 u_vp,u_model;uniform vec3 u_sh;out vec2 v_p;
void main(){v_p=a_p;gl_Position=u_vp*u_model*vec4(a_p.x*u_sh.x,u_sh.z,a_p.y*u_sh.y,1.);}`,
`#version 300 es
precision mediump float;in vec2 v_p;out vec4 o;
void main(){float d=pow(abs(v_p.x),2.5)+pow(abs(v_p.y),2.5);o=vec4(0.,0.,0.,smoothstep(1.,.15,d)*.55);}`);

const partP=program(`#version 300 es
layout(location=0) in vec4 a_ps;layout(location=1) in vec4 a_c;layout(location=2) in vec2 a_f;uniform mat4 u_vp;uniform float u_scale;uniform float u_k;out vec4 v_c;out vec2 v_f;
void main(){vec4 p=u_vp*vec4(a_ps.x,a_ps.y,-a_ps.z,1.);gl_Position=p;gl_PointSize=clamp(a_ps.w*u_k*u_scale/max(p.w,.1),1.,256.);v_c=a_c;v_f=a_f;}`,
`#version 300 es
precision mediump float;in vec4 v_c;in vec2 v_f;uniform sampler2D u_s;uniform float u_use;out vec4 o;
void main(){
  if(u_use>.5){
    float f=floor(v_f.x+.5);vec2 cell=vec2(mod(f,6.),floor(f/6.));vec2 pc=gl_PointCoord;if(v_f.y>.5)pc.x=1.-pc.x;
    vec4 t=texture(u_s,(cell+clamp(pc,.02,.98))/6.);
    o=vec4(v_c.rgb*t.rgb*1.2,clamp(t.a*1.35,0.,1.)*v_c.a);
  }else{vec2 q=gl_PointCoord*2.-1.;float a=smoothstep(1.,0.,length(q))*v_c.a;o=vec4(v_c.rgb,a);}
}`);
let texSmoke=null; // atlas fumaça 6x6 (smoke6x6_30f.dds -> PNG 192x192, 30 quadros)
function makeSmokeTex(img){const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return t}

const aniso=gl.getExtension('EXT_texture_filter_anisotropic');
function makeTex(img,{repeatX=true}={}){
  const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,repeatX?gl.REPEAT:gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE===0?gl.REPEAT:gl.REPEAT);
  if(aniso)gl.texParameterf(gl.TEXTURE_2D,aniso.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(COARSE?4:16,gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  return t}
const loadImg=(b64,mime)=>new Promise((res,rej)=>{const im=new Image();im.onload=()=>res(im);im.onerror=rej;im.src='data:'+mime+';base64,'+b64});
const b2a=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));

/* ================= 3. Dados ================= */
const TRK=__DATA.trk, EXT=__DATA.ext;

// --- carros: cada pasta cars/<id>/car.json vira um "modelo" (malha + física + pinturas + texturas)
function buildCar(id,def){
  const vao=gl.createVertexArray();gl.bindVertexArray(vao);
  const vbo=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vbo);gl.bufferData(gl.ARRAY_BUFFER,b2a(def.vb),gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,24,0);
  gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.BYTE,true,24,12);
  gl.enableVertexAttribArray(3);gl.vertexAttribPointer(3,2,gl.FLOAT,false,24,16);
  const dbo=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,dbo);gl.bufferData(gl.ARRAY_BUFFER,b2a(def.dd),gl.STATIC_DRAW);
  gl.enableVertexAttribArray(4);gl.vertexAttribPointer(4,3,gl.BYTE,true,4,0);
  const ibo=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ibo);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,b2a(def.ib),gl.STATIC_DRAW);
  const parts=def.objs.map(o=>{
    const n=o.name,wheel=/^MSH-(FL|FR|BL|BR)/.test(n),blur=/_BAlloy$/.test(n),tyre=/Tyre$/.test(n),glass=o.tex==='gls'||o.tex==='gtx';
    const tex=o.tex||(blur?'blur':(tyre||wheel&&!/Disc$/.test(n))?'wheel':'body');
    const front=/^MSH-F/.test(n);
    return Object.assign({},o,{wheel,blur,front,glass,tex,
      refl:o.refl!==undefined?o.refl:glass?.7:tyre?.04:tex==='wheel'?.55:/Lights/.test(n)?.7:/Chassis/.test(n)?.55:.45, spec:glass?.9:tyre?.05:.9})});
  const TQ=def.torque.pts, tqMax=Math.max(...TQ.map(q=>q[1]));
  return {id,def,name:def.name,short:def.short||def.name,CP:def.phys,SA:Object.assign({tm:.7,tl:.8,tb:.52,drag:2,comZ:0,inert:15,drive:'R',bd:5.4,bb:.6,abs:0,lock:30,susF:1.1,susD:.15,anti:0,cdm:.54},def.sa||{}),TQ,tqMax,peakNm:def.torque.peakNm,vao,parts,
    opaque:parts.filter(p=>!p.blur&&!p.glass),blur:parts.filter(p=>p.blur),glass:parts.filter(p=>p.glass),
    skins:def.skins,shadow:def.shadow||[1.25,2.9,-.64],tex:{}}}
const MODELS={};for(const id of __DATA.carOrder)MODELS[id]=buildCar(id,__DATA.cars[id]);
let MD=MODELS[__DATA.defaultCar]||MODELS[__DATA.carOrder[0]], CP=MD.CP, TQ=MD.TQ;   // carro em uso (menu/corrida)
const dotOf=id=>(MD.skins.find(s=>s.id===id)||{}).dot;

// --- pista
const tvao=gl.createVertexArray();gl.bindVertexArray(tvao);
const tVB=b2a(TRK.vb), tIB=b2a(TRK.ib);
const tvbo=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,tvbo);gl.bufferData(gl.ARRAY_BUFFER,tVB,gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,28,0);
gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.BYTE,true,28,12);
gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,4,gl.UNSIGNED_BYTE,true,28,16);
gl.enableVertexAttribArray(3);gl.vertexAttribPointer(3,2,gl.FLOAT,false,28,20);
const tibo=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,tibo);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,tIB,gl.STATIC_DRAW);
const trkGroups={opaque:[],alpha:[],shadow:[]};TRK.groups.forEach(g=>trkGroups[g.cat].push(g));

// quad/partículas
const bvao=gl.createVertexArray();gl.bindVertexArray(bvao);
const bvbo=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,bvbo);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,1,1,-1,-1,1,1,-1,1]),gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,8,0);
const MAXP=500;const pvao=gl.createVertexArray();gl.bindVertexArray(pvao);
const pvbo=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,pvbo);gl.bufferData(gl.ARRAY_BUFFER,MAXP*40,gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,4,gl.FLOAT,false,40,0);
gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,4,gl.FLOAT,false,40,16);
gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,2,gl.FLOAT,false,40,32);
const pdata=new Float32Array(MAXP*10);
const parts=[];for(let i=0;i<MAXP;i++)parts.push({x:0,y:0,z:0,vx:0,vy:0,vz:0,life:0,max:1,size:1,r:1,g:1,b:1});let pHead=0;
function emit(x,y,z,vx,vy,vz,size,col,life){const p=parts[pHead];pHead=(pHead+1)%MAXP;
  p.x=x;p.y=y;p.z=z;p.vx=vx;p.vy=vy;p.vz=vz;p.life=p.max=life;p.size=size;p.r=col[0];p.g=col[1];p.b=col[2];p.sd=Math.random()>.5?1:0}

/* ================= 4. Colisão e altura do chão ================= */
// Fonte principal: physics.phy original (vértices, triângulos e código de superfície).
// Reserva: chão derivado da malha visual, para onde o .phy não cobre.
const CS=12;
const SURF={ASPHALT:0,KERB:1,GRAVEL:2,GRASS:3};
const PHY_SURF=[0,3,2,1]; // código do .phy: 0 asfalto/concreto, 1 grama, 2 cascalho, 3 zebra
const gridKey=(ix,iz)=>(ix+256)*1024+(iz+256);
const gSets=[], wCells=new Map(); let WS;
function addGrid(map,x0,z0,x1,z1,id,m){
  const ax=Math.floor((Math.min(x0,x1)-m)/CS),bx=Math.floor((Math.max(x0,x1)+m)/CS),az=Math.floor((Math.min(z0,z1)-m)/CS),bz=Math.floor((Math.max(z0,z1)+m)/CS);
  for(let ix=ax;ix<=bx;ix++)for(let iz=az;iz<=bz;iz++){const k=gridKey(ix,iz);let a=map.get(k);if(!a){a=[];map.set(k,a)}a.push(id)}}
const newSet=()=>({cells:new Map(),t:[],s:[]});
function pushGround(set,ax,ay,az,bx,by,bz,cx,cy,cz,surf){
  const d=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(d)<1e-7)return;
  const id=set.s.length;set.s.push(surf);set.t.push(ax,az,bx,bz,cx,cz,ay,by,cy,1/d);
  addGrid(set.cells,Math.min(ax,bx,cx),Math.min(az,bz,cz),Math.max(ax,bx,cx),Math.max(az,bz,cz),id,0)}
const wsArr=[];
function pushWall(ax,ay,az,bx,by,bz,cx,cy,cz){
  const y0=Math.min(ay,by,cy),y1=Math.max(ay,by,cy);if(y1-y0<.35)return;
  const P=[[ax,az],[bx,bz],[cx,cz]];let best=-1,bi=0,bj=1;
  for(let i=0;i<3;i++)for(let j=i+1;j<3;j++){const dd=Math.hypot(P[i][0]-P[j][0],P[i][1]-P[j][1]);if(dd>best){best=dd;bi=i;bj=j}}
  if(best<.05)return;
  const id=wsArr.length/6;wsArr.push(P[bi][0],P[bi][1],P[bj][0],P[bj][1],y0,y1);
  addGrid(wCells,P[bi][0],P[bi][1],P[bj][0],P[bj][1],id,1.5)}
const triNy=(ax,ay,az,bx,by,bz,cx,cy,cz)=>{
  const ux=bx-ax,uy=by-ay,uz=bz-az,vx=cx-ax,vy=cy-ay,vz=cz-az;
  const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,l=Math.hypot(nx,ny,nz);return l<1e-6?-1:Math.abs(ny)/l};
(function buildCollision(){
  const P=EXT.phy,pv=new Float32Array(b2a(P.v).buffer),pi=new Uint16Array(b2a(P.i).buffer),pf=b2a(P.f);
  const phy=newSet();
  for(let k=0;k<P.nt;k++){
    const a=pi[k*3]*3,b=pi[k*3+1]*3,c=pi[k*3+2]*3;
    const ax=pv[a],ay=pv[a+1],az=pv[a+2],bx=pv[b],by=pv[b+1],bz=pv[b+2],cx=pv[c],cy=pv[c+1],cz=pv[c+2];
    const ny=triNy(ax,ay,az,bx,by,bz,cx,cy,cz);if(ny<0)continue;
    if(ny>=.35)pushGround(phy,ax,ay,az,bx,by,bz,cx,cy,cz,PHY_SURF[pf[k]]);else pushWall(ax,ay,az,bx,by,bz,cx,cy,cz)}
  gSets.push(phy);
  const F=new Float32Array(tVB.buffer,0,tVB.byteLength>>2),I=new Uint16Array(tIB.buffer,0,tIB.byteLength>>1);
  const vis=newSet();
  for(const g of TRK.groups){
    if(g.cat!=='opaque'||g.fill)continue;      // g.fill = terreno de preenchimento (só visual)
    const name=TRK.texnames[g.tex];if(/tree|lamp|pole|cone|trebg|olive|shado|green|jumbo|cwin|roof|bldng|tent|canv|truck/.test(name))continue;
    const surf=/^gras/.test(name)?SURF.GRASS:/^grav/.test(name)?SURF.GRAVEL:/rmbld|rumbl/.test(name)?SURF.KERB:SURF.ASPHALT;
    for(let k=g.off;k<g.off+g.cnt;k+=3){
      const a=I[k]*7,b=I[k+1]*7,c=I[k+2]*7;
      const ax=F[a],ay=F[a+1],az=F[a+2],bx=F[b],by=F[b+1],bz=F[b+2],cx=F[c],cy=F[c+1],cz=F[c+2];
      if(triNy(ax,ay,az,bx,by,bz,cx,cy,cz)>=.45)pushGround(vis,ax,ay,az,bx,by,bz,cx,cy,cz,surf)}
  }
  gSets.push(vis);
  for(const s of gSets){s.T=new Float32Array(s.t);s.S=new Uint8Array(s.s);delete s.t;delete s.s}
  {const T=__DATA.tires;if(T&&T.segs)for(let k=0;k+5<T.segs.length;k+=6){const id=wsArr.length/6,q=T.segs;wsArr.push(q[k],q[k+1],q[k+2],q[k+3],q[k+4],q[k+5]);addGrid(wCells,q[k],q[k+1],q[k+2],q[k+3],id,1.5)}} // barreira de pneus colide
  WS=new Float32Array(wsArr);
})();
let gH=0,gSurf=0;
function groundAt(x,z,yMax){
  const key=gridKey(Math.floor(x/CS),Math.floor(z/CS));
  for(const set of gSets){
    const cell=set.cells.get(key);if(!cell)continue;const GT=set.T,GS=set.S;
    let best=-1e9,bs=0,found=false;
    for(let q=0;q<cell.length;q++){
      const id=cell[q],o=id*10;
      const x0=GT[o],z0=GT[o+1],x1=GT[o+2],z1=GT[o+3],x2=GT[o+4],z2=GT[o+5],id_=GT[o+9];
      const l0=((z1-z2)*(x-x2)+(x2-x1)*(z-z2))*id_;if(l0<-1e-4)continue;
      const l1=((z2-z0)*(x-x2)+(x0-x2)*(z-z2))*id_;if(l1<-1e-4)continue;
      const l2=1-l0-l1;if(l2<-1e-4)continue;
      const y=l0*GT[o+6]+l1*GT[o+7]+l2*GT[o+8];
      if(y>yMax)continue;
      const s=GS[id];
      if(!found||y>best+.03||(Math.abs(y-best)<=.03&&s<bs)){best=y;bs=s;found=true}
    }
    if(found){gH=best;gSurf=bs;return true}
  }
  return false}

/* ---- Torcida 3D com IA (data/peds.json): pedestres do GTA SA (DFF com pele + animações do ped.ifp assadas) ----
   Cada espectador (assets/peds/people.bin: posição, direção, tipo, sentado?, par de conversa) escolhe o que faz com o tempo:
   parado olhando a corrida (gira o corpo para o carro mais próximo), conversando com o par, ao telefone, coçando; sentados nos assentos
   (arquibancada) ficam sentados, às vezes conversando; quando um carro passa perto torcem (os sentados levantam, torcem e sentam).
   Só os mais próximos/visíveis são desenhados (até "cap"). Ajustes em data/peds.json: "near" (m, 0 desliga), "cap", "scale". ---- */
const PD=__DATA.peds;let peds=null,pedP=null;
try{if(PD&&PD.near>0)pedP=program(`#version 300 es
precision highp float;precision highp int;
layout(location=0) in vec3 a_p;layout(location=1) in vec2 a_uv;layout(location=2) in uvec4 a_b;layout(location=3) in vec4 a_w;layout(location=4) in vec4 a_n;
layout(location=5) in vec4 a_i0;layout(location=6) in vec4 a_i1;layout(location=7) in vec4 a_i2;layout(location=8) in vec4 a_i3;
uniform mat4 u_vp;uniform vec3 u_eye;uniform highp sampler2D u_anim;
out vec2 v_uv;out float v_d;out float v_l;
vec3 skinAt(vec3 p,float st,float len,float tf){
 float ft=mod(tf,len),f0=floor(ft),fr=ft-f0;int r0=int(st+f0),r1=int(st+mod(f0+1.,len));
 vec4 q=vec4(p,1.);vec3 r=vec3(0.);
 for(int k=0;k<4;k++){float w=a_w[k];if(w<=0.)continue;int b=int(a_b[k])*3;
  vec3 s0=vec3(dot(texelFetch(u_anim,ivec2(b,r0),0),q),dot(texelFetch(u_anim,ivec2(b+1,r0),0),q),dot(texelFetch(u_anim,ivec2(b+2,r0),0),q));
  vec3 s1=vec3(dot(texelFetch(u_anim,ivec2(b,r1),0),q),dot(texelFetch(u_anim,ivec2(b+1,r1),0),q),dot(texelFetch(u_anim,ivec2(b+2,r1),0),q));
  r+=w*mix(s0,s1,fr);}
 return r;}
void main(){
 vec3 m=skinAt(a_p,a_i1.x,a_i1.y,a_i1.z);
 if(a_i1.w>0.)m=mix(m,skinAt(a_p,a_i2.x,a_i2.y,a_i2.z),a_i1.w);
 if(a_i3.x>0.){ // andando: balança pernas (quadril 0,95 m) e braços (ombro 1,4 m) sobre a pose parada, com leve quique
  float sw=sin(a_i3.y),am=a_i3.x,sd=m.x>0.?1.:-1.;
  float ang=.62*sw*sd*smoothstep(1.,.72,m.y)*am;vec3 r=m-vec3(0.,.95,0.);float ca=cos(ang),sa=sin(ang);
  m=vec3(r.x,r.y*ca-r.z*sa,r.y*sa+r.z*ca)+vec3(0.,.95,0.);
  float aw=smoothstep(.16,.26,abs(m.x))*smoothstep(.75,.95,m.y)*(1.-smoothstep(1.45,1.6,m.y));
  float ab=-.55*sw*sd*aw*am;vec3 q=m-vec3(sd*.2,1.4,0.);float cb=cos(ab),sb=sin(ab);
  m=vec3(q.x,q.y*cb-q.z*sb,q.y*sb+q.z*cb)+vec3(sd*.2,1.4,0.);
  m.y+=.03*abs(sw)*am;}
 vec3 nn=a_n.xyz;
 if(a_i3.z>0.){m=vec3(m.x,.13-m.z,m.y);nn=vec3(nn.x,-nn.z,nn.y);}   // atropelada: caída de bruços (para a frente)
 float c=cos(a_i0.w),s=sin(a_i0.w);
 vec3 d=vec3(m.x*c+m.z*s,m.y,-m.x*s+m.z*c)*a_i2.w+a_i0.xyz;
 vec3 n=vec3(nn.x*c+nn.z*s,nn.y,-nn.x*s+nn.z*c);
 vec3 w=vec3(d.xy,-d.z);gl_Position=u_vp*vec4(w,1.);
 v_uv=a_uv;v_d=length(w-u_eye);v_l=.62+.38*clamp(dot(normalize(n),normalize(vec3(.35,.8,-.45)))*.5+.5,0.,1.);}`,
`#version 300 es
precision highp float;in vec2 v_uv;in float v_d;in float v_l;out vec4 o;uniform sampler2D u_tex;uniform float u_gain;
void main(){vec4 t=texture(u_tex,v_uv);if(acov(u_tex,v_uv,t.a)<.5)discard;
 vec3 c=t.rgb*v_l*u_gain;vec3 ov=max(c-.62,0.);c=min(c,vec3(.62))+.38*(1.-exp(-ov/.38));
 o=vec4(fogMix(c,v_d),1.);}`)}catch(e){console.warn('shader dos pedestres',e);pedP=null}
function pedHash(a,b){let x=Math.imul(a^0x9e3779b9,0x85ebca6b)^Math.imul((b|0)+0x7f4a7c15,0xc2b2ae35);x^=x>>>15;x=Math.imul(x,0x2c1b3c6d);x^=x>>>12;return(x>>>0)/4294967296}
function pedAttrs(){   // atributos do vértice do pedestre (VBO já ligado)
  gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,32,0);
  gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,2,gl.FLOAT,false,32,12);
  gl.enableVertexAttribArray(2);gl.vertexAttribIPointer(2,4,gl.UNSIGNED_BYTE,32,20);
  gl.enableVertexAttribArray(3);gl.vertexAttribPointer(3,4,gl.UNSIGNED_BYTE,true,32,24);
  gl.enableVertexAttribArray(4);gl.vertexAttribPointer(4,4,gl.BYTE,true,32,28)}
(function buildPeds(){
  if(!pedP||!PD||!PD.types||!PD.people)return;
  try{
    const N=PD.people.n,pf=new Float32Array(b2a(PD.people.d).buffer),CL={};PD.clips.forEach(c=>CL[c.name]=c);
    /* mistura de tipos (data/torcida.json → mix): sorteia o tipo de cada espectador, sempre igual para o mesmo índice */
    {const TO=__DATA.torcida,w=PD.types.map(t=>{const v=TO&&TO.mix?TO.mix[t.name]:1;return v>=0?+v:0}),tot=w.reduce((a,b)=>a+b,0);
     if(TO&&TO.mix&&tot>0)for(let i=0;i<N;i++){let r=pedHash(i,7)*tot,k=0;while(k<w.length-1&&r>=w[k]){r-=w[k];k++}pf[i*8+4]=k}}
    const T=PD.types.map(t=>{
      const vb=b2a(t.vb),ib=b2a(t.ib),an=b2a(t.anim);
      const vao=gl.createVertexArray();gl.bindVertexArray(vao);
      const vbo=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vbo);gl.bufferData(gl.ARRAY_BUFFER,vb,gl.STATIC_DRAW);
      pedAttrs();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,gl.createBuffer());gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,ib,gl.STATIC_DRAW);
      const inst=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,inst);gl.bufferData(gl.ARRAY_BUFFER,(PD.cap||140)*64,gl.DYNAMIC_DRAW);
      for(let k=0;k<4;k++){gl.enableVertexAttribArray(5+k);gl.vertexAttribPointer(5+k,4,gl.FLOAT,false,64,k*16);gl.vertexAttribDivisor(5+k,1)}
      gl.bindVertexArray(null);
      const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,t.nb*3,t.frames,0,gl.RGBA,gl.HALF_FLOAT,new Uint16Array(an.buffer,an.byteOffset,an.byteLength>>1));
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      return{vao,inst,anim:tex,atlas:null,ni:t.ni,female:!!t.female,buf:new Float32Array((PD.cap||140)*16),n:0,vbo}});
    gl.bindTexture(gl.TEXTURE_2D,null);
    // LODs (tools/build_lod.py): mesmos vértices, menos triângulos. T[ty+NT*lod]
    const NT=T.length;let hasLod=true;
    for(let L=0;L<2&&hasLod;L++)PD.types.forEach((t,ti)=>{if(!hasLod)return;if(!t.lib||!t.nli){hasLod=false;return}
      const B=T[ti],vao=gl.createVertexArray();gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,B.vbo);pedAttrs();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,gl.createBuffer());gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,b2a(t.lib[L]),gl.STATIC_DRAW);
      const inst=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,inst);gl.bufferData(gl.ARRAY_BUFFER,(PD.cap||140)*64,gl.DYNAMIC_DRAW);
      for(let k=0;k<4;k++){gl.enableVertexAttribArray(5+k);gl.vertexAttribPointer(5+k,4,gl.FLOAT,false,64,k*16);gl.vertexAttribDivisor(5+k,1)}
      gl.bindVertexArray(null);T.push({vao,inst,anim:B.anim,atlas:null,ni:t.nli[L],female:B.female,buf:new Float32Array((PD.cap||140)*16),n:0})});
    if(!hasLod)T.length=NT;
    const yaw=new Float32Array(N),cheerT0=new Float32Array(N).fill(-1e9),cheerEnd=new Float32Array(N).fill(-1e9),cool=new Float32Array(N),hold=new Float32Array(N);
    for(let i=0;i<N;i++){yaw[i]=pf[i*8+3];cool[i]=pedHash(i,3)*6}
    // trajetos livres (assets/peds/walk.bin: 4 pontos x,z,y + velocidade + pausa por pedestre); posição = função do tempo (sem estado)
    const WK=PD.walk?new Float32Array(b2a(PD.walk.d).buffer):null,cyc=new Float32Array(N),leg=new Float32Array(N*4);
    if(WK)for(let i=0;i<N;i++){const w=i*14,sp=WK[w+12];if(sp<=0)continue;let c=0;
      for(let k=0;k<4;k++){const a=w+k*3,b=w+((k+1)%4)*3,l=Math.hypot(WK[b]-WK[a],WK[b+1]-WK[a+1]);leg[i*4+k]=l;c+=l/sp+WK[w+13]}cyc[i]=c}
    peds={NT:hasLod?NT:0,WK,cyc,leg,T,pf,N,CL,yaw,cheerT0,cheerEnd,cool,hold,cand:[],cx:1e9,cz:1e9,last:0,near:PD.near,cap:PD.cap||140,fps:PD.fps||12,E:9,scale:PD.scale||1,l1:22,l2:50,drawn:0}
  }catch(e){console.warn('torcida 3D indisponível',e);peds=null}})();
/* o que o espectador i faz na época e (deterministico): nome do clipe */
function pedPick(S,i,e){
  const pf=S.pf,seat=pf[i*8+5],p=pf[i*8+6]|0,fem=S.T[pf[i*8+4]|0].female;
  if(seat){const r=pedHash(i,e);return r<.7?'sit':'sitchat'}
  if(p>=0&&pedHash(Math.min(i,p)+100000,e)<.6)return'chat';
  const r=pedHash(i+50000,e);
  if(p<0&&r<.14)return'phone';if(r<.24)return'scratch';
  const v=pedHash(i+7,e>>1);return fem&&v<.5?'standF':['stand0','stand1','stand2','stand3'][(v*4)|0]}
function pedsUpdate(cam,cars,t){
  if(!peds||!peds.T[0].atlas)return;const S=peds,pf=S.pf,N=S.N,ex=cam.eye[0],ez=cam.eye[2];
  const dt=Math.min(.1,Math.max(0,t-S.last));S.last=t;
  let fx=cam.tgt[0]-ex,fz=cam.tgt[2]-ez;const fl=Math.hypot(fx,fz)||1;fx/=fl;fz/=fl;
  // candidatos: quem está perto (refeito quando a câmera anda ~12 m)
  const mx=ex-S.cx,mz=ez-S.cz;
  if(mx*mx+mz*mz>144){S.cx=ex;S.cz=ez;const R2=(S.near+14)*(S.near+14);S.cand=[];
    for(let i=0;i<N;i++){const a=pf[i*8]-ex,b=pf[i*8+2]-ez;if(a*a+b*b<R2)S.cand.push(i)}}
  // visíveis (na frente da câmera) e os mais próximos até "cap"
  const vis=[],R2n=S.near*S.near;
  for(const i of S.cand){const a=pf[i*8]-ex,b=pf[i*8+2]-ez,d2=a*a+b*b;if(d2>R2n)continue;
    if(S.WK&&S.WK[i*14+12]>0){if(d2>100&&(a*fx+b*fz)<-0.25*Math.sqrt(d2))continue}      // quem anda: raio do trajeto
    else if(d2>36&&!inFr(pf[i*8],pf[i*8+1]+.9,-pf[i*8+2],1.8))continue;
    vis.push([d2,i])}
  if(vis.length>S.cap){vis.sort((p,q)=>p[0]-q[0]);vis.length=S.cap}
  const per=S.T.map(()=>0),CL=S.CL,fps=S.fps,E=S.E;
  S.drawn=vis.length;const pk=Math.max(Q.lodK,.75),l1=S.l1*S.l1*pk*pk,l2=S.l2*S.l2*pk*pk;     // pedestres: LOD nunca muito cedo (os LODs são grosseiros)
  for(const[dq,i]of vis){
    const o=i*8,ty=pf[o+4]|0,Y=S.T[ty+(S.NT?S.NT*(dq>l2?2:dq>l1?1:0):0)],seat=pf[o+5],partner=pf[o+6]|0,by=pf[o+3],ph=pf[o+7];
    // andar livre: posição no trajeto no tempo t; desvia de carros por perto
    let wx=pf[o],wy=pf[o+1],wz=pf[o+2],mv=0,wyaw=0,wam=0,wph=0;
    if(S.WK&&S.WK[i*14+12]>0){const w=i*14,sp=S.WK[w+12],ps=S.WK[w+13],chr=t<S.cheerEnd[i],pe=chr||S.cheerEnd[i]>0?Math.min(t,S.cheerEnd[i])-S.cheerT0[i]:0;let tau=(t-S.hold[i]-pe+ph*91.7)%S.cyc[i];if(tau<0)tau+=S.cyc[i];let acc=0;
      for(let k=0;k<4;k++){const a=w+k*3,b=w+((k+1)%4)*3,dur=S.leg[i*4+k]/sp;
        if(tau<dur){const f=tau/dur,dx=S.WK[b]-S.WK[a],dz=S.WK[b+1]-S.WK[a+1];wx=S.WK[a]+dx*f;wz=S.WK[a+1]+dz*f;wy=S.WK[a+2]+(S.WK[b+2]-S.WK[a+2])*f;
          mv=chr?0:1;wyaw=Math.atan2(dx,dz);wam=chr?0:Math.min(1,tau/.5,(dur-tau)/.5);wph=acc+f*S.leg[i*4+k];break}
        tau-=dur;acc+=S.leg[i*4+k];wx=S.WK[b];wz=S.WK[b+1];wy=S.WK[b+2];if(tau<ps)break;tau-=ps}
      for(const c of cars){const rr=7+Math.min(5,(c.speed||0)*.08),dx=wx-c.x,dz=wz-c.z,d2=dx*dx+dz*dz;if(d2<rr*rr&&d2>.01){const d=Math.sqrt(d2),k=(rr-d)*.5/d;wx+=dx*k;wz+=dz*k}}}
    else if(!seat){for(const c of cars){const dx=wx-c.x,dz=wz-c.z,d2=dx*dx+dz*dz;if(d2<25&&d2>.01){const d=Math.sqrt(d2),k=(5-d)*.6/d;wx+=dx*k;wz+=dz*k}}}   // parado: dá um passo para trás se o carro vem em cima
    const off=ph*E*7.31,te0=t+off,ep=Math.floor(te0/E),te=te0-ep*E;
    let clip=pedPick(S,i,ep),blend=0,prev=null;
    if(te<.45){prev=pedPick(S,i,ep-1);if(prev!==clip)blend=1-te/.45}
    let A=CL[clip],tfA=t*fps+ph*37,B=prev?CL[prev]:A,tfB=tfA;
    // carros: torcer quando passam perto; olhar o carro mais próximo
    let nd=1e9,nx=0,nz=0;const px=wx,pz=wz;
    for(const c of cars){const dx=c.x-px,dz=c.z-pz,d2=dx*dx+dz*dz;if(d2<nd){nd=d2;nx=dx;nz=dz}
      if(d2<324&&t>S.cool[i]){S.cool[i]=t+7+pedHash(i,ep)*5;
        const sp=c.speed||0;if(pedHash(i,Math.floor(t))<(c.isPlayer?.5:.3)+(sp>20?.2:0)&&t>S.cheerEnd[i]){
          const cc=CL[seat?'sitcheer':'cheer'];if(S.cheerEnd[i]>0)S.hold[i]+=Math.max(0,S.cheerEnd[i]-S.cheerT0[i]);S.cheerT0[i]=t;S.cheerEnd[i]=t+cc.len/fps}}}
    if(mv){   // anda de verdade: ciclo WALK_civi / WOMAN_walknorm do ped.ifp, fase = distância percorrida / passada (sem patinar); parte/para suavemente
      const wc=WALKOK.has(PD.types[ty].name)?(PD.types[ty].female?CL.walkF:CL.walkM):null;   // só os tipos cujo retarget ficou bom; os demais usam o balanço antigo
      if(wc){A=wc;tfA=wph/wc.stride*wc.len;B=PD.types[ty].female?CL.standF:CL.stand0;tfB=t*fps+ph*37;blend=1-wam;wam=0}
      else{A=CL.stand0;tfA=t*fps+ph*37;blend=0;B=A;tfB=tfA;wph*=4.5}}
    else if(t<S.cheerEnd[i]){const cc=CL[seat?'sitcheer':'cheer'],el=t-S.cheerT0[i];B=A;tfB=tfA;A=cc;tfA=Math.min(el*fps,cc.len-.01)-0;
      blend=Math.max(0,1-el/.3);if(el>=.3)blend=0}
    // direção do corpo
    let ty2=by;
    if(mv)ty2=wyaw;else
    if(clip==='chat'&&partner>=0&&!seat)ty2=Math.atan2(pf[partner*8]-px,pf[partner*8+2]-pz);
    else if(nd<2500){const ang=Math.atan2(nx,nz);let da=ang-by;da=Math.atan2(Math.sin(da),Math.cos(da));
      const lim=seat?.6:(S.WK&&S.WK[i*14+12]>0?3.2:1.05);ty2=by+Math.max(-lim,Math.min(lim,da))}
    let dy=ty2-S.yaw[i];dy=Math.atan2(Math.sin(dy),Math.cos(dy));S.yaw[i]+=dy*Math.min(1,dt*3.5);
    const b=Y.buf,k=Y.n*16;if(k+16>b.length)continue;
    b[k]=px;b[k+1]=wy;b[k+2]=pz;b[k+3]=S.yaw[i];
    b[k+4]=A.start;b[k+5]=A.len;b[k+6]=tfA;b[k+7]=blend;
    b[k+8]=B.start;b[k+9]=B.len;b[k+10]=tfB;b[k+11]=(.95+.1*pedHash(i,9))*S.scale;b[k+12]=wam;b[k+13]=wph;b[k+14]=0;b[k+15]=0;Y.n++;per[ty]++}
  if(footOn()&&camMode!==1){   // o pedestre controlado pelo jogador
    const W=WLK,Y=S.T[W.ty],b=Y.buf,k=Y.n*16;
    if(k+16<=b.length){
      const good=WALKOK.has(PD.types[W.ty].name),fm=!!PD.types[W.ty].female,wk=good?(fm?CL.walkF:CL.walkM):null,rn=good?(fm?CL.runF:CL.runM):null,id=fm?CL.standF:CL.stand0;
      let A,B,tfA,tfB,bl;const ti=t*fps;
      if(wk&&rn&&W.sp>1.9){A=rn;tfA=W.d/rn.stride*rn.len;B=wk;tfB=W.d/wk.stride*wk.len;bl=clamp(1-(W.sp-1.9)/1.6,0,1)}
      else if(wk){A=wk;tfA=W.d/wk.stride*wk.len;B=id;tfB=ti;bl=clamp(1-W.sp/.9,0,1)}
      else{A=id;tfA=ti;B=id;tfB=ti;bl=0}
      const swm=good?0:(W.sp>.05?Math.min(1.5,W.sp/1.2):0),swp=W.d*4.5;
      b[k]=W.x;b[k+1]=W.y;b[k+2]=W.z;b[k+3]=W.yaw;
      b[k+4]=A.start;b[k+5]=A.len;b[k+6]=tfA;b[k+7]=bl;b[k+8]=B.start;b[k+9]=B.len;b[k+10]=tfB;b[k+11]=S.scale;b[k+12]=swm;b[k+13]=swp;b[k+14]=deadPed?1:0;b[k+15]=0;Y.n++}}
  S.T.forEach(Y=>{if(Y.n){gl.bindBuffer(gl.ARRAY_BUFFER,Y.inst);gl.bufferSubData(gl.ARRAY_BUFFER,0,Y.buf,0,Y.n*16)}})}
function drawPeds(vp,eyeGL){
  if(!peds||!peds.T[0].atlas)return;const S=peds,u=pedP.u;
  gl.disable(gl.CULL_FACE);gl.useProgram(pedP.p);gl.uniformMatrix4fv(u.u_vp,false,vp);gl.uniform3fv(u.u_eye,eyeGL);gl.uniform1f(u.u_gain,GAIN);
  gl.uniform1i(u.u_tex,0);gl.uniform1i(u.u_anim,3);
  for(const Y of S.T){if(!Y.n)continue;
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,Y.atlas);gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,Y.anim);
    gl.bindVertexArray(Y.vao);gl.drawElementsInstanced(gl.TRIANGLES,Y.ni,gl.UNSIGNED_SHORT,0,Y.n);Y.n=0}
  gl.bindVertexArray(null);gl.activeTexture(gl.TEXTURE0)}

/* ---- Vegetação 3D (data/trees.json): palmeiras, sequoias e arbusto do GTA SA (DFF+TXD, tools/build_gta_trees.py), instanciados no lugar das árvores antigas da pista.
   Instâncias em assets/trees/inst.bin (x,y,z,giro,escala,modelo). "far" = distância máxima de desenho; "sway":0 desliga o balanço. ---- */
const WALKOK=new Set(['vwfyst1']);   // tipos com ciclo de caminhada real (bb, bbthin, bfori, bfost deformam no retarget: ficam no balanço antigo até termos os .dff deles)
const TR3=__DATA.trees;let trees3=null;
let tree3P=null;try{tree3P=program(`#version 300 es
precision highp float;
layout(location=0) in vec3 a_p;layout(location=1) in vec2 a_uv;layout(location=2) in vec4 a_n;layout(location=3) in vec4 a_i0;layout(location=4) in vec4 a_i1;
uniform mat4 u_vp;uniform vec3 u_eye;uniform float u_t,u_leaf,u_sway;out vec2 v_uv;out float v_d;out float v_l;
void main(){
 vec3 p=a_p;float hh=smoothstep(1.5,7.5,p.y);
 p.xz+=u_sway*u_leaf*hh*.16*vec2(sin(u_t*1.4+a_i1.y*6.283+p.z*.6),cos(u_t*1.1+a_i1.y*5.1+p.x*.6));
 float c=cos(a_i0.w),s=sin(a_i0.w);
 vec3 d=vec3(p.x*c+p.z*s,p.y,-p.x*s+p.z*c)*a_i1.x+a_i0.xyz;
 vec3 n=vec3(a_n.x*c+a_n.z*s,a_n.y,-a_n.x*s+a_n.z*c);
 vec3 w=vec3(d.xy,-d.z);gl_Position=u_vp*vec4(w,1.);
 v_uv=a_uv;v_d=length(w-u_eye);
 v_l=(.7+.3*abs(dot(normalize(n),normalize(vec3(.35,.8,-.45)))))*(.78+.22*smoothstep(.3,5.,a_p.y));}`,
`#version 300 es
precision highp float;in vec2 v_uv;in float v_d;in float v_l;out vec4 o;
uniform sampler2D u_tex;uniform float u_gain;uniform int u_mode;
void main(){vec4 t=texture(u_tex,v_uv);if(u_mode==1&&acov(u_tex,v_uv,t.a)<.5)discard;
 vec3 c=t.rgb*v_l*u_gain*1.15;vec3 ov=max(c-.62,0.);c=min(c,vec3(.62))+.38*(1.-exp(-ov/.38));
 o=vec4(fogMix(c,v_d),1.);}`)}catch(e){console.warn('shader das árvores 3D',e)}
(function buildTrees3(){
  if(!tree3P||!TR3||!TR3.models||!(TR3.n>0))return;
  try{
    const vao=gl.createVertexArray();gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());gl.bufferData(gl.ARRAY_BUFFER,b2a(TR3.vb),gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,24,0);
    gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,2,gl.FLOAT,false,24,12);
    gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,4,gl.BYTE,true,24,20);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,gl.createBuffer());gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,b2a(TR3.ib),gl.STATIC_DRAW);
    const inst=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,inst);gl.bufferData(gl.ARRAY_BUFFER,TR3.n*32,gl.DYNAMIC_DRAW);
    for(let k=0;k<2;k++){gl.enableVertexAttribArray(3+k);gl.vertexAttribPointer(3+k,4,gl.FLOAT,false,32,k*16);gl.vertexAttribDivisor(3+k,1)}
    gl.bindVertexArray(null);
    const models=TR3.models.map(m=>({h:m.h,w:m.w,parts:m.parts.map(q=>Object.assign({},q)),seg:0,cnt:0}));
    const all=new Float32Array(b2a(TR3.inst).buffer.slice(0));
    trees3={vao,inst,all,models,tex:{},n:TR3.n,far:TR3.far||520,sway:TR3.sway===0?0:1,buf:new Float32Array(TR3.n*8)}
  }catch(e){console.warn('árvores 3D indisponíveis',e);trees3=null}})();
function drawTrees3(vp,eyeGL,cam){
  if(!trees3||!trees3.ready)return;const S=trees3,u=tree3P.u,M=S.models;
  // seleção por distância e direção, agrupada por modelo (descarta o que está atrás da câmera)
  const ex=cam.eye[0],ez=cam.eye[2];const F2=S.far*S.far;let n=0;
  for(let m=0;m<M.length;m++){M[m].seg=n;
    for(let i=0;i<S.n;i++){if(S.all[i*6+5]!==m)continue;
      const x=S.all[i*6],z=S.all[i*6+2],dx=x-ex,dz=z-ez,d2=dx*dx+dz*dz;if(d2>F2)continue;
      if(d2>19600&&((i*0.6180339)%1)>Math.min(1,1.2-Math.sqrt(d2)/330))continue;   // floresta: afina com a distância (sem trocar de modelo)
      const sc=S.all[i*6+4];if(d2>900&&!inFr(x,S.all[i*6+1]+M[m].h*.5*sc,-z,(M[m].h*.5+M[m].w)*sc))continue;
      const o=n*8;S.buf[o]=x;S.buf[o+1]=S.all[i*6+1];S.buf[o+2]=z;S.buf[o+3]=S.all[i*6+3];S.buf[o+4]=sc;S.buf[o+5]=(i*0.6180339)%1;S.buf[o+6]=0;S.buf[o+7]=0;n++}
    M[m].cnt=n-M[m].seg}
  if(!n)return;
  gl.bindBuffer(gl.ARRAY_BUFFER,S.inst);gl.bufferSubData(gl.ARRAY_BUFFER,0,S.buf,0,n*8);
  gl.useProgram(tree3P.p);gl.uniformMatrix4fv(u.u_vp,false,vp);gl.uniform3fv(u.u_eye,eyeGL);gl.uniform1f(u.u_t,tNow);gl.uniform1f(u.u_gain,GAIN);gl.uniform1f(u.u_sway,S.sway);gl.uniform1i(u.u_tex,0);
  gl.bindVertexArray(S.vao);gl.activeTexture(gl.TEXTURE0);const cullWas=gl.isEnabled(gl.CULL_FACE);gl.disable(gl.CULL_FACE);   // folhagem de dois lados
  for(let pass=0;pass<2;pass++)for(let m=0;m<M.length;m++){const mo=M[m];if(!mo.cnt)continue;
    gl.bindBuffer(gl.ARRAY_BUFFER,S.inst);for(let k=0;k<2;k++)gl.vertexAttribPointer(3+k,4,gl.FLOAT,false,32,mo.seg*32+k*16);
    for(const q of mo.parts){if((q.alpha?1:0)!==pass)continue;const t=S.tex[q.tex];if(!t)continue;
      gl.uniform1i(u.u_mode,q.alpha?1:0);gl.uniform1f(u.u_leaf,q.sway);gl.bindTexture(gl.TEXTURE_2D,t);
      gl.drawElementsInstanced(gl.TRIANGLES,q.count,gl.UNSIGNED_SHORT,q.start*2,mo.cnt)}}
  if(cullWas)gl.enable(gl.CULL_FACE)}

/* ---- Pneus 3D (data/tires.json): pilhas de pneus do Old_Tires_PBR nos cantos da pista (tools/build_tires.py).
   Reaproveitam o programa das árvores (sem balanço). A barreira também colide: ver segmentos em buildCollision. ---- */
const TIR=__DATA.tires;let tires3=null;
(function buildTires3(){
  if(!tree3P||!TIR||!TIR.models||!(TIR.n>0))return;
  try{
    const vao=gl.createVertexArray();gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());gl.bufferData(gl.ARRAY_BUFFER,b2a(TIR.vb),gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,24,0);
    gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,2,gl.FLOAT,false,24,12);
    gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,4,gl.BYTE,true,24,20);
    const inst=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,inst);gl.bufferData(gl.ARRAY_BUFFER,TIR.n*32,gl.DYNAMIC_DRAW);
    for(let k=0;k<2;k++){gl.enableVertexAttribArray(3+k);gl.vertexAttribPointer(3+k,4,gl.FLOAT,false,32,k*16);gl.vertexAttribDivisor(3+k,1)}
    gl.bindVertexArray(null);
    tires3={vao,inst,all:new Float32Array(b2a(TIR.inst).buffer.slice(0)),models:TIR.models.map(m=>({...m,seg:0,cnt:0})),tex:{},n:TIR.n,far:TIR.far||260,buf:new Float32Array(TIR.n*8)}
  }catch(e){console.warn('pneus 3D indisponíveis',e);tires3=null}})();
function drawTires(vp,eyeGL,cam){
  if(!tires3||!tires3.ready)return;const S=tires3,u=tree3P.u,M=S.models,F2=S.far*S.far,ex=cam.eye[0],ez=cam.eye[2];let n=0;
  for(let m=0;m<M.length;m++){M[m].seg=n;
    for(let i=0;i<S.n;i++){if(S.all[i*6+5]!==m)continue;
      const x=S.all[i*6],y=S.all[i*6+1],z=S.all[i*6+2],dx=x-ex,dz=z-ez,d2=dx*dx+dz*dz;if(d2>F2)continue;
      if(d2>400&&!inFr(x,y+.3,-z,.7))continue;
      const o=n*8;S.buf[o]=x;S.buf[o+1]=y;S.buf[o+2]=z;S.buf[o+3]=S.all[i*6+3];S.buf[o+4]=S.all[i*6+4];S.buf[o+5]=0;S.buf[o+6]=0;S.buf[o+7]=0;n++}
    M[m].cnt=n-M[m].seg}
  if(!n)return;
  gl.bindBuffer(gl.ARRAY_BUFFER,S.inst);gl.bufferSubData(gl.ARRAY_BUFFER,0,S.buf,0,n*8);
  gl.useProgram(tree3P.p);gl.uniformMatrix4fv(u.u_vp,false,vp);gl.uniform3fv(u.u_eye,eyeGL);gl.uniform1f(u.u_t,tNow);gl.uniform1f(u.u_gain,GAIN);gl.uniform1f(u.u_sway,0);gl.uniform1f(u.u_leaf,0);gl.uniform1i(u.u_mode,0);gl.uniform1i(u.u_tex,0);
  gl.bindVertexArray(S.vao);gl.activeTexture(gl.TEXTURE0);const cw=gl.isEnabled(gl.CULL_FACE);gl.disable(gl.CULL_FACE);
  for(let m=0;m<M.length;m++){const mo=M[m];if(!mo.cnt)continue;const t=S.tex[mo.tex];if(!t)continue;
    gl.bindBuffer(gl.ARRAY_BUFFER,S.inst);for(let k=0;k<2;k++)gl.vertexAttribPointer(3+k,4,gl.FLOAT,false,32,mo.seg*32+k*16);
    gl.bindTexture(gl.TEXTURE_2D,t);gl.drawArraysInstanced(gl.TRIANGLES,mo.start,mo.count,mo.cnt)}
  if(cw)gl.enable(gl.CULL_FACE)}

/* ---- Casas (data/houses.json): casas do GTA SA (DFF+TXD, tools/build_houses.py) instanciadas no lugar dos prédios antigos da pista.
   Instâncias em assets/houses/inst.bin (x,y,z,giro,escala,modelo). Ajustes em data/houses.json: "far" (m, distância máxima), "light" (brilho da pré-iluminação). ---- */
const HS=__DATA.houses;let houses=null,houseP=null;
try{if(HS&&HS.n>0)houseP=program(`#version 300 es
precision highp float;
layout(location=0) in vec3 a_p;layout(location=1) in vec2 a_uv;layout(location=2) in vec4 a_n;layout(location=3) in vec4 a_c;layout(location=4) in vec4 a_i0;layout(location=5) in vec4 a_i1;
uniform mat4 u_vp;uniform vec3 u_eye;uniform float u_light;out vec2 v_uv;out vec3 v_c;out float v_d;
void main(){
 float c=cos(a_i0.w),s=sin(a_i0.w);
 vec3 d=vec3(a_p.x*c+a_p.z*s,a_p.y,-a_p.x*s+a_p.z*c)*a_i1.x+a_i0.xyz;
 vec3 n=vec3(a_n.x*c+a_n.z*s,a_n.y,-a_n.x*s+a_n.z*c);
 vec3 w=vec3(d.xy,-d.z);gl_Position=u_vp*vec4(w,1.);
 v_uv=a_uv;v_d=length(w-u_eye);
 v_c=a_c.rgb*u_light*(.68+.32*abs(dot(normalize(n),normalize(vec3(.35,.8,-.45)))));}`,
`#version 300 es
precision highp float;in vec2 v_uv;in vec3 v_c;in float v_d;out vec4 o;uniform sampler2D u_tex;uniform float u_gain;
void main(){vec3 c=texture(u_tex,v_uv).rgb*v_c*u_gain;vec3 ov=max(c-.62,0.);c=min(c,vec3(.62))+.38*(1.-exp(-ov/.38));
 o=vec4(fogMix(c,v_d),1.);}`)}catch(e){console.warn('shader das casas',e);houseP=null}
function buildInst(HS){
  if(!houseP||!HS||!HS.models||!(HS.n>0))return null;
  try{
    const vao=gl.createVertexArray();gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());gl.bufferData(gl.ARRAY_BUFFER,b2a(HS.vb),gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,28,0);
    gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,2,gl.FLOAT,false,28,12);
    gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,4,gl.BYTE,true,28,20);
    gl.enableVertexAttribArray(3);gl.vertexAttribPointer(3,4,gl.UNSIGNED_BYTE,true,28,24);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,gl.createBuffer());gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,b2a(HS.ib),gl.STATIC_DRAW);
    const inst=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,inst);gl.bufferData(gl.ARRAY_BUFFER,HS.n*32,gl.DYNAMIC_DRAW);
    for(let k=0;k<2;k++){gl.enableVertexAttribArray(4+k);gl.vertexAttribDivisor(4+k,1)}   // ponteiros definidos a cada desenho (um trecho por modelo)
    gl.bindVertexArray(null);
    const nm=HS.models.length,hv=b2a(HS.vb),hi=b2a(HS.ib),hvb=new Float32Array(hv.buffer.slice(hv.byteOffset,hv.byteOffset+hv.byteLength)),hib=new Uint16Array(hi.buffer.slice(hi.byteOffset,hi.byteOffset+hi.byteLength)),rad=new Float32Array(nm);
    HS.models.forEach((m,mi)=>{let r2=0;for(const p of m.parts)for(let q=p.start;q<p.start+p.count;q++){const v=(hib[q]|0)*7,d=hvb[v]*hvb[v]+hvb[v+1]*hvb[v+1]+hvb[v+2]*hvb[v+2];if(d>r2)r2=d}rad[mi]=Math.sqrt(r2)});
    return{vao,inst,all:new Float32Array(b2a(HS.inst).buffer),n:HS.n,far:HS.far||1100,light:HS.light||2,models:HS.models,tex:{},
      rad,buf:new Float32Array(HS.n*8),vis:new Uint8Array(HS.n),cnt:new Int32Array(nm*3),off:new Int32Array(nm*3),cur:new Int32Array(nm*3),nv:0,l1:HS.l1||150,l2:HS.l2||420}
  }catch(e){console.warn('instâncias indisponíveis',e);return null}}
houses=buildInst(HS);
/* ---- Caminhões (data/trucks.json): Linerunner do GTA SA no lugar dos cavalos mecânicos da pista (tools/build_trucks.py). Mesmo sistema das casas. ---- */
const TR=__DATA.trucks;let trucks=null;trucks=buildInst(TR);
function drawHouses(vp,eyeGL,cam){drawInst(houses,vp,eyeGL,cam);drawInst(trucks,vp,eyeGL,cam)}
function drawInst(S,vp,eyeGL,cam){
  if(!S||!houseP)return;const u=houseP.u,A=S.all,M=S.models,NM=M.length;
  const ex=cam.eye[0],ez=cam.eye[2],F2=S.far*S.far,L1=S.l1*S.l1*Q.lodK*Q.lodK,L2=S.l2*S.l2*Q.lodK*Q.lodK;S.cnt.fill(0);
  for(let i=0;i<S.n;i++){const a=i*6,dx=A[a]-ex,dz=A[a+2]-ez,d2=dx*dx+dz*dz;S.vis[i]=0;
    if(d2>F2)continue;const m=A[a+5]|0,sc=A[a+4];
    if(d2>1600&&!inFr(A[a],A[a+1],-A[a+2],S.rad[m]*sc))continue;       // fora do campo de visão
    const lv=M[m].lod?(d2>L2?2:d2>L1?1:0):0;S.vis[i]=1+lv;S.cnt[m*3+lv]++}
  let o=0;for(let k=0;k<NM*3;k++){S.off[k]=o;S.cur[k]=o;o+=S.cnt[k]}
  S.nv=o;if(!o)return;
  for(let i=0;i<S.n;i++){const vv=S.vis[i];if(!vv)continue;const a=i*6,k=(S.cur[(A[a+5]|0)*3+vv-1]++)*8;
    S.buf[k]=A[a];S.buf[k+1]=A[a+1];S.buf[k+2]=A[a+2];S.buf[k+3]=A[a+3];S.buf[k+4]=A[a+4];S.buf[k+5]=0;S.buf[k+6]=0;S.buf[k+7]=0}
  gl.bindVertexArray(S.vao);gl.bindBuffer(gl.ARRAY_BUFFER,S.inst);gl.bufferSubData(gl.ARRAY_BUFFER,0,S.buf,0,o*8);
  gl.useProgram(houseP.p);gl.uniformMatrix4fv(u.u_vp,false,vp);gl.uniform3fv(u.u_eye,eyeGL);gl.uniform1f(u.u_gain,GAIN);gl.uniform1f(u.u_light,S.light);gl.uniform1i(u.u_tex,0);
  gl.activeTexture(gl.TEXTURE0);
  for(let m=0;m<NM;m++)for(let lv=0;lv<3;lv++){const k=m*3+lv,c=S.cnt[k];if(!c)continue;
    gl.vertexAttribPointer(4,4,gl.FLOAT,false,32,S.off[k]*32);gl.vertexAttribPointer(5,4,gl.FLOAT,false,32,S.off[k]*32+16);
    for(const p of (lv?M[m].lod[lv-1]:M[m].parts)){const t=S.tex[p.tex];if(!t)continue;gl.bindTexture(gl.TEXTURE_2D,t);gl.drawElementsInstanced(gl.TRIANGLES,p.count,gl.UNSIGNED_SHORT,p.start*2,c)}}
  gl.bindVertexArray(null)}

/* ---- Grama (data/grass.json): modelos do GTA SA (grass*_*.dff) espalhados SÓ sobre o chão com textura de grama da pista.
   O chão (triângulos + arestas que encostam em asfalto/muro) vem de assets/grass/ground.*; as plantas são geradas por célula
   (aleatório fixo por posição, nada de lista gigante) e ficam só perto da câmera. Camadas/cores/densidades = plants.dat em data/grass.json.
   Ajustes: "far" (m), "densMul" (densidade), "cap" (máx. plantas por camada), "scale", "sway":0 (sem vento), "far":0 desliga. ---- */
const GR=__DATA.grass;if(GR)GR.adaptive=0;let grass=null,grassP=null;   // o governador de qualidade (frame) controla G.q

try{if(GR&&GR.far>0)grassP=program(`#version 300 es
precision highp float;
layout(location=0) in vec3 a_p;layout(location=1) in vec2 a_uv;layout(location=3) in vec4 a_i0;layout(location=4) in vec4 a_i1;
uniform mat4 u_vp;uniform vec3 u_eye;uniform float u_t,u_sway,u_bend,u_bv,u_far,u_scale;out vec2 v_uv;out float v_d;out float v_h;out float v_s;
void main(){
 float c=cos(a_i0.w),s=sin(a_i0.w);
 vec3 o=vec3(a_i0.x,a_i0.y,-a_i0.z);float d0=length(o-u_eye);
 float fade=1.-smoothstep(u_far*.68,u_far,d0);
 vec3 p=vec3(a_p.x*a_i1.x,a_p.y*a_i1.y,a_p.z*a_i1.x)*u_scale*fade;
 float h=clamp(a_p.y,0.,1.);
 float w=u_sway*u_bend*(1.+u_bv*.25*(fract(a_i1.z*7.3)*2.-1.))*h*h*.035*a_i1.y;
 p.x+=w*sin(u_t*1.9+a_i1.z*6.283+a_i0.x*.35);p.z+=w*cos(u_t*1.5+a_i1.z*5.1+a_i0.z*.35);
 vec3 d=vec3(p.x*c+p.z*s,p.y,-p.x*s+p.z*c)+a_i0.xyz;
 vec3 wv=vec3(d.xy,-d.z);gl_Position=u_vp*vec4(wv,1.);
 v_uv=a_uv;v_d=d0;v_h=h;v_s=a_i1.w;}`,
`#version 300 es
precision highp float;in vec2 v_uv;in float v_d;in float v_h;in float v_s;out vec4 o;
uniform sampler2D u_tex;uniform float u_gain;uniform vec3 u_col;
void main(){vec4 t=texture(u_tex,v_uv);if(acov(u_tex,v_uv,t.a)<.42)discard;
 vec3 c=t.rgb*u_col*v_s*(.55+.45*smoothstep(0.,.7,v_h))*u_gain;vec3 ov=max(c-.62,0.);c=min(c,vec3(.62))+.38*(1.-exp(-ov/.38));
 o=vec4(fogMix(c,v_d),1.);}`)}catch(e){console.warn('shader da grama',e);grassP=null}
function grassRng(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
(function buildGrass(){
  if(!grassP||!GR||!GR.ground||!GR.layers||!GR.layers.length)return;
  try{
    const F=new Float32Array(b2a(GR.ground).buffer),FL=b2a(GR.flags),nT=FL.length,CS=GR.cell||16,grid=new Map();
    const KEY=(i,j)=>(i+4096)*8192+(j+4096);
    for(let t=0;t<nT;t++){const o=t*9;let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;
      for(let k=0;k<3;k++){const x=F[o+k*3],z=F[o+k*3+2];if(x<x0)x0=x;if(x>x1)x1=x;if(z<z0)z0=z;if(z>z1)z1=z}
      for(let i=Math.floor(x0/CS);i<=Math.floor(x1/CS);i++)for(let j=Math.floor(z0/CS);j<=Math.floor(z1/CS);j++){const k=KEY(i,j);let a=grid.get(k);if(!a)grid.set(k,a=[]);a.push(t)}}
    const vb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vb);gl.bufferData(gl.ARRAY_BUFFER,b2a(GR.vb),gl.STATIC_DRAW);
    const ib=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,b2a(GR.ib),gl.STATIC_DRAW);
    const cap=GR.cap||1800,layers=[];
    GR.layers.forEach((L,li)=>{const M=GR.models[L.model];if(!M)return;
      const vao=gl.createVertexArray();gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,vb);
      gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,20,0);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,2,gl.FLOAT,false,20,12);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);
      const inst=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,inst);gl.bufferData(gl.ARRAY_BUFFER,cap*32,gl.DYNAMIC_DRAW);
      for(let k=0;k<2;k++){gl.enableVertexAttribArray(3+k);gl.vertexAttribPointer(3+k,4,gl.FLOAT,false,32,k*16);gl.vertexAttribDivisor(3+k,1)}
      gl.bindVertexArray(null);
      layers.push({L,li,M,vao,inst,buf:new Float32Array(cap*8),n:0,tex:null,col:[L.rgb[0]/255,L.rgb[1]/255,L.rgb[2]/255]})});
    grass={F,FL,grid,KEY,CS,layers,cache:new Map(),far:GR.far,cap,q:1,ema:16,fr:0,tex:{},t0:0};
  }catch(e){console.warn('grama indisponível',e);grass=null}})();
function grassCell(G,ci,cj,tris){
  const CS=G.CS,F=G.F,FL=G.FL,edge=GR.edge==null?.9:GR.edge,out=[];
  G.layers.forEach((Y,li)=>{const L=Y.L,dens=Math.max(.001,L.dens*(GR.densMul||1)),n=Math.min(70,Math.max(1,Math.ceil(CS*Math.sqrt(dens))));
    const rnd=grassRng((ci*73856093)^(cj*19349663)^(li*83492791)^0x1234567),arr=[];
    for(let gx=0;gx<n;gx++)for(let gz=0;gz<n;gz++){
      const x=ci*CS+(gx+rnd())*CS/n,z=cj*CS+(gz+rnd())*CS/n,r=[rnd(),rnd(),rnd(),rnd(),rnd()];
      for(let q=0;q<tris.length;q++){const t=tris[q],o=t*9;
        const ax=F[o],az=F[o+2],bx=F[o+3],bz=F[o+5],cx=F[o+6],cz=F[o+8];
        const d=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(d)<1e-9)continue;
        const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/d,v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/d,w=1-u-v;
        if(u<0||v<0||w<0)continue;
        let sc=1;const fl=FL[t];
        if(fl){let dm=1e9;for(let k=0;k<3;k++){if(!(fl&(1<<k)))continue;const k2=(k+1)%3,px=F[o+k*3],pz=F[o+k*3+2],qx=F[o+k2*3],qz=F[o+k2*3+2];
            const ex=qx-px,ez=qz-pz,l2=ex*ex+ez*ez||1,tt=Math.max(0,Math.min(1,((x-px)*ex+(z-pz)*ez)/l2)),dx=x-(px+ex*tt),dz=z-(pz+ez*tt),dd=Math.sqrt(dx*dx+dz*dz);if(dd<dm)dm=dd}
          if(dm<edge)break;if(dm<edge+1.2)sc=.5+.5*(dm-edge)/1.2}
        const y=u*F[o+1]+v*F[o+4]+w*F[o+7];
        arr.push(x,y,z,r[0]*6.2831853,(L.sclXY+L.varXY*r[1])*sc,(L.sclZ+L.varZ*r[2])*sc,r[3],Math.max(.2,Math.min(255,L.inten-L.varI*r[4])/255));break}}
    const cnt=arr.length/8,f=new Float32Array(arr);
    for(let i=cnt-1;i>0;i--){const j=Math.floor(rnd()*(i+1));if(j===i)continue;for(let k=0;k<8;k++){const a=f[i*8+k];f[i*8+k]=f[j*8+k];f[j*8+k]=a}}
    out.push(f)});
  return out}
function drawGrass(vp,eyeGL,cam,nowMs){
  if(!grass)return;const G=grass;
  // qualidade adaptativa: se o quadro demorar muito, reduz a quantidade; se sobrar, volta
  if(G.t0){const d=nowMs-G.t0;if(d<250)G.ema+=(d-G.ema)*.05}G.t0=nowMs;
  if(GR.adaptive!==0&&++G.fr%90===0){if(G.ema>28&&G.q>.3)G.q*=.85;else if(G.ema<18&&G.q<1)G.q=Math.min(1,G.q*1.06)}
  for(const Y of G.layers){if(!Y.tex)Y.tex=G.tex[Y.L.tex];if(!Y.tex)return}
  const ex=cam.eye[0],ez=cam.eye[2];let fx=cam.tgt[0]-ex,fz=cam.tgt[2]-ez;const fl=Math.hypot(fx,fz)||1;fx/=fl;fz/=fl;
  const far=G.far,CS=G.CS,i0=Math.floor((ex-far)/CS),i1=Math.floor((ex+far)/CS),j0=Math.floor((ez-far)/CS),j1=Math.floor((ez+far)/CS);
  let budget=G.cache.size?2:400;const vis=[];
  for(let i=i0;i<=i1;i++)for(let j=j0;j<=j1;j++){const k=G.KEY(i,j),tr=G.grid.get(k);if(!tr)continue;
    const dx=(i+.5)*CS-ex,dz=(j+.5)*CS-ez,d=Math.hypot(dx,dz);if(d>far+CS*.75)continue;
    if(d>CS*2&&(dx*fx+dz*fz)<-CS)continue;
    let c=G.cache.get(k);if(!c){if(budget<=0)continue;budget--;c=grassCell(G,i,j,tr);G.cache.set(k,c);
      if(G.cache.size>500){const it=G.cache.keys();for(let n=0;n<100;n++)G.cache.delete(it.next().value)}}
    vis.push(c,d)}
  if(!vis.length)return;
  const u=grassP.u;gl.disable(gl.CULL_FACE);gl.useProgram(grassP.p);
  gl.uniformMatrix4fv(u.u_vp,false,vp);gl.uniform3fv(u.u_eye,eyeGL);gl.uniform1f(u.u_t,tNow);gl.uniform1f(u.u_gain,GAIN);gl.uniform1f(u.u_sway,GR.sway===0?0:1);
  gl.uniform1f(u.u_far,far*Math.sqrt(G.q));gl.uniform1f(u.u_scale,GR.scale||1);gl.uniform1i(u.u_tex,0);gl.activeTexture(gl.TEXTURE0);
  const cap=Math.floor(G.cap*G.q);
  G.layers.forEach((Y,li)=>{
    let tot=0;const cnt=new Array(vis.length/2);
    for(let a=0;a<vis.length;a+=2){const d=vis[a+1],fr=Math.max(0,Math.min(1,1-(d-.3*far)/(.7*far))),c=Math.floor(vis[a][li].length/8*fr*Math.min(1,G.q+.15));cnt[a/2]=c;tot+=c}
    if(!tot)return;const ratio=Math.min(1,cap/tot);let n=0;
    for(let a=0;a<vis.length;a+=2){const c=Math.floor(cnt[a/2]*ratio);if(!c)continue;Y.buf.set(vis[a][li].subarray(0,c*8),n*8);n+=c}
    if(!n)return;
    gl.uniform3fv(u.u_col,Y.col);gl.uniform1f(u.u_bend,Y.L.bend||0);gl.uniform1f(u.u_bv,Y.L.bendVar||0);
    gl.bindBuffer(gl.ARRAY_BUFFER,Y.inst);gl.bufferSubData(gl.ARRAY_BUFFER,0,Y.buf.subarray(0,n*8));
    gl.bindVertexArray(Y.vao);gl.bindTexture(gl.TEXTURE_2D,Y.tex);gl.drawElementsInstanced(gl.TRIANGLES,Y.M.count,gl.UNSIGNED_SHORT,Y.M.first*2,n)});
  gl.bindVertexArray(null)}
let tNow=0;
let jb=null;
function updateJumbo(){
  if(!jb)return;const f=Math.floor(tNow*jb.J.fps)%jb.J.n;if(f===jb.f)return;jb.f=f;
  jb.ctx.drawImage(jb.img,(f%jb.J.cols)*jb.J.fw,Math.floor(f/jb.J.cols)*jb.J.fw,jb.J.fw,jb.J.fw,0,0,128,128);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,jb.tex);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,jb.cv);gl.generateMipmap(gl.TEXTURE_2D)}

/* ================= 4b. Troféus (trophies/*.msh) ================= */
// Formato .msh v9: texturas, vértices FVF 0x252 (pos, normal, cor, 2 UV; 44 B), índices u16 e lista de objetos.
// Aqui os vértices vêm reempacotados em 24 B (pos f32, normal i8, uv f32). Grupos: w=madeira, m=metal cromado, d=preto.
let trophy=null, texWood=null;const trophyMeshes={};
const TRO_NAMES={gold:'ouro',silver:'prata',bronze:'bronze'}, TRO_COL={gold:'#d9b45a',silver:'#c9ccd1',bronze:'#c8703a'};
const scaleM=s=>new Float32Array([s,0,0,0, 0,s,0,0, 0,0,s,0, 0,0,0,1]);
const easeBack=k=>{k=Math.min(1,Math.max(0,k))-1;return 1+2.70158*k*k*k+1.70158*k*k};
let trophyP=null,TRO=null,TINT={};
try{
  TRO=__DATA.trophy;
  trophyP=program(`#version 300 es
layout(location=0) in vec3 a_pos;layout(location=1) in vec3 a_nrm;layout(location=3) in vec2 a_uv;
uniform mat4 u_vp,u_model;out vec3 v_n,v_w;out vec2 v_uv;
void main(){vec4 w=u_model*vec4(a_pos,1.);v_w=w.xyz;v_n=mat3(u_model)*a_nrm;v_uv=a_uv;gl_Position=u_vp*w;}`,
`#version 300 es
precision highp float;in vec3 v_n,v_w;in vec2 v_uv;out vec4 o;
uniform sampler2D u_tex,u_sky;uniform vec3 u_cam,u_sun,u_tint;uniform float u_kind;
${EQ}
void main(){
 vec3 N=normalize(v_n),V=normalize(u_cam-v_w),H=normalize(u_sun+V);
 float nv=max(dot(N,V),0.),diff=max(dot(N,u_sun),0.),F=.04+.96*pow(1.-nv,5.);
 vec3 hemi=mix(vec3(.10,.10,.09),vec3(.42,.5,.62),N.y*.5+.5);
 vec3 env=pow(textureLod(u_sky,eq(reflect(-V,N)),2.).rgb,vec3(2.2));
 float sp=pow(max(dot(N,H),0.),u_kind>.5&&u_kind<1.5?90.:60.)*diff;
 vec3 col;
 if(u_kind>.5&&u_kind<1.5){ // cromado tingido pela textura
  col=u_tint*(hemi*.45+diff*.8)+env*mix(u_tint,vec3(1.),F)*1.7+u_tint*sp*1.6+vec3(sp*.35);
 }else{
  vec3 alb=u_kind<.5?pow(texture(u_tex,v_uv).rgb,vec3(2.2)):u_tint;
  col=alb*(hemi+diff*vec3(1.,.96,.9)*1.05)+env*.14*mix(.4,1.,F)+vec3(sp*.22);
 }
 col=1.-exp(-col*1.15);vec3 g=pow(col,vec3(1./2.2));
 g=fogMix(g,length(v_w-u_cam));
 o=vec4(g,1.);}`);
  for(const k of ['gold','silver','bronze']){const c=TRO.tint[k],mx=Math.max(...c);const t=c.map(v=>v/mx*.9),l=.3*t[0]+.59*t[1]+.11*t[2],sat=k==='silver'?1:1.35;TINT[k]=t.map(v=>Math.pow(Math.min(1,Math.max(0,l+(v-l)*sat)),2.2))}
  for(const nm of ['cup','box']){
    const D=TRO[nm],vao=gl.createVertexArray();gl.bindVertexArray(vao);
    const vb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vb);gl.bufferData(gl.ARRAY_BUFFER,b2a(D.vb),gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,24,0);
    gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.BYTE,true,24,12);
    gl.enableVertexAttribArray(3);gl.vertexAttribPointer(3,2,gl.FLOAT,false,24,16);
    const ib=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,b2a(D.ib),gl.STATIC_DRAW);
    trophyMeshes[nm]={vao,g:D.g,hh:D.hh}}
  gl.bindVertexArray(null);
}catch(e){console.warn('troféus indisponíveis',e);trophyP=null}
const trophyScale=T=>Math.max(.001,easeBack(T.t/1.2));
function drawTrophy(vp,eyeGL){
  const T=trophy,M=trophyMeshes[T.mesh];if(!trophyP||!M)return;
  const s=trophyScale(T);
  const m=M4.flipZ(M4.mul(M4.trans(T.x,T.y+M.hh*s,T.z),M4.mul(M4.rotY(T.t*.8+.4),scaleM(s))));
  gl.useProgram(trophyP.p);gl.bindVertexArray(M.vao);
  gl.uniformMatrix4fv(trophyP.u.u_vp,false,vp);gl.uniformMatrix4fv(trophyP.u.u_model,false,m);
  gl.uniform3fv(trophyP.u.u_cam,eyeGL);gl.uniform3f(trophyP.u.u_sun,.45,.78,-.42);
  gl.uniform1i(trophyP.u.u_tex,0);gl.uniform1i(trophyP.u.u_sky,1);
  const dk=Math.pow(Math.max(TRO.dark,.19),2.2);
  for(const g of M.g){
    if(g[2]==='m'){gl.uniform1f(trophyP.u.u_kind,1);gl.uniform3fv(trophyP.u.u_tint,TINT[T.metal])}
    else if(g[2]==='w'&&texWood){gl.uniform1f(trophyP.u.u_kind,0);gl.uniform3f(trophyP.u.u_tint,1,1,1);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texWood)}
    else{gl.uniform1f(trophyP.u.u_kind,2);gl.uniform3f(trophyP.u.u_tint,dk,dk,dk)}
    gl.drawElements(gl.TRIANGLES,g[1],gl.UNSIGNED_SHORT,g[0]*2)}
  gl.useProgram(carP.p);gl.bindVertexArray(MD.vao);
}
function drawTrophyShadow(){
  const T=trophy,r=(T.mesh==='box'?1.05:.85)*trophyScale(T);
  const m=M4.mul(M4.trans(T.x,T.y+.67,T.z),new Float32Array([r/1.25,0,0,0, 0,1,0,0, 0,0,r/2.9,0, 0,0,0,1]));
  gl.uniform3f(blobP.u.u_sh,1.25,2.9,-.64);gl.uniformMatrix4fv(blobP.u.u_model,false,M4.flipZ(m));gl.drawArrays(gl.TRIANGLES,0,6)}
function trophyCam(dt){
  const T=trophy;T.t+=dt;const M=trophyMeshes[T.mesh];
  const a=Math.atan2(T.tx,T.tz)+.7+Math.sin(T.t*.4)*.2,d=5.9,cy=T.y+(M?M.hh:1.05)+.1;
  return {eye:[T.x+Math.sin(a)*d,cy+.7,T.z+Math.cos(a)*d],tgt:[T.x,cy,T.z],fov:.62}}
// contagem de troféus (persistida no navegador, quando disponível)
function troLoad(){try{const o=JSON.parse(localStorage.getItem('xbadl:trophies')||'{}');return{gold:+o.gold||0,silver:+o.silver||0,bronze:+o.bronze||0}}catch(e){return{gold:0,silver:0,bronze:0}}}
let troCount=troLoad();
function renderTally(){const t=$('tally');if(!t)return;
  t.innerHTML=['gold','silver','bronze'].map(k=>'<span><i style="background:'+TRO_COL[k]+'"></i>'+TRO_NAMES[k][0].toUpperCase()+TRO_NAMES[k].slice(1)+'<b>'+troCount[k]+'</b></span>').join('')}
function giveTrophy(pos){
  const spec=pos===1?{mesh:cfg.level===2?'box':'cup',metal:'gold'}:pos===2?{mesh:'cup',metal:'silver'}:pos===3?{mesh:'cup',metal:'bronze'}:null;
  const ok=!!(spec&&trophyP&&trophyMeshes[spec.mesh]);
  $('result').classList.toggle('center',!ok);
  $('resEye').textContent='Fim de corrida'+(ok?' · Troféu de '+TRO_NAMES[spec.metal]:'');
  if(!ok){trophy=null;return}
  const ts=trackS(player.x,player.z,player.idx),sp=splineAt(ts.s+9);
  const y=groundAt(sp.x,sp.z,sp.y+2)?gH:sp.y;
  trophy=Object.assign({t:0,x:sp.x,y,z:sp.z,tx:sp.tx,tz:sp.tz},spec);
  troCount[spec.metal]++;try{localStorage.setItem('xbadl:trophies',JSON.stringify(troCount))}catch(e){}
  renderTally();
  try{[523,659,784,1047].forEach((f,i)=>setTimeout(()=>beep(f,.18),i*140))}catch(e){}
}

/* ================= 4c. HUD original (ui/hud/*.dds) ================= */
// Conta-giros 256 px (mostrador Tacho7000, redline 7000), agulha 256x32 com pivô no centro, escala 0–8000 rpm em 270°.
// Diagrama de danos: contorno + 10 peças tingidas de vermelho conforme o dano da região correspondente.
let UI=null,uiR=CP_IDLE(),uiWheelA=0;
function CP_IDLE(){return 950}
const UI_DMG={front:[0,['frontbumper','radiator','engine']],rear:[1,['rearbumper','gearbox']],left:[2,['leftpanel','flwheel','blwheel']],right:[3,['rightpanel','frwheel','brwheel']]};
const uiDm={white:{},red:{}};
try{UI=__DATA.ui}catch(e){console.warn('HUD original indisponível',e)}
async function uiInit(){
  if(!UI)return;
  const src=k=>'data:image/png;base64,'+UI[k];
  $('uiDial').src=src('dial');$('uiNeedle').src=src('needle');$('uiTrac').src=src('trac');$('uiWrong').src=src('wrong');$('uiWheel').src=src('wheel');
  $('uiGear').style.backgroundImage='url('+src('gear')+')';$('uiOdoBg').style.backgroundImage='url('+src('odo')+')';
  for(const k of Object.keys(UI.dmg)){
    const im=await loadImg(UI.dmg[k],'image/png');uiDm.white[k]=im;
    const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d');x.drawImage(im,0,0);
    x.globalCompositeOperation='source-in';x.fillStyle='#ff4a3d';x.fillRect(0,0,128,128);uiDm.red[k]=c}
}
function uiNeedle(dt){
  if(!UI||!player)return;
  uiR+=(player.rpm-uiR)*Math.min(1,dt*20);
  const ang=135+270*clamp(uiR/8000,0,1.04);
  $('uiNeedle').style.transform='rotate('+ang.toFixed(1)+'deg)';
  const w=clamp(player.ks||0,-1,1)*180;uiWheelA+=(w-uiWheelA)*Math.min(1,dt*14);
  $('uiWheel').style.transform='rotate('+uiWheelA.toFixed(1)+'deg)';
}
function uiHud(){
  if(!UI||!player)return;
  $('uiOdo').textContent=(Math.max(0,player.P-(player.P0||0))/1000).toFixed(2)+' km';
  $('uiTrac').hidden=!(player.slip>.45&&player.speed>8);
  const x=$('uiDmg').getContext('2d');if(!uiDm.white.base)return;
  x.clearRect(0,0,128,128);x.globalAlpha=.9;x.drawImage(uiDm.white.base,0,0);
  for(const g of Object.values(UI_DMG)){const v=clamp(player.dmg[g[0]]||0,0,1);
    g[1].forEach((p,i)=>{x.globalAlpha=.32;x.drawImage(uiDm.white[p],0,0);
      const a=v*(i?.75:1);if(a>.03){x.globalAlpha=Math.min(1,a);x.drawImage(uiDm.red[p],0,0)}})}
  x.globalAlpha=1;
}

/* ================= 5. Linha de corrida (IA, progresso, minimapa) ================= */
const AIP=EXT.ai, NN=AIP.length;
const cum=new Float64Array(NN+1), seg=new Float64Array(NN);
for(let i=0;i<NN;i++){const a=AIP[i],b=AIP[(i+1)%NN];seg[i]=Math.hypot(b[0]-a[0],b[2]-a[2]);cum[i+1]=cum[i]+seg[i]}
const LAP=cum[NN];
const NP=i=>AIP[((i%NN)+NN)%NN];
function splineAt(s){ // posição e tangente (Catmull-Rom fechada)
  s=((s%LAP)+LAP)%LAP;let lo=0,hi=NN-1;while(lo<hi){const m=(lo+hi+1)>>1;if(cum[m]<=s)lo=m;else hi=m-1}
  const i=lo,t=(s-cum[i])/seg[i],p0=NP(i-1),p1=NP(i),p2=NP(i+1),p3=NP(i+2),t2=t*t,t3=t2*t;
  const f=k=>.5*((2*p1[k])+(-p0[k]+p2[k])*t+(2*p0[k]-5*p1[k]+4*p2[k]-p3[k])*t2+(-p0[k]+3*p1[k]-3*p2[k]+p3[k])*t3);
  const d=k=>.5*((-p0[k]+p2[k])+2*(2*p0[k]-5*p1[k]+4*p2[k]-p3[k])*t+3*(-p0[k]+3*p1[k]-3*p2[k]+p3[k])*t2);
  const tx=d(0),tz=d(2),l=Math.hypot(tx,tz)||1;
  return {x:f(0),y:f(1),z:f(2),tx:tx/l,tz:tz/l,i,wl:lerp(p1[4],p2[4],t),wr:lerp(p1[5],p2[5],t)}}
// perfil de velocidade: limite de curva + frenagem e aceleração propagadas
const VPROF=new Float64Array(NN);
(function(){
  const ang=i=>{const a=NP(i-1),b=NP(i+1);return Math.atan2(b[0]-a[0],b[2]-a[2])};
  const kap=new Float64Array(NN);
  for(let i=0;i<NN;i++){kap[i]=Math.abs(wrapPI(ang(i+1)-ang(i-1)))/(seg[(i-1+NN)%NN]+seg[i]+1e-6)*1.0}
  for(let i=0;i<NN;i++){const k=Math.max(kap[i],kap[(i+1)%NN]*.8,kap[(i-1+NN)%NN]*.8);VPROF[i]=Math.min(84,Math.sqrt(15.5/Math.max(k,1e-4)))}
  for(let pass=0;pass<3;pass++){
    for(let i=NN*2-1;i>=0;i--){const a=i%NN,b=(i+1)%NN;VPROF[a]=Math.min(VPROF[a],Math.sqrt(VPROF[b]**2+2*13*seg[a]))}
    for(let i=0;i<NN*2;i++){const a=i%NN,b=(i+1)%NN;const acc=8.5*Math.max(.15,1-VPROF[a]/90);VPROF[b]=Math.min(VPROF[b],Math.sqrt(VPROF[a]**2+2*acc*seg[a]))}
  }
})();
const vProfAt=s=>{s=((s%LAP)+LAP)%LAP;let lo=0,hi=NN-1;while(lo<hi){const m=(lo+hi+1)>>1;if(cum[m]<=s)lo=m;else hi=m-1}
  return lerp(VPROF[lo],VPROF[(lo+1)%NN],(s-cum[lo])/seg[lo])};
function trackS(x,z,hint){ // projeta na linha: s, deslocamento lateral e índice do segmento
  let best=1e18,bi=0,bt=0;
  const test=i=>{const a=NP(i),b=NP(i+1);const dx=b[0]-a[0],dz=b[2]-a[2],L=dx*dx+dz*dz;
    let t=L?((x-a[0])*dx+(z-a[2])*dz)/L:0;t=clamp(t,0,1);const px=a[0]+dx*t,pz=a[2]+dz*t,d=(x-px)**2+(z-pz)**2;
    if(d<best){best=d;bi=((i%NN)+NN)%NN;bt=t}};
  if(hint>=0){for(let k=-4;k<=8;k++)test(hint+k)}
  if(hint<0||best>60*60){best=1e18;for(let i=0;i<NN;i++)test(i)}
  const s=cum[bi]+seg[bi]*bt;const a=NP(bi),b=NP(bi+1);const tx=b[0]-a[0],tz=b[2]-a[2],l=Math.hypot(tx,tz)||1;
  const px=a[0]+tx*bt,pz=a[2]+tz*bt;const lat=((x-px)*(tz/l)*-1+(z-pz)*(tx/l));
  return {s,idx:bi,dist:Math.sqrt(best),lat,tx:tx/l,tz:tz/l}}

/* ================= 6. Carro: física ================= */
function engTorque(rpm){const x=rpm/10000;if(x>=TQ[TQ.length-1][0])return 0;for(let i=1;i<TQ.length;i++)if(x<=TQ[i][0]){const a=TQ[i-1],b=TQ[i];return(a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]))/MD.tqMax*MD.peakNm}return 0}
const MU=[1.35,1.2,.62,.55], CRR=[.015,.03,.12,.08];
class Car{
  constructor(){this.reset(0,0,0,0)}
  reset(x,y,z,th){Object.assign(this,{x,y,z,th,vx:0,vz:0,w:0,steer:0,ks:0,rpm:CP.idle,gear:1,shiftT:0,thr:0,brk:0,ax:0,ay:0,pitch:0,roll:0,
    spin:0,slip:0,surf:0,hit:0,sPrev:0,P:0,idx:-1,lap:0,hb:0,miss:0,dmg:[0,0,0,0],hurt:0,fuse:0,boom:false,warn:0,dents:[],boostT:0})}
  get speed(){return Math.hypot(this.vx,this.vz)}
  get vf(){return this.vx*Math.sin(this.th)+this.vz*Math.cos(this.th)}
}
const MAXDENT=8, DENT_MAX=.16;
const dentNow=()=>performance.now()/1000;
// (nx,nz) = normal da batida no mundo (do obstáculo para o carro); off = posição do círculo de colisão ao longo do carro
function addDent(c,nx,nz,sev,off){
  if(!c.dents)c.dents=[];
  const sn=Math.sin(c.th),cs=Math.cos(c.th);
  const nf=nx*sn+nz*cs, nr=nx*cs-nz*sn;               // normal em coordenadas do carro (x = lado, z = frente)
  const hl=Math.hypot(nr,nf);if(hl<.2)return;
  const dx=nr/hl, dz=nf/hl;                             // o metal é empurrado para dentro (sentido da normal)
  const px=clamp(-dx*.95,-CP.hw,CP.hw), pz=clamp((off||0)-dz*.95,-CP.hl,CP.hl), py=.08;
  const dy=Math.abs(dz)>.5?.14:0, dl=Math.hypot(dx,dy,dz);
  if(sev<.04)return;const add=Math.min(DENT_MAX,sev*.3), now=dentNow();
  for(const d of c.dents){
    if(Math.hypot(d.x-px,d.z-pz)<.7&&d.dx*dx+d.dz*dz>.4){      // mesma região: aprofunda de leve (no máx. 1 vez a cada 0,25 s)
      if(now-d.last<.25)return;d.last=now;
      d.prev=d.cur(now);d.A=Math.min(DENT_MAX,d.A+add*(1-d.A/(DENT_MAX*1.15)));d.t0=now;
      d.x+=(px-d.x)*.2;d.z+=(pz-d.z)*.2;d.s=.45+1.5*d.A;return}
  }
  const d={x:px,y:py,z:pz,dx:dx/dl,dy:dy/dl,dz:dz/dl,A:add,prev:0,t0:now,last:now,s:.45+1.5*add,
    cur(t){const k=Math.min(1,(t-this.t0)/.18),e=1-(1-k)*(1-k)*(1-k);return this.prev+(this.A-this.prev)*e}};
  if(c.dents.length>=MAXDENT){let w=0;for(let i=1;i<c.dents.length;i++)if(c.dents[i].A<c.dents[w].A)w=i;c.dents.splice(w,1)}
  c.dents.push(d)}
const dentP=new Float32Array(32), dentD=new Float32Array(32);
function uploadDents(c){
  dentP.fill(0);dentD.fill(0);const L=c.dents;
  if(L&&L.length){const now=dentNow();
    for(let i=0;i<L.length&&i<MAXDENT;i++){const d=L[i],o=i*4;
      dentP[o]=d.x;dentP[o+1]=d.y;dentP[o+2]=d.z;dentP[o+3]=d.s;
      dentD[o]=d.dx;dentD[o+1]=d.dy;dentD[o+2]=d.dz;dentD[o+3]=d.cur(now)}}
  gl.uniform4fv(carP.u.u_dp,dentP);gl.uniform4fv(carP.u.u_dd,dentD)}
function addDmg(c,nx,nz,sev,off){
  if(!c.dmg||c.dmgCd>0)return;c.dmgCd=.15;sev*=MD.SA.cdm/.54; /* collisionDamageMultiplier do handling.cfg */ const sn=Math.sin(c.th),cs=Math.cos(c.th),nf=nx*sn+nz*cs,nr=nx*cs-nz*sn;
  c.dmg[0]=Math.min(1.2,c.dmg[0]+sev*Math.max(0,-nf));c.dmg[1]=Math.min(1.2,c.dmg[1]+sev*Math.max(0,nf));
  c.dmg[2]=Math.min(1.2,c.dmg[2]+sev*Math.max(0,nr));c.dmg[3]=Math.min(1.2,c.dmg[3]+sev*Math.max(0,-nr));
  if(c.isPlayer&&state==='race'){c.hurt+=sev*2;if(sev>.08)fxSparks(c.x-nx*.9,c.y+.1,c.z-nz*.9,-nx,-nz,Math.ceil(sev*16))}
  addDent(c,nx,nz,sev,off)}
function stepCar(c,inp,dt){
  c.dmgCd=Math.max(0,(c.dmgCd||0)-dt);
  const sn=Math.sin(c.th),cs=Math.cos(c.th);
  let vf=c.vx*sn+c.vz*cs, vl=c.vx*cs-c.vz*sn; const sp=Math.hypot(c.vx,c.vz);
  // direção
  const raw=inp.steer;c.ks+=clamp(raw-c.ks,-(raw===0?7:4.5)*dt,(raw===0?7:4.5)*dt);
  const SA=MD.SA,maxS=.52*(SA.lock/30)/(1+(sp/22)**2), tgt=c.ks*maxS+(c.dmg[3]-c.dmg[2])*.012, rate=.9+3.5/(1+sp/12);
  c.steer+=clamp(tgt-c.steer,-rate*dt,rate*dt);
  const mu=MU[c.surf]*(SA.tm/.7), g=9.81, down=.55*sp*sp;   // tractionMultiplier do handling.cfg (Eudora = referência .70)
  const Fz=CP.m*g+down, L=CP.a+CP.b;
  const trans=clamp(c.ax*CP.m*(.55+SA.comZ*.3)/L,-Fz*.25,Fz*.25);   // altura do centro de massa (comZ) aumenta a transferência de peso
  const Fzf=Fz*CP.b/L-trans, Fzr=Fz*CP.a/L+trans;
  // motor e câmbio
  let gearRatio=c.gear>0?CP.gear[c.gear]:-CP.rev;
  const wheelRpm=Math.abs(vf)/CP.wr*Math.abs(gearRatio)*CP.fin*60/(2*Math.PI);
  let rpm=Math.max(CP.idle,wheelRpm);
  if(c.gear===1&&sp<5)rpm=Math.max(rpm,lerp(CP.idle+inp.thr*4300,wheelRpm,sp/5));
  c.rpm+=(rpm-c.rpm)*Math.min(1,dt*14*(15/SA.inert));
  c.shiftT=Math.max(0,c.shiftT-dt);
  if(c.gear>0&&c.shiftT===0){
    if(c.rpm>(CP.up||6900)&&c.gear<CP.gear.length-1){c.gear++;c.shiftT=.18}
    else if(c.rpm<3000&&c.gear>1&&sp>3){c.gear--;c.shiftT=.12}
  }
  // entradas longitudinais
  let thr=inp.thr,brk=inp.brk;
  if(brk>0&&vf<1&&thr===0&&sp<3){c.gear=-1}else if(c.gear<0&&(thr>0||vf>2)){c.gear=1}
  gearRatio=c.gear>0?CP.gear[c.gear]:-CP.rev;
  let Fxr=0,Fxf=0;
  if(c.gear<0){ if(brk>0)Fxr=-brk*Math.min(7000,engTorque(3000)*CP.rev*CP.fin*.9/CP.wr*.5); thr=0; brk=(inp.thr>0&&vf<-.5)?inp.thr:0; }
  else{ const T=(c.shiftT>0||c.rpm>CP.red+450)?0:engTorque(c.rpm);
    Fxr=thr*T*gearRatio*CP.fin*.88/CP.wr;
    if(thr===0)Fxr-= (60+c.rpm*.012)*gearRatio*CP.fin*.88/CP.wr*Math.sign(vf||1)*(Math.abs(vf)>.5?1:0);
  }
  if(Fxr>0)Fxr*=1-.28*Math.min(1,c.dmg[0]);
  const kF=SA.tb/.5,kR=(1-SA.tb)/.5;   // tractionBias: divisão de aderência dianteira/traseira
  const FmaxR=mu*kR*Fzr*(inp.hb?.5:1), FmaxF=mu*kF*Fzf;
  let spinning=false,lockF=false;
  if(Fxr>FmaxR*.93){Fxr=FmaxR*.93;spinning=thr>.8}
  if(inp.hb){ brk=Math.max(brk,0) }
  // freios
  if(brk>0&&Math.abs(vf)>.3){
    const Fb=brk*1.5*(SA.bd/5.4)*CP.m*g, s=Math.sign(vf);   // brakeDecel e brakeBias do handling.cfg
    const Ff=Fb*SA.bb;lockF=!SA.abs&&Ff>FmaxF*1.15;   // sem ABS: travar a frente tira aderência lateral
    Fxf=-s*Math.min(Ff,FmaxF*.96); Fxr+=-s*Math.min(Fb*(1-SA.bb),mu*kR*Fzr*.9);
  }else if(brk>0&&vf<.3&&c.gear>=0){ /* parado */ }
  if(inp.hb&&Math.abs(vf)>.5)Fxr+=-Math.sign(vf)*Math.min(CP.m*g*.5,FmaxR*.8);
  // pneus
  const vfa=Math.max(Math.abs(vf),1.6), sgn=vf>=-.2?1:-1;
  const aF=Math.atan2(vl+CP.a*c.w,vfa)-c.steer*sgn, aR=Math.atan2(vl-CP.b*c.w,vfa);
  const capF=Math.sqrt(Math.max((mu*kF*Fzf)**2-(.65*Fxf)**2,(.3*mu*kF*Fzf)**2))*(lockF?.8:1);
  const capR=Math.sqrt(Math.max(FmaxR**2-(.65*Fxr)**2,(.3*FmaxR)**2))*(spinning?1-.15*SA.tl:1);   // tractionLoss: patinando perde aderência lateral
  const tire=(a,cap)=>-cap*Math.sin(1.5*Math.atan(14*a));
  const Fyf=tire(aF,capF), Fyr=tire(aR,capR);
  c.slip=clamp((Math.max(Math.abs(aR),Math.abs(aF)*.8)-.07)*7,0,1)*clamp(sp/6,0,1);
  if(spinning)c.slip=Math.max(c.slip,.6);
  if(brk>.6&&sp>25&&Math.abs(Fxf)>=FmaxF*.9)c.slip=Math.max(c.slip,.35);
  c.gr=clamp(Math.hypot(Math.max(Math.abs(aR),Math.abs(aF))/.1237,Math.max(Math.abs(Fxr)/FmaxR,Math.abs(Fxf)/FmaxF)),0,1); // uso do pneu (pico do modelo em ~0,124 rad)
  // resistências
  const drag=.5*1.2*.95*(SA.drag/2), roll=CRR[c.surf]*Fz, scrub=c.surf>=2?.9*sp*CP.m*.04:0;
  const dfx=-(drag*sp*vf+ (Math.abs(vf)>.2?Math.sign(vf)*(roll+scrub):vf*roll*4)); // ao longo do eixo do carro
  const dfy=-(drag*sp*vl+vl*4*(c.surf>=2?60:0));
  const cd=Math.cos(c.steer),sd=Math.sin(c.steer);
  const FxB=Fxr+Fxf*cd-Fyf*sd+dfx, FyB=Fyr+Fyf*cd+Fxf*sd+dfy;
  const torque=CP.a*(Fyf*cd+Fxf*sd)-CP.b*Fyr-900*c.w;
  const ax=FxB/CP.m, ay=FyB/CP.m;
  c.vx+=(sn*ax+cs*ay)*dt; c.vz+=(cs*ax-sn*ay)*dt;
  // baixa velocidade: estabiliza e permite parar
  if(sp<1.2&&thr===0&&brk===0){const k=Math.max(0,1-dt*3);c.vx*=k;c.vz*=k}
  c.w+=torque/CP.Iz*dt; c.w=clamp(c.w,-3,3); if(sp<.4)c.w*=.9;
  if(c.boostT>0){const A=11*clamp((82-sp)/30,0,1);c.vx+=sn*A*dt;c.vz+=cs*A*dt}
  c.th+=c.w*dt; c.x+=c.vx*dt; c.z+=c.vz*dt;
  c.ax+=(ax-c.ax)*Math.min(1,dt*6); c.ay+=(ay-c.ay)*Math.min(1,dt*6);
  c.spin+=(vf/CP.wr+(spinning?30:0))*dt; c.thr=inp.thr; c.brk=inp.brk; c.hb=inp.hb;
}
// altura/inclinação a partir dos pontos de contato das rodas
const WP=[[-1,1],[1,1],[-1,-1],[1,-1]];
function settle(c,dt,snap){
  const sn=Math.sin(c.th),cs=Math.cos(c.th),fx=sn,fz=cs,rx=cs,rz=-sn;
  const h=[0,0,0,0];let n=0,sum=0,miss=0;
  for(let i=0;i<4;i++){
    const lx=WP[i][0]*CP.wx,lz=WP[i][1]>0?CP.wfz:CP.wrz;
    const wx=c.x+rx*lx+fx*lz,wz=c.z+rz*lx+fz*lz;
    if(groundAt(wx,wz,c.y+.35)){h[i]=gH;sum+=gH;n++;if(i>=2)c.surf=gSurf}else{h[i]=NaN;miss++}
  }
  if(n===0){c.miss+=dt;return false}
  c.miss=0;const avg=sum/n;for(let i=0;i<4;i++)if(isNaN(h[i]))h[i]=avg;
  const tY=(h[0]+h[1]+h[2]+h[3])/4+CP.ride;
  const k=snap?1:Math.min(1,dt*18);c.y+=(tY-c.y)*k;
  const SA=MD.SA,pT=Math.atan2((h[0]+h[1])/2-(h[2]+h[3])/2,CP.wfz-CP.wrz)+c.ax*.0025*(1.1/SA.susF)*(1-SA.anti*.5);   // suspensão: rigidez e anti-mergulho
  const rT=Math.atan2((h[1]+h[3])/2-(h[0]+h[2])/2,CP.wx*2)+c.ay*.004*(1.1/SA.susF);
  const kk=snap?1:Math.min(1,dt*12);c.pitch+=(pT-c.pitch)*kk;c.roll+=(rT-c.roll)*kk;
  return true}
// colisão com paredes (círculos ao longo do carro)
const OFFS=[-1.5,-.5,.5,1.5];
function collideWalls(c){
  const sn=Math.sin(c.th),cs=Math.cos(c.th),gy=c.y-CP.ride;const rr=.95;let hit=0;
  for(const off of OFFS){
    let cx=c.x+sn*off,cz=c.z+cs*off;
    const cell=wCells.get(gridKey(Math.floor(cx/CS),Math.floor(cz/CS)));if(!cell)continue;
    for(let q=0;q<cell.length;q++){
      const o=cell[q]*6;if(WS[o+5]<gy+.15||WS[o+4]>gy+1.0)continue;
      const x1=WS[o],z1=WS[o+1],dx=WS[o+2]-x1,dz=WS[o+3]-z1,L=dx*dx+dz*dz;
      let t=L?((cx-x1)*dx+(cz-z1)*dz)/L:0;t=clamp(t,0,1);
      const px=x1+dx*t,pz=z1+dz*t;let nx=cx-px,nz=cz-pz;const d=Math.hypot(nx,nz);
      if(d>=rr)continue;
      c.wallT=.12;
      if(d<1e-4){nx=cs;nz=-sn}else{nx/=d;nz/=d}
      const pen=rr-d;c.x+=nx*pen;c.z+=nz*pen;cx+=nx*pen;cz+=nz*pen;
      const vn=c.vx*nx+c.vz*nz;
      if(vn<0){const dv=-(1+.18)*vn;c.vx+=dv*nx;c.vz+=dv*nz;
        const tx=-nz,tz=nx,vt_=c.vx*tx+c.vz*tz,fr=Math.min(Math.abs(vt_),.3*dv)*Math.sign(vt_);c.vx-=fr*tx;c.vz-=fr*tz; // atrito de Coulomb: raspar na parede freia
        c.w+=off*(dv*(nx*cs-nz*sn))/1.9*.5;hit=Math.max(hit,-vn);
        if(-vn>4)addDmg(c,nx,nz,Math.min(.6,(-vn-4)/22*.6),off)}
    }
  }
  if(hit>c.hit)c.hit=hit;
}

/* ================= 7. Estado do jogo ================= */
const NAMES=['Marlow','Kowalski','Tran','Okafor','Reyes','Lindqvist'];
/* Personalidades da IA (cada rival mantém a sua pelo nome). sk = ritmo; bf = medo de curva (>0 freia cedo, <0 freia tarde); mr = frequência de erros (maior = mais erros);
   mp = tamanho do erro; aggr = agressividade (fecha a porta, empurra, freia na frente); yld = cede passagem; risk = tenta ultrapassagens arriscadas;
   show = zigue-zague de exibido; look = distância de olhar para frente (menor = encosta mais na traseira) */
const PERS={
  Marlow:   {tag:'Esperto',    sk:1.00,bf:.00,mr:.35,mp:.6,aggr:0,  yld:0,  risk:0,  show:0,look:1.25,draft:3.2},
  Kowalski: {tag:'Malandro',   sk:.985,bf:.03,mr:1,  mp:1,aggr:1,  yld:0,  risk:.2, show:0,look:1,   draft:1.5},
  Tran:     {tag:'Medroso',    sk:.935,bf:.16,mr:.7, mp:1,aggr:0,  yld:1,  risk:0,  show:0,look:1.4, draft:0},
  Okafor:   {tag:'Rapidinho',  sk:1.045,bf:-.05,mr:1.7,mp:1.5,aggr:.1,yld:0, risk:.25,show:0,look:.6, draft:1.5},
  Reyes:    {tag:'Quer dar de esperto',sk:.99,bf:.0,mr:1.2,mp:1.2,aggr:.15,yld:0,risk:1,show:1,look:.9,draft:1.5},
  Lindqvist:{tag:'Regular',    sk:.975,bf:.05,mr:1,  mp:1,aggr:0,  yld:.3, risk:0,  show:0,look:1,   draft:1.5}};
const PERS_DEF={tag:'Regular',sk:1,bf:0,mr:1,mp:1,aggr:0,yld:0,risk:0,show:0,look:1,draft:1.5};
function setPers(a){a.pers=PERS[a.name]||PERS_DEF;a.persId=Math.max(0,NAMES.indexOf(a.name));a.chkT=0;a.lunge=0;a.lungeCd=4+Math.random()*6}
let cfg={car:MD.id,skin:MD.skins[0].id,laps:2,rivals:5,level:1,mode:0,ped:0};
const CROWD_ON=false;   // torcida/pedestres 3D da pista DESATIVADOS (nenhum pedestre no jogo). true para reativar.
const PED_ON=false;   // pedestre jogável DESATIVADO por enquanto (embarque, descer do carro, andar). Mude para true para reativar; a torcida 3D continua.
let walkMode=false,onFoot=false,savedCam=0,deadPed=false,freeMode=false;
const footOn=()=>(walkMode||onFoot)&&WLK.on;
let state='menu', player=null, ais=[], raceT=0, cdT=0, finishT=0, lapStart=0, bestLap=0, lastLap=0, flashT=0;
const input={steer:0,thr:0,brk:0,hb:0};
let camMode=0, camAng=0, camPos=[0,0,0], camInit=false, paused=false, menuT=0;
let auto=false;

function gridSlot(k){const gap=10+7.5*k, lat=(k%2?2.1:-2.1);const sp=splineAt(LAP-gap);return {sp,lat,gap}}
function placeOnLine(c,s,lat){
  const sp=splineAt(s);const rx=sp.tz,rz=-sp.tx;
  c.x=sp.x+rx*lat;c.z=sp.z+rz*lat;c.th=Math.atan2(sp.tx,sp.tz);c.y=sp.y+CP.ride;c.vx=c.vz=c.w=0}
function startRace(){trophy=null;freeMode=cfg.mode===2;walkMode=freeMode||(PED_ON&&cfg.mode===1&&!!(PD&&PD.types&&PD.types.length));document.body.classList.toggle('walk',walkMode&&!freeMode);if(walkMode)camMode=0;
  {const sb=document.querySelector('#tB span'),sg=document.querySelector('#tG span');if(sb)sb.textContent=walkMode?'Ré':'Freio';if(sg)sg.textContent=walkMode?'Andar':'Acelerar'}
  {const n=document.getElementById("camName");if(n)n.textContent=camShort()[camMode]}
  {const h=$('help');if(h){if(!h.dataset.o)h.dataset.o=h.textContent;h.textContent=walkMode?'WASD / setas andar · Shift correr · C câmera (pedestre / 1ª pessoa / acompanhar carro) · R voltar ao ponto inicial · P pausa · M som':h.dataset.o}}
  const n=cfg.rivals+1, slots=[];for(let k=0;k<n;k++)slots.push(k);
  const pk=Math.min(3,n-1);
  player=new Car();player.skin=cfg.skin;player.name='Você';player.isPlayer=!walkMode;
  const gs=gridSlot(pk);placeOnLine(player,LAP-gs.gap,gs.lat);settle(player,0,true);
  const ts=trackS(player.x,player.z,-1);player.sPrev=ts.s;player.idx=ts.idx;player.P=ts.s-LAP;player.P0=player.P;
  ais=[];let ni=0;
  const base=[.8,.89,.97][cfg.level];
  for(const k of slots){ if(k===pk)continue;
    const a=new Car();const g=gridSlot(k);
    {const SK=MD.skins.map(s=>s.id);a.skin=SK[(SK.indexOf(cfg.skin)+1+ni)%SK.length]}a.name=NAMES[ni%NAMES.length];a.isAI=true;
    a.s=LAP-g.gap;a.P=a.s-LAP;a.v=0;a.lane=g.lat;a.laneT=g.lat;a.skill=base*(1-.03*ni*(cfg.level===0?1:.5)+(Math.sin(ni*7.3)*.012));setPers(a);a.skill*=a.pers.sk/(1-.03*ni*(cfg.level===0?1:.5));
    a.th=0;a.finished=false;a.lastS=a.s;a.best=0;a.lapStart=0;
    aiPlace(a,0,true);ais.push(a);ni++}
  if(walkMode){const a=player;a.isAI=true;a.isPlayer=false;a.skill=base*.97;a.s=LAP-gs.gap;a.P=a.s-LAP;a.v=0;a.lane=gs.lat;a.laneT=gs.lat;a.th=0;a.lastS=a.s;a.best=0;a.lapStart=0;a.name=NAMES[ni%NAMES.length];setPers(a);a.skill*=a.pers.sk;aiPlace(a,0,true);
    const ts2=trackS(a.x,a.z,-1);a.idx=ts2.idx}
  raceT=0;cdT=4.2;finishT=0;lapStart=0;bestLap=0;lastLap=0;flashT=0;player.finished=false;player.finTime=0;player.best=0;
  camInit=false;pickInit();if(walkMode&&!freeMode)walkInit();else WLK.on=false;
  deadPed=false;onFoot=false;footUI(walkMode&&!freeMode);setGoTexts(false);
  if(freeMode){freeInit();const h=$('help');if(h)h.textContent='WASD mover · Q/E descer/subir · setas ou arrastar o mouse olhar · Shift rápido · roda do mouse muda a velocidade · C câmera (livre / 1ª pessoa / espectador) · P pausa · M som';const n=document.getElementById('camName');if(n)n.textContent=camShort()[camMode]}
  setScreen('hud');state='countdown';$('msg').className='';
  if(PED_ON&&!walkMode&&PD&&PD.types&&PD.types.length&&!/[?&]semembarque/.test(location.search)){boardInit();state='board'}   // a corrida só começa depois que a pedestre entra no carro
  const ct=$('touch');if(matchMedia('(pointer:coarse)').matches)ct.classList.add('on');
  updatePosHud();
}
function aiPlace(a,dt,snap){
  const sp=splineAt(a.s);a.laneNow=a.laneNow===undefined?a.lane:a.laneNow;
  const rx=sp.tz,rz=-sp.tx;
  a.x=sp.x+rx*a.laneNow;a.z=sp.z+rz*a.laneNow;
  const thT=Math.atan2(sp.tx,sp.tz)+(a.yawOff||0);
  a.th=snap?thT:a.th+wrapPI(thT-a.th)*Math.min(1,(dt||0)*10);
  a.steer=snap?0:clamp(wrapPI(thT-a.th)*1.5,-.4,.4);
  if(snap)a.y=sp.y+CP.ride;
  if(!settle(a,dt||0,snap)){a.y=sp.y+CP.ride}
}
function resetPlayer(){
  const ts=trackS(player.x,player.z,player.idx);const sp=splineAt(ts.s);
  player.x=sp.x;player.z=sp.z;player.th=Math.atan2(sp.tx,sp.tz);player.y=sp.y+CP.ride;player.vx=player.vz=player.w=0;player.gear=1;player.steer=0;player.ks=0;
  settle(player,0,true);flashMsg('Reposicionado');
}
function fmt(t){if(!(t>0))return '–:––.–––';const m=Math.floor(t/60),s=t-m*60;return m+':'+(s<10?'0':'')+s.toFixed(3)}
let msgTimer=0;
function flashMsg(t,small=true,dur=1.6){const m=$('msg');m.textContent=t;m.className=small?'sm':'';msgTimer=dur}

function allCars(){return [player,...ais]}
function standings(){return allCars().slice().sort((a,b)=>b.P-a.P)}
function updatePosHud(){
  if(walkMode){const L=standings()[0];$('pos').innerHTML='<span style="font-size:.34em;letter-spacing:.08em;opacity:.7">LÍDER</span><br><span style="font-size:.46em">'+L.name+'</span>';$('lapl').textContent='Volta '+clamp(Math.floor(L.P/LAP)+1,1,cfg.laps)+'/'+cfg.laps;$('times').innerHTML='Tempo <b>'+fmt(Math.max(0,raceT))+'</b>';return}
  const st=standings(),pos=st.indexOf(player)+1;
  $('pos').innerHTML=pos+'<small>/'+st.length+'</small>';
  const lap=clamp(Math.floor(player.P/LAP)+1,1,cfg.laps);$('lapl').textContent='Volta '+lap+'/'+cfg.laps;
  $('times').innerHTML='Tempo <b>'+fmt(Math.max(0,raceT))+'</b><br>Volta <b>'+fmt(Math.max(0,raceT-lapStart))+'</b><br>Melhor <b>'+fmt(bestLap)+'</b>';
}

/* ================= 8. Atualização por passo ================= */
const DT=1/120;let acc=0;
function readInput(){
  let st=0,thr=0,brk=0,hb=0;
  if(keys.ArrowLeft||keys.KeyA||touch.l)st-=1;if(keys.ArrowRight||keys.KeyD||touch.r)st+=1;
  if(keys.ArrowUp||keys.KeyW||touch.g)thr=1;if(keys.ArrowDown||keys.KeyS||touch.b)brk=1;if(keys.Space)hb=1;
  const gp=(navigator.getGamepads&&navigator.getGamepads()[0]);
  if(gp){const ax=gp.axes[0]||0;if(Math.abs(ax)>.12)st=ax;thr=Math.max(thr,gp.buttons[7]?gp.buttons[7].value:0);brk=Math.max(brk,gp.buttons[6]?gp.buttons[6].value:0);if(gp.buttons[0]&&gp.buttons[0].pressed)hb=1}
  input.steer=st;input.thr=thr;input.brk=brk;input.hb=hb}
function autopilot(){ // piloto automático usado nos testes
  const ts=trackS(player.x,player.z,player.idx);
  const look=splineAt(ts.s+8+player.speed*.55);const dx=look.x-player.x,dz=look.z-player.z;
  const want=Math.atan2(dx,dz),err=wrapPI(want-player.th);
  input.steer=clamp(err*2.2,-1,1);
  const vt=vProfAt(ts.s+player.speed*1.2)*.9;
  input.thr=player.speed<vt?1:0;input.brk=player.speed>vt*1.08?1:0;input.hb=0}
function step(dt){
  if(state==='board'){settle(player,dt,false);walkStep(dt);return}
  if(state==='countdown'){
    cdT-=dt;
    const n=Math.ceil(cdT-.2);
    if(cdT>.2){const t=n>3?'':String(n);if($('msg').textContent!==t){$('msg').textContent=t;$('msg').className='';beep(n>0?440:880,.12)}}
    else if(cdT>-.01){}
    if(cdT<=.2){state='race';$('msg').textContent='Vai!';$('msg').className='';msgTimer=1.2;beep(880,.35);raceT=0}
    if(!walkMode)settle(player,dt,false);walkStep(dt);
    return}
  if(state==='gameover'){raceT+=dt;goT+=dt;shakeT=Math.max(0,shakeT-dt);for(const a of ais)stepAI(a,dt);carFx(player,dt);if(goT>2.8&&$('gameover').hidden)showGameOver();return}
  if(state!=='race'&&state!=='finish')return;
  raceT+=dt;walkStep(dt);
  if(walkMode){walkRace(dt);return}
  if(onFoot){input.steer=0;input.thr=0;input.brk=.8;input.hb=1}   // a pé: o carro fica parado com o freio de mão
  else if(auto&&!player.finished)autopilot();else if(!auto)readInput();
  const inp=player.finished?{steer:0,thr:0,brk:.6,hb:0}:input;
  stepCar(player,inp,dt);
  if(onFoot&&Math.hypot(player.vx,player.vz)<1.8){player.vx=player.vz=player.w=0}   // parado de verdade enquanto ela está a pé
  settle(player,dt,false);
  collideWalls(player);
  // progresso
  const ts=trackS(player.x,player.z,player.idx);player.idx=ts.idx;player.lat=ts.lat;
  let d=ts.s-player.sPrev;if(d>LAP/2)d-=LAP;else if(d<-LAP/2)d+=LAP;
  const prevP=player.P;player.P+=d;player.sPrev=ts.s;
  player.tx=ts.tx;player.tz=ts.tz;
  if(Math.floor(player.P/LAP)>Math.floor(prevP/LAP)&&prevP<0){lapStart=raceT}
  else if(Math.floor(player.P/LAP)>Math.floor(prevP/LAP)){ // cruzou a linha
    const lt=raceT-lapStart;
    if(player.P>=LAP*cfg.laps-1e-6&&!player.finished){player.finished=true;player.finTime=raceT;player.best=bestLap=(bestLap>0?Math.min(bestLap,lt):lt);lastLap=lt;finishT=0;if(!walkMode){state='finish';flashMsg('Bandeirada!',false,4);beep(660,.5)}}
    else{lastLap=lt;if(bestLap===0||lt<bestLap)bestLap=lt;lapStart=raceT;player.best=bestLap;if(!walkMode)flashMsg('Volta '+fmt(lt),true,2.4);beep(760,.18)}
  }
  // IA
  for(const a of ais)stepAI(a,dt);
  // colisões: jogador x IA e IA x IA (impulso entre dois corpos)
  if(!player.boom)for(const a of ais){const dxs=player.x-a.x,dzs=player.z-a.z;if(dxs*dxs+dzs*dzs<36)carBump(player,a)}
  for(let i=0;i<ais.length;i++)for(let j=i+1;j<ais.length;j++){const a=ais[i],b=ais[j];if(Math.abs(a.P-b.P)>7)continue;const dxs=a.x-b.x,dzs=a.z-b.z;if(dxs*dxs+dzs*dzs<36)carBump(a,b)}
  // fora do mapa
  if(player.miss>1.2||player.y<-50){resetPlayer()}
  else if(SEA&&state==='race'&&player.y-CP.ride<SEA.y+.1){seaSplash(player.x,player.z);resetPlayer();flashMsg('Caiu no mar!')}
  carFx(player,dt);shakeT=Math.max(0,shakeT-dt);pickStep(dt);
  // partículas
  emitSmoke(player,dt);
  if(player.dmg[0]>.55&&Math.random()<dt*22){const sn=Math.sin(player.th),cs=Math.cos(player.th);
    emit(player.x+sn*1.7,player.y+.45,player.z+cs*1.7,player.vx*.5+(Math.random()-.5)*.5,1.2,player.vz*.5+(Math.random()-.5)*.5,.9,[.22,.22,.22],1.6)}
  for(const a of ais)if(a.v>25&&Math.random()<.03)emitSmoke(a,dt);
  // posição / HUD
  if(state==='finish'){finishT+=dt;if(finishT>3.2&&$('result').hidden)showResult()}
  else if(onFoot&&state==='race'&&!deadPed&&ais.every(a=>a.finished)){state='finish';finishT=0;flashMsg('Corrida encerrada',false,3)}   // todos terminaram e ela ficou a pé
}
// a pé: a corrida roda normal com TODOS os carros em IA (inclusive o que seria do jogador); você segue andando e só encerra quando todos terminam
function walkRace(dt){
  const all=[player,...ais];
  for(const a of all)stepAI(a,dt);
  for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++){const a=all[i],b=all[j];if(Math.abs(a.P-b.P)>7)continue;const dxs=a.x-b.x,dzs=a.z-b.z;if(dxs*dxs+dzs*dzs<36)carBump(a,b)}
  const ts=trackS(player.x,player.z,player.idx);player.idx=ts.idx;player.lat=ts.lat;player.thr=player.ax>.2?1:0;
  shakeT=0;for(const a of all)if(a.v>25&&Math.random()<.03)emitSmoke(a,dt);
  if(all.every(a=>a.finished)){finishT+=dt;if(finishT>2&&$('result').hidden){flashMsg('Corrida encerrada',false,3);if(finishT>5)showResult()}}
}

// ---- contato entre carros: separa, troca impulso (restituição .22) e amassa os dois
function impulseTo(c,ix,iz,off){
  const sn=Math.sin(c.th),cs=Math.cos(c.th);
  if(c.isPlayer){c.vx+=ix;c.vz+=iz;c.w+=off*(ix*cs-iz*sn)/1.9*.4}
  else{const sp=splineAt(c.s),tx=sp.tx,tz=sp.tz,rx=tz,rz=-tx;
    c.v=Math.max(0,(c.v||0)+ix*tx+iz*tz);c.lv=clamp((c.lv||0)+ix*rx+iz*rz,-6,6);c.yawK=clamp((c.yawK||0)+off*(ix*cs-iz*sn)*.08,-.5,.5);c.vx+=ix;c.vz+=iz}}
function pushOut(c,sx,sz){
  if(c.isPlayer){c.x+=sx;c.z+=sz}
  else{const sp=splineAt(c.s);c.s+=sx*sp.tx+sz*sp.tz;c.laneNow+=sx*sp.tz-sz*sp.tx}}
function carBump(p,a){
  const ps=Math.sin(p.th),pc=Math.cos(p.th),as=Math.sin(a.th),ac=Math.cos(a.th);
  for(const po of [-1.4,0,1.4])for(const ao of [-1.4,0,1.4]){
    const px=p.x+ps*po,pz=p.z+pc*po,qx=a.x+as*ao,qz=a.z+ac*ao;
    let nx=px-qx,nz=pz-qz;const dd=Math.hypot(nx,nz);if(dd>=2.0||dd<1e-4)continue;
    nx/=dd;nz/=dd;const pen=2.0-dd,wp=p.isPlayer?.6:.5;
    pushOut(p,nx*pen*wp,nz*pen*wp);pushOut(a,-nx*pen*(1-wp),-nz*pen*(1-wp));
    const vn=((p.vx||0)-(a.vx||0))*nx+((p.vz||0)-(a.vz||0))*nz;
    if(vn<0){const j=-(1+.22)*vn*.5;impulseTo(p,j*nx,j*nz,po);impulseTo(a,-j*nx,-j*nz,ao);
      p.hitT=a.hitT=.9;if(p.isPlayer)p.hit=Math.max(p.hit,-vn);
      if(-vn>2.5){const sv=Math.min(.4,(-vn-2.5)/20*.4);
        if(p.isPlayer)addDmg(p,nx,nz,sv,po);else addDent(p,nx,nz,sv*.8,po);
        if(p.isPlayer&&a.pers&&a.pers.aggr>=.5&&sv>.05&&!walkMode)flashMsg(a.name+' ('+a.pers.tag+') te fechou!');
        addDent(a,-nx,-nz,sv*.8,ao);if(sv>.06)fxSparks((p.x+a.x)/2,p.y,(p.z+a.z)/2,nx,nz,Math.ceil(sv*14))}}}}
const curvAhead=s=>{const a=splineAt(s+6),b=splineAt(s+30);return wrapPI(Math.atan2(b.tx,b.tz)-Math.atan2(a.tx,a.tz))};
function stepAI(a,dt){
  const sp=splineAt(a.s),wmin=Math.max(1,Math.min(sp.wl,sp.wr)-1.6);
  a.hitT=Math.max(0,(a.hitT||0)-dt);a.mistT=Math.max(0,(a.mistT||0)-dt);a.passT=Math.max(0,(a.passT||0)-dt);
  // erro de pilotagem ocasional (mais frequente no nível fácil): entra largo e perde ritmo
  if(a.nextMist===undefined)a.nextMist=12+Math.random()*30;
  const PE=a.pers||PERS_DEF;
  if(state==='race'&&raceT>a.nextMist){a.mistT=(1.2+Math.random()*.9)*PE.mp;a.mistLane=(Math.random()<.5?-1:1)*(1+Math.random()*1.2)*PE.mp;a.nextMist=raceT+([12,24,50][cfg.level]+Math.random()*30)/PE.mr}
  // ritmo: perfil de velocidade da pista x habilidade, com leve "elástico" em relação ao jogador
  const rb=1+clamp(-(a.P-(player?player.P:a.P))/3500,-.04,.045)*(cfg.level===2?.5:1);
  let vt=vProfAt(a.s+a.v*.3)*a.skill*rb;
  if(a.mistT>0)vt*=1-.18*PE.mp;if(a.hitT>0)vt*=PE.yld>.5?.8:.88;
  // traçado: vai para o lado de dentro conforme a curva se aproxima
  const dth=curvAhead(a.s);
  vt*=1-PE.bf*clamp(Math.abs(curvAhead(a.s+a.v*.8))/.5,0,1);   // medroso freia cedo, rapidinho freia tarde
  a.laneT=clamp(a.lane+clamp(dth*1.7,-2.2,2.2)+(a.mistT>0?a.mistLane:0),-wmin,wmin);
  // tráfego: freia atrás de quem está na frente, escolhe o lado livre para ultrapassar e se afasta de quem está ao lado
  for(const o of allCars()){
    if(o===a||o.boom)continue;
    const ds=o.P-a.P,ol=o.isPlayer?(o.lat||0):(o.laneNow||0),al=a.laneNow,dl=ol-al,ov=o.isPlayer?Math.max(o.speed,0):(o.v||0);
    const look=(14+Math.max(0,a.v-ov)*1.1)*PE.look;
    if(ds>0&&ds<look&&Math.abs(dl)<2.7){
      const c1=clamp(ol-2.9,-wmin,wmin),c2=clamp(ol+2.9,-wmin,wmin),f1=Math.abs(c1-ol),f2=Math.abs(c2-ol);
      if(!a.passSide||a.passT<=0){a.passSide=(f1>=2.2&&(f2<2.2||Math.abs(c1-al)<=Math.abs(c2-al)))?-1:(f2>=2.2?1:0);a.passT=1.2}
      if(a.passSide){a.laneT=a.passSide<0?c1:c2;vt=Math.min(vt,ov+Math.max(7,ds*.8))}   // tem espaço: desvia e ultrapassa
      else vt=Math.min(vt,ov+Math.max(-4,(ds-8)*.55));                                  // sem espaço: segue atrás
    }else if(ds>0&&ds<12&&Math.abs(dl)<1.6)vt+=PE.draft;   // vácuo
    if(PE.aggr>=.5){   // malandro: fecha a porta de quem vem atrás, empurra quem está ao lado e dá freada de fiscal
      if(ds<0&&ds>-12&&Math.abs(dl)<3.6&&a.chkT<=0&&a.chkCd<=0&&ov>14&&Math.random()<dt*.35*PE.aggr){a.chkT=.8;a.chkCd=6}
      if(ds<0&&ds>-14&&Math.abs(dl)<3.6){if(Math.random()<dt*PE.aggr*1.2)a.laneT=clamp(ol,-wmin,wmin)}
      else if(Math.abs(ds)<4.2&&Math.abs(dl)<3.2&&Math.random()<dt*PE.aggr*1.5){a.laneT=clamp(ol,-wmin,wmin);vt+=2}
    }else if(Math.abs(ds)<4.6&&Math.abs(dl)<2.5)a.laneT=clamp(a.laneT+(dl>0?-1.5:1.5),-wmin,wmin);
    if(PE.yld>0&&ds<0&&ds>-12&&Math.abs(dl)<2.4)a.laneT=clamp(a.laneT+(al>=ol?1:-1)*3.2*PE.yld,-wmin,wmin);   // medroso sai da frente de quem vem atrás
    if(PE.risk>0&&ds>0&&ds<18&&Math.abs(dl)<3&&a.lungeCd<=0&&Math.abs(dth)>.12&&Math.random()<dt*PE.risk*1.2){a.lunge=1.7;a.lungeCd=7+Math.random()*9;a.lungeSide=dth>0?1:-1}   // tentativa arriscada por dentro
  }
  a.chkT=Math.max(0,a.chkT-dt);a.chkCd=Math.max(0,(a.chkCd||0)-dt);a.lungeCd-=dt;
  if(a.chkT>0)vt*=.55;   // freada de fiscal
  if(a.lunge>0){a.lunge-=dt;a.laneT=clamp(a.lungeSide*wmin,-wmin,wmin);vt*=1.10;
    if(a.lunge<=0&&Math.abs(curvAhead(a.s))>.1&&Math.random()<.55){a.mistT=1.6*PE.mp;a.mistLane=a.lungeSide*2.4}}   // passou do ponto: sai largo
  if(PE.show>0&&a.lunge<=0&&a.mistT<=0)a.laneT=clamp(a.laneT+Math.sin(raceT*1.1+a.persId*2)*1.3*PE.show,-wmin,wmin);   // exibido: zigue-zague
  if(state==='countdown'||cdT>.2+(a.react||0))vt=0;
  if(a.react===undefined)a.react=Math.random()*.35;
  const v0=a.v;a.v+=clamp(vt-a.v,-15*dt,(7.5*Math.max(.25,1-a.v/95))*dt);
  a.s+=a.v*dt;a.P=a.s-LAP;
  const l0=a.laneNow;a.lv=a.lv||0;
  a.laneNow+=clamp(a.laneT-a.laneNow,-2.4*dt,2.4*dt)+a.lv*dt;a.lv*=Math.exp(-1.8*dt);
  a.laneNow=clamp(a.laneNow,-(sp.wl-1.2),sp.wr-1.2);
  // guinada: acompanha a troca de faixa e o tranco de batidas (decai sozinho)
  a.yawK=(a.yawK||0)*Math.exp(-2.4*dt);
  a.yawOff=clamp(Math.atan2((a.laneNow-l0)/Math.max(dt,1e-4),Math.max(a.v,8))+a.yawK,-.6,.6);
  const th0=a.th;aiPlace(a,dt,false);
  // inclinação da carroceria (rolagem/arfagem) a partir da aceleração
  const yr=wrapPI(a.th-th0)/Math.max(dt,1e-4);a.ay+=(clamp(a.v*yr,-12,12)-a.ay)*Math.min(1,dt*6);a.ax+=((a.v-v0)/Math.max(dt,1e-4)-a.ax)*Math.min(1,dt*6);
  a.vx=Math.sin(a.th)*a.v;a.vz=Math.cos(a.th)*a.v;a.spin+=a.v/CP.wr*dt;a.rpm=lerp(CP.idle,6500,clamp(a.v/80,0,1));
  a.slip=0;
  // fim/ voltas
  if(!a.finished&&a.P>=LAP*cfg.laps){a.finished=true;a.finTime=raceT}
  const lp=Math.floor(a.P/LAP);if(lp>(a.lapN||0)){const lt=raceT-(a.lapStart||0);if(lp>=1&&(a.best===0||lt<a.best))a.best=lt;a.lapStart=raceT;a.lapN=lp}
}
function emitSmoke(c,dt){
  if(c.slip<.25&&c.surf<2)return;
  if(c.surf>=2&&c.speed<8)return;
  if(Math.random()>dt*60*(c.surf>=2?.6:c.slip))return;
  const sn=Math.sin(c.th),cs=Math.cos(c.th),rx=cs,rz=-sn;
  for(const sx of [-1,1]){
    const lx=sx*CP.wx,lz=CP.wrz;
    const col=c.surf>=2?[.55,.45,.3]:[.82,.82,.84];
    emit(c.x+rx*lx+sn*lz,c.y-CP.ride+.15,c.z+rz*lx+cs*lz,c.vx*.3+(Math.random()-.5)*.6,.6+Math.random()*.5,c.vz*.3+(Math.random()-.5)*.6,.8,col,c.surf>=2?1.0:1.4)}
}

/* ================= 8b. Mar, efeitos do particle.txd (fumaça/nuvem/fogo/explosão) e dano ================= */
const FXD=__DATA.fx,SEA=FXD&&FXD.sea;
let seaP=null,seaVao=null,texWater=null,texDepth=null,texFx=null,fxP=null,fxVao=null,fxBuf=null,fxInst=null;
try{seaP=program(`#version 300 es
layout(location=0) in vec2 a_c;uniform mat4 u_vp;uniform vec2 u_e;uniform float u_y;out vec3 v_w;
void main(){vec2 p=u_e+a_c*2150.;v_w=vec3(p.x,u_y,p.y);gl_Position=u_vp*vec4(p.x,u_y,-p.y,1.);}`,
`#version 300 es
precision highp float;in vec3 v_w;out vec4 o;
uniform sampler2D u_dep,u_wat;uniform vec4 u_b;uniform vec3 u_eye;uniform float u_t,u_gain;
float hg(vec2 p){return texture(u_wat,p*.045+vec2(u_t*.018,u_t*.011)).r+.55*texture(u_wat,p*.13+vec2(-u_t*.021,u_t*.016)).r;}
void main(){
 vec2 uv=(v_w.xz-u_b.xy)*u_b.zw;float dp=texture(u_dep,uv).r*255./40.;
 if(dp<.03)discard;
 vec2 p=v_w.xz;float h=hg(p);
 vec3 n=normalize(vec3(-(hg(p+vec2(.7,0.))-h)*.9,1.,-(hg(p+vec2(0.,.7))-h)*.9));
 vec3 V=u_eye-v_w;float dist=length(V);V/=dist;
 float fr=.04+.96*pow(1.-max(dot(n,V),0.),4.);
 vec3 base=mix(vec3(.12,.52,.52),vec3(.02,.17,.24),smoothstep(.2,3.,dp));
 vec3 sky=mix(vec3(.55,.72,.9),${FOG},pow(1.-max(V.y,0.),3.));
 vec3 R=reflect(-V,n);float sp=pow(max(dot(R,normalize(vec3(.35,.8,.45))),0.),220.)*1.6;
 vec3 c=mix(base,sky,fr)*(.42+.3*u_gain)+sp;
 float fo=smoothstep(.75,0.,dp+(h-1.)*.35+sin(u_t*1.3+dp*9.)*.06);
 c=mix(c,vec3(.95,.97,1.),fo*.85);
 c=fogMixS(c,dist,1.55);
 o=vec4(c,max(mix(.4,.95,smoothstep(0.,2.5,dp)),fo));}`)}catch(e){console.warn('mar indisponível',e)}
try{fxP=program(`#version 300 es
layout(location=0) in vec2 a_q;layout(location=1) in vec4 a_pos;layout(location=2) in vec4 a_col;layout(location=3) in vec4 a_t;
uniform mat4 u_vp;uniform vec3 u_r,u_u;out vec2 v_uv;out vec2 v_q;out vec4 v_c;
void main(){float c=cos(a_t.y),s=sin(a_t.y);vec2 q=vec2(a_q.x*c-a_q.y*s,a_q.x*s+a_q.y*c);
 vec3 w=vec3(a_pos.x,a_pos.y,-a_pos.z)+(u_r*q.x+u_u*q.y)*a_pos.w;gl_Position=u_vp*vec4(w,1.);
 vec2 org=vec2(mod(a_t.x,4.),floor(a_t.x/4.));v_uv=(org+vec2(a_q.x*.5+.5,.5-a_q.y*.5))/4.;v_q=a_q;v_c=a_col;}`,
`#version 300 es
precision mediump float;in vec2 v_uv;in vec2 v_q;in vec4 v_c;out vec4 o;uniform sampler2D u_a;
void main(){vec4 t=texture(u_a,v_uv);float e=1.-smoothstep(.8,1.,max(abs(v_q.x),abs(v_q.y)));
 o=vec4(t.rgb*v_c.rgb,t.a*v_c.a*e);}`)}catch(e){console.warn('efeitos indisponíveis',e)}
(function(){
  if(seaP){seaVao=gl.createVertexArray();gl.bindVertexArray(seaVao);gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);gl.bindVertexArray(null)}
  if(fxP){fxVao=gl.createVertexArray();gl.bindVertexArray(fxVao);
    gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    fxInst=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,fxInst);gl.bufferData(gl.ARRAY_BUFFER,900*48,gl.DYNAMIC_DRAW);
    for(let k=0;k<3;k++){gl.enableVertexAttribArray(1+k);gl.vertexAttribPointer(1+k,4,gl.FLOAT,false,48,k*16);gl.vertexAttribDivisor(1+k,1)}
    gl.bindVertexArray(null)}})();
function texPlain(img,repeat,mips){const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);if(mips)gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,mips?gl.LINEAR_MIPMAP_LINEAR:gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  const w=repeat?gl.REPEAT:gl.CLAMP_TO_EDGE;gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,w);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,w);return t}
function drawSea(vp,eyeGL){
  if(!seaP||!texWater||!texDepth||!SEA)return;const u=seaP.u;
  gl.useProgram(seaP.p);gl.bindVertexArray(seaVao);gl.uniformMatrix4fv(u.u_vp,false,vp);gl.uniform2f(u.u_e,eyeGL[0],-eyeGL[2]);gl.uniform1f(u.u_y,SEA.y);
  gl.uniform4f(u.u_b,SEA.x0,SEA.z0,1/(SEA.x1-SEA.x0),1/(SEA.z1-SEA.z0));gl.uniform3f(u.u_eye,eyeGL[0],eyeGL[1],-eyeGL[2]);gl.uniform1f(u.u_t,tNow);gl.uniform1f(u.u_gain,GAIN);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texDepth);gl.uniform1i(u.u_dep,0);
  gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,texWater);gl.uniform1i(u.u_wat,1);
  const cw=gl.isEnabled(gl.CULL_FACE);gl.disable(gl.CULL_FACE);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  gl.depthMask(true);gl.disable(gl.BLEND);if(cw)gl.enable(gl.CULL_FACE);gl.activeTexture(gl.TEXTURE0)}
// ---- partículas de efeito (billboards instanciados; atlas do particle.txd: 0-2 fumaça, 3-5 nuvem, 6-7 fogo, 8-13 explosão, 14 faísca, 15 clarão)
const FXM=900,fxs=[];for(let i=0;i<FXM;i++)fxs.push({l:0});let fxH=0;const fxData=new Float32Array(FXM*12);
function fx(cell,add,x,y,z,vx,vy,vz,s0,s1,life,r,g,b,a,drag,ay,spin){const p=fxs[fxH];fxH=(fxH+1)%FXM;
  p.l=p.m=life;p.cell=cell;p.add=add;p.x=x;p.y=y;p.z=z;p.vx=vx;p.vy=vy;p.vz=vz;p.s0=s0;p.s1=s1;p.r=r;p.g=g;p.b=b;p.a=a;p.d=drag||0;p.ay=ay||0;p.rot=Math.random()*6.283;p.vr=(Math.random()-.5)*(spin===undefined?1.2:spin)}
function fxUpdate(dt){for(const p of fxs){if(p.l<=0)continue;p.l-=dt;if(p.l<=0)continue;const k=Math.exp(-p.d*dt);p.vx*=k;p.vy*=k;p.vz*=k;p.vy+=p.ay*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;p.rot+=p.vr*dt}}
function drawFx(vp,LK,dt){
  fxUpdate(dt);if(!fxP||!texFx)return;
  let n=0,n1=0;
  for(let pass=0;pass<2;pass++){for(const p of fxs){if(p.l<=0||(p.add?1:0)!==pass)continue;
    const t=1-p.l/p.m,sz=p.s0+(p.s1-p.s0)*Math.pow(t,.6),al=p.a*Math.min(1,t/.08)*(p.add?(1-t)*(1-t):(1-t)),o=n*12;
    fxData[o]=p.x;fxData[o+1]=p.y;fxData[o+2]=p.z;fxData[o+3]=sz*.5;fxData[o+4]=p.r;fxData[o+5]=p.g;fxData[o+6]=p.b;fxData[o+7]=al;fxData[o+8]=p.cell;fxData[o+9]=p.rot;fxData[o+10]=0;fxData[o+11]=0;n++}
    if(pass===0)n1=n}
  if(!n)return;const u=fxP.u;
  gl.useProgram(fxP.p);gl.bindVertexArray(fxVao);gl.bindBuffer(gl.ARRAY_BUFFER,fxInst);gl.bufferSubData(gl.ARRAY_BUFFER,0,fxData,0,n*12);
  gl.uniformMatrix4fv(u.u_vp,false,vp);gl.uniform3fv(u.u_r,LK.r);gl.uniform3fv(u.u_u,LK.u);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texFx);gl.uniform1i(u.u_a,0);
  const cw=gl.isEnabled(gl.CULL_FACE);gl.disable(gl.CULL_FACE);gl.enable(gl.BLEND);gl.depthMask(false);
  const draw=(a,b)=>{if(b<=a)return;gl.bindBuffer(gl.ARRAY_BUFFER,fxInst);for(let k=0;k<3;k++)gl.vertexAttribPointer(1+k,4,gl.FLOAT,false,48,a*48+k*16);gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,b-a)};
  gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);draw(0,n1);
  gl.blendFunc(gl.SRC_ALPHA,gl.ONE);draw(n1,n);
  gl.depthMask(true);gl.disable(gl.BLEND);if(cw)gl.enable(gl.CULL_FACE)}
// ---- dano -> fumaça -> fogo -> explosão -> game over
const HURT_MAX=3.0;let goT=0,shakeT=0;
const R_=()=>Math.random();
function boomSound(){if(!AC||muted)return;try{const n=AC.sampleRate*1.8|0,b=AC.createBuffer(1,n,AC.sampleRate),d=b.getChannelData(0);let l=0;
  for(let i=0;i<n;i++){const t=i/n;l+=((Math.random()*2-1)-l)*(.04+.5*(1-t));d[i]=l*Math.pow(1-t,2.2)*2.4}
  const s=AC.createBufferSource();s.buffer=b;const g=AC.createGain();g.gain.value=.9;s.connect(g);g.connect(master);s.start()}catch(e){}}
function fxSparks(x,y,z,nx,nz,k){for(let i=0;i<k;i++){const a=R_()*6.28,sp=3+R_()*9;
  fx(14,true,x,y,z,nx*sp*.6+Math.cos(a)*sp*.5,1+R_()*5,nz*sp*.6+Math.sin(a)*sp*.5,.28,.08,.35+R_()*.3,1,.75,.35,1,.5,-14,0)}}
function seaSplash(x,z){const y=SEA?SEA.y:0;for(let i=0;i<22;i++){const a=R_()*6.28,sp=2+R_()*7;
  fx(R_()<.5?0:1,false,x,y+.3,z,Math.cos(a)*sp,4+R_()*7,Math.sin(a)*sp,1.2,4.5,1.2+R_(),.85,.92,1,.7,.8,-9,.6)}}
function hoodPos(c){const sn=Math.sin(c.th),cs=Math.cos(c.th),l=(R_()-.5)*.9;return[c.x+sn*1.45+cs*l,c.y+.3+R_()*.15,c.z+cs*1.45-sn*l]}
function carFx(c,dt){
  if(c.boom){ // destroços em chamas
    if(goT<40){const k=goT<20?1:.45;
      if(R_()<34*k*dt)fx(R_()<.5?6:7,true,c.x+(R_()-.5)*2.4,c.y+.1,c.z+(R_()-.5)*3.2,(R_()-.5)*.8,1.6+R_()*2,(R_()-.5)*.8,1.4,2.8,.7+R_()*.4,1,.7,.35,.9,.4,1.2,1.5);
      if(R_()<20*k*dt)fx(3+(R_()*3|0),false,c.x+(R_()-.5)*2,c.y+.8,c.z+(R_()-.5)*2.6,(R_()-.5),3+R_()*2,(R_()-.5),2.5,9,3+R_()*2,.14,.13,.12,.8,.35,.5,.5)}
    return}
  if(!c.isPlayer||state!=='race'&&state!=='finish')return;
  const r=c.hurt/HURT_MAX;if(r<.28)return;
  const rate=k=>R_()<k*dt;
  if(r>=.28&&c.warn<1){c.warn=1;flashMsg('Motor soltando fumaça!')}
  if(r>=.6&&c.warn<2){c.warn=2;flashMsg('Motor pegando fogo!',true,2.4);beep(240,.25)}
  if(r>=.85&&c.warn<3){c.warn=3;flashMsg('Cuidado: carro prestes a explodir!',true,3);beep(200,.4)}
  const trail=.55;
  if(rate(r<.6?16:26)){const h=hoodPos(c),dark=r>=.6;fx(R_()*3|0,false,h[0],h[1],h[2],c.vx*trail+(R_()-.5)*.8,1.3+R_()*1.2,c.vz*trail+(R_()-.5)*.8,1,dark?4.5:4,1.5+R_()*1.2,dark?.13:.62,dark?.13:.62,dark?.13:.62,dark?.8:.7,.6,.25)}
  if(r>=.6&&rate(r>=.85?42:12)){const h=hoodPos(c);fx(R_()<.5?6:7,true,h[0],h[1],h[2],c.vx*.3+(R_()-.5)*.6,1.8+R_()*1.6,c.vz*.3+(R_()-.5)*.6,r>=.85?1.2:.7,r>=.85?2.4:1.4,.45+R_()*.3,1,.72,.34,.95,.8,1,1.8)}
  if(r>=.85&&rate(10)){const h=hoodPos(c);fx(14,true,h[0],h[1]+.3,h[2],(R_()-.5)*5,3+R_()*4,(R_()-.5)*5,.25,.08,.7,1,.7,.3,1,.4,-12,0)}
  if(r>=1&&!c.fuse){c.fuse=1.9;flashMsg('O carro vai explodir!',false,2)}
  if(c.fuse>0){c.fuse-=dt;if(Math.floor(c.fuse*6)%2===0&&rate(40))beep(900,.05);if(c.fuse<=0)explode(c)}}
function explode(c){
  c.boom=true;c.fuse=0;state='gameover';goT=0;shakeT=1;$('msg').textContent='';msgTimer=0;c.vx=c.vz=c.w=0;c.v=0;
  const x=c.x,y=c.y+.5,z=c.z;
  for(let i=0;i<7;i++)fx(8+i%6,true,x+(R_()-.5)*2.2,y+R_()*1.2,z+(R_()-.5)*2.6,(R_()-.5)*5,R_()*3,(R_()-.5)*5,3,12+R_()*6,.8+R_()*.8,1,.85,.6,1,1.4,-.5,1.4);
  fx(7,true,x,y+1,z,0,3,0,4,17,1.2,1,.8,.5,1,1.2,0,.5);fx(15,true,x,y+1,z,0,0,0,18,70,.38,1,.92,.75,1,0,0,0);
  for(let i=0;i<44;i++){const a=R_()*6.28,sp=10+R_()*22;fx(14,true,x,y,z,Math.cos(a)*sp,6+R_()*16,Math.sin(a)*sp,.5,.12,.9+R_()*.7,1,.75,.35,1,.5,-24,0)}
  for(let i=0;i<18;i++)fx(3+i%3,false,x+(R_()-.5)*2,y+R_(),z+(R_()-.5)*2,(R_()-.5)*4,4+R_()*5,(R_()-.5)*4,4,16+R_()*8,4+R_()*3,.16,.15,.14,.92,.5,.6,.5);
  for(let i=0;i<14;i++){const a=R_()*6.28,sp=9+R_()*7;fx(0,false,x,c.y-.2,z,Math.cos(a)*sp,.6,Math.sin(a)*sp,3,9,1.5,.55,.5,.45,.5,1.4,0,.6)}
  boomSound();const fl=$('boomflash');if(fl){fl.classList.remove('on');void fl.offsetWidth;fl.classList.add('on')}}
function showGameOver(){$('hud').hidden=true;$('touch').classList.remove('on');setScreen('gameover')}
$('retryBtn').onclick=()=>{startRace()};$('goMenuBtn').onclick=()=>toMenu();
function updateParticles(dt){
  let n=0;
  for(const p of parts){
    if(p.life<=0)continue;p.life-=dt;if(p.life<=0)continue;
    p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;p.vx*=.98;p.vz*=.98;p.vy*=.98;
    const t=1-p.life/p.max;const o=n*10;
    pdata[o]=p.x;pdata[o+1]=p.y;pdata[o+2]=p.z;pdata[o+3]=p.size*(1+t*3.5);
    pdata[o+4]=p.r;pdata[o+5]=p.g;pdata[o+6]=p.b;pdata[o+7]=.55*(1-t);pdata[o+8]=Math.min(29,Math.floor(t*30));pdata[o+9]=p.sd||0;n++}
  return n}

/* ================= 9. Câmera e desenho ================= */
let W=0,H=0,texTrk=[],texSky=null,spinBlur=0;
function resize(){const d=Math.max(.5,Math.min(window.devicePixelRatio||1,COARSE?1.5:1.75)*Math.max(Q.rs,COARSE?.75:.5)),w=Math.round(canvas.clientWidth*d),h=Math.round(canvas.clientHeight*d);if(w!==W||h!==H){W=canvas.width=w;H=canvas.height=h}}
function carMatrix(c){
  const sn=Math.sin(c.th),cs=Math.cos(c.th);
  let f=[sn*Math.cos(c.pitch),Math.sin(c.pitch),cs*Math.cos(c.pitch)];
  let r=[cs*Math.cos(c.roll),Math.sin(c.roll),-sn*Math.cos(c.roll)];
  let u=[f[1]*r[2]-f[2]*r[1],f[2]*r[0]-f[0]*r[2],f[0]*r[1]-f[1]*r[0]];let l=Math.hypot(...u);u=u.map(v=>v/l);
  r=[u[1]*f[2]-u[2]*f[1],u[2]*f[0]-u[0]*f[2],u[0]*f[1]-u[1]*f[0]];l=Math.hypot(...r);r=r.map(v=>v/l);
  return {m:M4.basis(r,u,f,[c.x,c.y,c.z]),r,u,f}}
function drawCar(c,CM,vp){
  const tex=MD.tex[c.skin];
  uploadDents(c);
  const inside=c===player&&camMode===1&&state!=='menu'; // 1ª pessoa: esconde cabine/traseira do próprio carro (o modelo não tem interior), fica só o capô
  for(const p of MD.opaque){
    if(inside&&!/Chassis/.test(p.name))continue; // 1ª pessoa: só o capô (sem rodas, para-choque, grade, faróis)
    gl.uniform1f(carP.u.u_cut,inside?.72:-1e9);gl.uniform1f(carP.u.u_cuty,inside?-.08:-1e9);
    gl.uniform1f(carP.u.u_dmgOn,p.wheel?0:1);
    let part=null;
    if(p.wheel){part=M4.trans(p.pos[0],p.pos[1],p.pos[2]);if(p.front)part=M4.mul(part,M4.rotY(c.steer));part=M4.mul(part,M4.rotX(c.spin))}
    const model=M4.flipZ(part?M4.mul(CM.m,part):CM.m.slice());
    gl.uniformMatrix4fv(carP.u.u_model,false,model);
    gl.uniform1f(carP.u.u_refl,p.refl);gl.uniform1f(carP.u.u_spec,p.spec);
    if(!SHADOW_PASS){const hd=/Headlight/i.test(p.name),rl=/RearLight/i.test(p.name);
      if(hd)gl.uniform3f(carP.u.u_emis,NIGHT*1.5,NIGHT*1.35,NIGHT*1.05);
      else if(rl){const b=Math.max(c.brk||0,0)>.05?1:0,e=.12+.35*NIGHT+1.5*b;gl.uniform3f(carP.u.u_emis,e,e*.07,e*.04)}
      else gl.uniform3f(carP.u.u_emis,0,0,0)}
    gl.bindTexture(gl.TEXTURE_2D,p.tex==='body'?tex:MD.tex[p.tex]);
    gl.drawElements(gl.TRIANGLES,p.count,gl.UNSIGNED_SHORT,p.start*2)}
  gl.uniform3f(carP.u.u_emis,0,0,0);
  gl.uniform1f(carP.u.u_cut,-1e9);gl.uniform1f(carP.u.u_cuty,-1e9);
}
function drawBlur(c,CM){
  if(c===player&&camMode===1&&state!=='menu')return;
  gl.uniform1f(carP.u.u_dmgOn,0);
  for(const p of MD.blur){
    let part=M4.trans(p.pos[0],p.pos[1],p.pos[2]);if(p.front)part=M4.mul(part,M4.rotY(c.steer));part=M4.mul(part,M4.rotX(c.spin));
    gl.uniformMatrix4fv(carP.u.u_model,false,M4.flipZ(M4.mul(CM.m,part)));
    gl.uniform1f(carP.u.u_refl,.3);gl.uniform1f(carP.u.u_spec,0);gl.bindTexture(gl.TEXTURE_2D,MD.tex.blur);
    gl.drawElements(gl.TRIANGLES,p.count,gl.UNSIGNED_SHORT,p.start*2)}
}
function drawGlass(c,CM){
  if(!MD.glass.length||(c===player&&camMode===1&&state!=='menu'))return;
  uploadDents(c);gl.uniform1f(carP.u.u_dmgOn,1);
  gl.uniformMatrix4fv(carP.u.u_model,false,M4.flipZ(CM.m.slice()));
  for(const p of MD.glass){
    gl.uniform1f(carP.u.u_refl,p.refl);gl.uniform1f(carP.u.u_spec,p.spec);gl.bindTexture(gl.TEXTURE_2D,MD.tex[p.tex]);
    gl.drawElements(gl.TRIANGLES,p.count,gl.UNSIGNED_SHORT,p.start*2)}
}
const camState={pos:[0,0,0],ang:0};
const spec={s:null,side:1,pos:[0,0,0],tgt:[0,0,0]};
const CAM_NAMES=['Segunda pessoa (atrás do carro)','Primeira pessoa (cockpit)','Espectador'],CAM_SHORT=['2ª pessoa','1ª pessoa','Espectador'];
const WCAM_NAMES=['Atrás do pedestre','Primeira pessoa (você a pé)','Acompanhar o carro'],WCAM_SHORT=['Pedestre','1ª pessoa','Acompanhar'];
const FCAM_NAMES=['Câmera livre','Primeira pessoa (carro)','Espectador'],FCAM_SHORT=['Livre','1ª pessoa','Espectador'];
const camShort=()=>freeMode?FCAM_SHORT:(walkMode||onFoot)?WCAM_SHORT:CAM_SHORT;
function cycleCam(){camMode=(camMode+1)%3;spec.s=null;flashMsg('Câmera: '+(freeMode?FCAM_NAMES:(walkMode||onFoot)?WCAM_NAMES:CAM_NAMES)[camMode]);const n=document.getElementById('camName');if(n)n.textContent=camShort()[camMode]}
/* ---- Efeitos de câmera: vibração por velocidade, tranco em batidas, abertura de FOV suave. Não mexe na câmera de teste/menu/troféu/a pé. ---- */
let lastCam=null;const CFX={imp:0,fov:0,t:0,hit:0};
function camFX(c,dt){
  if(window.__camFix||!player||state==='menu'||state==='done'||state==='board'||footOn()||camMode===2||paused||!OPT.shake||freeMode)return c;
  const P=player,sp=Math.abs(P.speed||0);CFX.t+=dt;
  const h=P.hit||0;if(h>3&&h!==CFX.hit)CFX.imp=Math.min(.16,Math.max(CFX.imp,h/220));CFX.hit=h;CFX.imp*=Math.exp(-dt*5);
  const a=(clamp((sp-30)/55,0,1)*.006+CFX.imp)*(camMode===1?.7:1),t=CFX.t;
  const nx=Math.sin(t*37.1)+.6*Math.sin(t*61.7+1.3),ny=Math.sin(t*43.3+.7)+.6*Math.sin(t*71.9),nz=Math.sin(t*29.7+2.1);
  const eye=[c.eye[0]+nx*a,c.eye[1]+ny*a*.8,c.eye[2]+nz*a],tgt=[c.tgt[0]+ny*a*.5,c.tgt[1]+nx*a*.5,c.tgt[2]];
  const want=clamp((P.nos?1:0),0,1)*.06+clamp(CFX.imp*.4,0,.05);CFX.fov+=(want-CFX.fov)*Math.min(1,dt*3);
  return {eye,tgt,fov:c.fov+CFX.fov}}

/* ---- Câmera livre (modo "Câmera livre"): voo com WASD/QE, olhar com setas/arrastar/analógico direito; todos os carros correm sozinhos ---- */
const FREE={x:0,y:0,z:0,yaw:0,pitch:-.2,spd:16,drag:false};
function freeInit(){const c=player;FREE.yaw=c.th;FREE.pitch=-.22;FREE.x=c.x-Math.sin(c.th)*13;FREE.z=c.z-Math.cos(c.th)*13;FREE.y=c.y+5.5;FREE.spd=16}
(function(){const cv=document.getElementById('gl');if(!cv)return;
  cv.addEventListener('pointerdown',e=>{if(freeMode){FREE.drag=true;try{cv.setPointerCapture(e.pointerId)}catch(_){}}});
  const up=()=>{FREE.drag=false};cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);
  cv.addEventListener('pointermove',e=>{if(freeMode&&FREE.drag){FREE.yaw+=e.movementX*.004;FREE.pitch=clamp(FREE.pitch-e.movementY*.004,-1.45,1.45)}});
  cv.addEventListener('wheel',e=>{if(freeMode){FREE.spd=clamp(FREE.spd*(e.deltaY<0?1.2:1/1.2),3,120);e.preventDefault()}},{passive:false})})();
function freeCam(dt){
  dt=Math.min(dt,.1);const F=FREE,k=keys;
  let mx=(k.KeyD?1:0)-(k.KeyA?1:0),mz=(k.KeyW?1:0)-(k.KeyS?1:0),my=(k.KeyE?1:0)-(k.KeyQ?1:0);
  let lx=(k.ArrowRight?1:0)-(k.ArrowLeft?1:0),ly=(k.ArrowUp?1:0)-(k.ArrowDown?1:0);
  const gp=(navigator.getGamepads&&navigator.getGamepads()[0]);
  if(gp&&gp.axes.length>=4){const dz=v=>Math.abs(v)<.15?0:v;mx+=dz(gp.axes[0]);mz-=dz(gp.axes[1]);lx+=dz(gp.axes[2])*1.4;ly-=dz(gp.axes[3])*1.4;
    if(gp.buttons[6]&&gp.buttons[6].pressed)my-=gp.buttons[6].value;if(gp.buttons[7]&&gp.buttons[7].pressed)my+=gp.buttons[7].value}
  if(!paused){F.yaw+=lx*1.6*dt;F.pitch=clamp(F.pitch+ly*1.2*dt,-1.45,1.45);
    const sp=F.spd*((k.ShiftLeft||k.ShiftRight)?4:1)*dt,cp=Math.cos(F.pitch),sy=Math.sin(F.yaw),cy=Math.cos(F.yaw);
    F.x+=(sy*cp*mz+cy*mx)*sp;F.y+=(Math.sin(F.pitch)*mz+my)*sp;F.z+=(cy*cp*mz-sy*mx)*sp;
    if(groundAt(F.x,F.z,F.y+2))F.y=Math.max(F.y,gH+.4)}
  const cp=Math.cos(F.pitch);
  return {eye:[F.x,F.y,F.z],tgt:[F.x+Math.sin(F.yaw)*cp*10,F.y+Math.sin(F.pitch)*10,F.z+Math.cos(F.yaw)*cp*10],fov:.95}}

function updateCamera(dt){
  if(window.__camFix)return window.__camFix;   // gancho de teste (câmera livre)
  const c=player;let eye,tgt,fov;
  if(freeMode&&state!=='menu'&&camMode===0)return freeCam(dt);
  if(state==='done'&&trophy)return trophyCam(dt);
  if(state==='menu'){
    menuT+=dt;const a=menuT*.35+.6;const d=6.2;
    tgt=[c.x,c.y+.1,c.z];eye=[c.x+Math.sin(a)*d,c.y+1.6,c.z+Math.cos(a)*d];fov=.62;
    camInit=false;return {eye,tgt,fov}}
  if(footOn()&&camMode!==2){const W=WLK;
    if(!camInit){camState.ang=W.yaw;camInit=true}
    camState.ang+=wrapPI(W.yaw-camState.ang)*Math.min(1,dt*4);
    const fx=Math.sin(camState.ang),fz=Math.cos(camState.ang);
    if(camMode===0){eye=[W.x-fx*3.4,W.y+2.1,W.z-fz*3.4];tgt=[W.x+fx*2.5,W.y+1.3,W.z+fz*2.5];fov=.95;
      if(groundAt(eye[0],eye[2],eye[1]+.5))eye[1]=Math.max(eye[1],gH+.6)}
    else{const sx=Math.sin(W.yaw),sz=Math.cos(W.yaw);eye=[W.x+sx*.14,W.y+1.64,W.z+sz*.14];tgt=[eye[0]+sx*12,eye[1]-.35,eye[2]+sz*12];fov=1.08}
    return {eye,tgt,fov}}
  const sp=c.speed,sn=Math.sin(c.th),cs=Math.cos(c.th);
  let tAng=sp>6?Math.atan2(c.vx,c.vz)*.55+c.th*.45:c.th;
  if(c.vf<-2)tAng=c.th;
  if(!camInit){camState.ang=c.th;camInit=true}
  camState.ang+=wrapPI(tAng-camState.ang)*Math.min(1,dt*(camMode===0?4.5:9));
  const fa=camState.ang,fx=Math.sin(fa),fz=Math.cos(fa);
  if(camMode===0){
    const dist=6.3+sp*.025,hgt=1.75+sp*.004;
    eye=[c.x-fx*dist,c.y+hgt-CP.ride+.9,c.z-fz*dist];tgt=[c.x+fx*5,c.y+.5,c.z+fz*5];fov=.88+Math.min(sp/90,1)*.2;
    // não fica abaixo do chão
    if(groundAt(eye[0],eye[2],eye[1]+.5))eye[1]=Math.max(eye[1],gH+.7);
  }else if(camMode===1){
    // Primeira pessoa: olho do motorista (lado direito, carro australiano), preso à carroceria — gira junto com o carro
    const csn=Math.sin(c.th),ccs=Math.cos(c.th),rx=ccs,rz=-csn;
    const yaw=c.th+clamp(c.steer||0,-.6,.6)*.12;
    const dx=Math.sin(yaw),dz=Math.cos(yaw);
    eye=[c.x+csn*.7+rx*.2,c.y+.66,c.z+ccs*.7+rz*.2];
    tgt=[eye[0]+dx*20,eye[1]-1.9+c.pitch*5,eye[2]+dz*20];fov=.95+Math.min(sp/90,1)*.15;
  }else{
    // Espectador: câmera fixa ao lado da pista, à frente do carro; acompanha com zoom e salta para o próximo ponto depois que ele passa
    const ts=trackS(c.x,c.z,c.idx);
    let ds=spec.s==null?-1e9:((spec.s-ts.s+LAP*1.5)%LAP)-LAP/2;
    if(spec.s==null||ds<-16||ds>170){
      spec.side=-spec.side||1;spec.s=ts.s+Math.max(48,Math.min(90,40+c.speed*1.1));
      const sp=splineAt(spec.s),rx=sp.tz,rz=-sp.tx,off=(spec.side>0?sp.wr:sp.wl)+7+Math.abs(Math.sin(spec.s*.37))*5;
      spec.pos=[sp.x+rx*spec.side*off,sp.y+1.8+Math.abs(Math.cos(spec.s*.21))*2.2,sp.z+rz*spec.side*off];
      spec.tgt=[c.x,c.y+.6,c.z];spec.pos[1]=Math.max(spec.pos[1],sp.y+1.4)}
    const k=Math.min(1,dt*8);spec.tgt[0]+=(c.x-spec.tgt[0])*k;spec.tgt[1]+=(c.y+.6-spec.tgt[1])*k;spec.tgt[2]+=(c.z-spec.tgt[2])*k;
    eye=spec.pos.slice();tgt=spec.tgt.slice();
    const d=Math.hypot(c.x-eye[0],c.z-eye[2]);fov=clamp(2*Math.atan(3.4/Math.max(d,6)),.28,.95)}
  return {eye,tgt,fov}}

/* ================= 9b. Pós-processamento (níveis Alto e Ultra) =================
   A cena é desenhada num framebuffer HDR (RGBA16F quando a GPU deixa) com MSAA 4x, resolvido para textura; depois:
   - SSAO (só Ultra): oclusão ambiente por profundidade, com correção de inclinação (sem escurecer planos) e desfoque que respeita bordas
   - Bloom controlado: só o que passa de ~0,8 (brilho do sol, faróis, fogo do nitro, reflexos fortes) borra e soma
   - Tone mapping de ombro suave (preserva os tons médios; comprime só os realces), vinheta leve e grão anti-banding
   Níveis Médio e Baixo seguem o caminho antigo (direto na tela), sem custo extra. */
const POST={fx:0,w:0,h:0,S:0,hdr:false};
const EXT_CBF=gl.getExtension('EXT_color_buffer_float')||gl.getExtension('EXT_color_buffer_half_float');
POST.hdr=!!EXT_CBF;gl.getExtension('OES_texture_float_linear');
const fxLevel=()=>COARSE?0:Q.tier===0?3:Q.tier===1?2:0;
const QV=`#version 300 es
out vec2 v_t;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);v_t=p;gl_Position=vec4(p*2.-1.,0.,1.);}`;
const postBright=program(QV,`#version 300 es
precision highp float;in vec2 v_t;out vec4 o;uniform sampler2D u_s;uniform vec2 u_px;
void main(){vec3 c=(texture(u_s,v_t+u_px*vec2(-1.,-1.)).rgb+texture(u_s,v_t+u_px*vec2(1.,-1.)).rgb+texture(u_s,v_t+u_px*vec2(-1.,1.)).rgb+texture(u_s,v_t+u_px*vec2(1.,1.)).rgb)*.25;
 float L=max(c.r,max(c.g,c.b));float k=clamp((L-.78)/.5,0.,1.);k=k*k*(3.-2.*k);o=vec4(c*k,1.);}`);
const postBlur=program(QV,`#version 300 es
precision highp float;in vec2 v_t;out vec4 o;uniform sampler2D u_s;uniform vec2 u_d;
void main(){vec3 c=texture(u_s,v_t).rgb*.2270;
 c+=(texture(u_s,v_t+u_d*1.3846).rgb+texture(u_s,v_t-u_d*1.3846).rgb)*.3162;
 c+=(texture(u_s,v_t+u_d*3.2308).rgb+texture(u_s,v_t-u_d*3.2308).rgb)*.0703;o=vec4(c,1.);}`);
const postAO=program(QV,`#version 300 es
precision highp float;in vec2 v_t;out vec4 o;uniform sampler2D u_z;uniform vec2 u_px;uniform float u_proj;
float lz(float d){return .3*2200./(2200.-d*(2200.-.3));}
float ign(vec2 p){return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715))));}
void main(){float d=texture(u_z,v_t).r;if(d>=.99999){o=vec4(1.);return;}
 float z=lz(d);
 float zx1=lz(texture(u_z,v_t+vec2(u_px.x,0.)).r),zx0=lz(texture(u_z,v_t-vec2(u_px.x,0.)).r);
 float zy1=lz(texture(u_z,v_t+vec2(0.,u_px.y)).r),zy0=lz(texture(u_z,v_t-vec2(0.,u_px.y)).r);
 float gx=abs(zx1-z)<abs(z-zx0)?zx1-z:z-zx0,gy=abs(zy1-z)<abs(z-zy0)?zy1-z:z-zy0;   // gradiente do plano local
 float R=1.35,rpx=clamp(R*u_proj/z,3.,46.);
 float a0=ign(gl_FragCoord.xy)*6.2831853,occ=0.;
 for(int i=0;i<12;i++){float f=(float(i)+.5)/12.,a=a0+float(i)*2.39996,r=rpx*(.25+.75*f);vec2 off=vec2(cos(a),sin(a))*r;
  float zs=lz(texture(u_z,v_t+off*u_px).r);
  float ze=z+gx*off.x+gy*off.y;                 // profundidade esperada se o terreno fosse plano
  float dz=ze-zs;                               // >0: tem algo na frente
  occ+=smoothstep(.06+.012*z,.3+.02*z,dz)*smoothstep(R*2.2,R*.6,dz);}
 o=vec4(1.-clamp(occ/12.*1.55,0.,.85),0.,0.,1.);}`);
const postAOBlur=program(QV,`#version 300 es
precision highp float;in vec2 v_t;out vec4 o;uniform sampler2D u_a,u_z;uniform vec2 u_d;
float lz(float d){return .3*2200./(2200.-d*(2200.-.3));}
void main(){float z0=lz(texture(u_z,v_t).r),s=0.,w=0.;
 for(int i=-4;i<=4;i++){vec2 q=v_t+u_d*float(i);float zi=lz(texture(u_z,q).r);float k=exp(-abs(zi-z0)/(.04*z0+.15))*(1.-abs(float(i))/5.);s+=texture(u_a,q).r*k;w+=k;}
 o=vec4(s/w,0.,0.,1.);}`);
const postComp=program(QV,`#version 300 es
precision highp float;in vec2 v_t;out vec4 o;uniform sampler2D u_s,u_b,u_a;uniform float u_bl,u_ao,u_t;
void main(){vec3 c=texture(u_s,v_t).rgb;
 if(u_ao>0.)c*=mix(1.,texture(u_a,v_t).r,u_ao);
 c+=texture(u_b,v_t).rgb*u_bl;
 float L=dot(c,vec3(.2126,.7152,.0722));                       // ombro suave nos realces (só acima de 0,8)
 float Lt=L<.8?L:.8+.2*(1.-exp(-(L-.8)/.2));
 c*=Lt/max(L,1e-4);c=min(c,vec3(1.04));
 float g=dot(c,vec3(.3333));c=mix(vec3(g),c,1.05);              // saturação levemente maior
 vec2 q=v_t-.5;c*=1.-.24*smoothstep(.28,.78,dot(q,q)*2.);     // vinheta leve
 c+=(fract(sin(dot(gl_FragCoord.xy+u_t,vec2(12.9898,78.233)))*43758.5453)-.5)/255.;
 o=vec4(c,1.);}`);
function postTex(w,h,fmt,filter){const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
  if(fmt==='d')gl.texStorage2D(gl.TEXTURE_2D,1,gl.DEPTH_COMPONENT24,w,h);
  else if(fmt==='r')gl.texStorage2D(gl.TEXTURE_2D,1,gl.R8,w,h);
  else gl.texStorage2D(gl.TEXTURE_2D,1,POST.hdr?gl.RGBA16F:gl.RGBA8,w,h);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,filter);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return t}
function postFbo(col,dep){const f=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,col,0);if(dep)gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,dep,0);return f}
function postFree(){const P=POST;for(const k of ['fS','fR','fB1','fB2','fA1','fA2'])if(P[k]){gl.deleteFramebuffer(P[k]);P[k]=null}
  for(const k of ['rC','rD','tC','tD','tB1','tB2','tA1','tA2'])if(P[k]){(k[0]==='r'?gl.deleteRenderbuffer:gl.deleteTexture).call(gl,P[k]);P[k]=null}}
function postAlloc(w,h){
  postFree();const P=POST;P.w=w;P.h=h;
  P.tC=postTex(w,h,'c',gl.LINEAR);P.tD=postTex(w,h,'d',gl.NEAREST);P.fR=postFbo(P.tC,P.tD);
  P.S=Math.min(4,gl.getParameter(gl.MAX_SAMPLES)|0);
  if(P.S>0){P.rC=gl.createRenderbuffer();gl.bindRenderbuffer(gl.RENDERBUFFER,P.rC);gl.renderbufferStorageMultisample(gl.RENDERBUFFER,P.S,P.hdr?gl.RGBA16F:gl.RGBA8,w,h);
    P.rD=gl.createRenderbuffer();gl.bindRenderbuffer(gl.RENDERBUFFER,P.rD);gl.renderbufferStorageMultisample(gl.RENDERBUFFER,P.S,gl.DEPTH_COMPONENT24,w,h);
    P.fS=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,P.fS);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.RENDERBUFFER,P.rC);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,P.rD);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE){P.S=0;gl.deleteFramebuffer(P.fS);P.fS=null}}
  const bw=Math.max(2,w>>2),bh=Math.max(2,h>>2),aw=Math.max(2,w>>1),ah=Math.max(2,h>>1);P.bw=bw;P.bh=bh;P.aw=aw;P.ah=ah;
  P.tB1=postTex(bw,bh,'c',gl.LINEAR);P.tB2=postTex(bw,bh,'c',gl.LINEAR);P.fB1=postFbo(P.tB1);P.fB2=postFbo(P.tB2);
  P.tA1=postTex(aw,ah,'r',gl.LINEAR);P.tA2=postTex(aw,ah,'r',gl.LINEAR);P.fA1=postFbo(P.tA1);P.fA2=postFbo(P.tA2);
  gl.bindFramebuffer(gl.FRAMEBUFFER,null)}
const POST_VAO=gl.createVertexArray();
function postBegin(){
  const fx=fxLevel();POST.fx=fx;
  if(!fx){if(POST.fR)postFree(),POST.w=0;return false}
  if(POST.w!==W||POST.h!==H||!POST.fR)postAlloc(W,H);
  gl.bindFramebuffer(gl.FRAMEBUFFER,POST.S>0?POST.fS:POST.fR);gl.viewport(0,0,W,H);return true}
function postPass(prog,tex,fbo,w,h,setU){gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.viewport(0,0,w,h);gl.useProgram(prog.p);
  tex.forEach((t,i)=>{gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,t)});if(setU)setU(prog.u);gl.drawArrays(gl.TRIANGLES,0,3)}
function postEnd(){
  const P=POST,fx=P.fx;if(!fx)return;
  gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.depthMask(false);gl.bindVertexArray(POST_VAO);
  if(P.S>0){gl.bindFramebuffer(gl.READ_FRAMEBUFFER,P.fS);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,P.fR);
    gl.blitFramebuffer(0,0,W,H,0,0,W,H,gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT,gl.NEAREST)}
  const B=(p,i,v)=>gl.uniform1i(p[v||'u_s'],i);
  // bloom (1/4 da resolução): realces → desfoque H/V duas vezes
  postPass(postBright,[P.tC],P.fB1,P.bw,P.bh,u=>{gl.uniform1i(u.u_s,0);gl.uniform2f(u.u_px,1/W,1/H)});
  for(let i=0;i<2;i++){
    postPass(postBlur,[P.tB1],P.fB2,P.bw,P.bh,u=>{gl.uniform1i(u.u_s,0);gl.uniform2f(u.u_d,(1.4+i)/P.bw,0)});
    postPass(postBlur,[P.tB2],P.fB1,P.bw,P.bh,u=>{gl.uniform1i(u.u_s,0);gl.uniform2f(u.u_d,0,(1.4+i)/P.bh)})}
  if(fx>=3){
    const proj=P.ah*.5/Math.tan((curFov||.9)/2);
    postPass(postAO,[P.tD],P.fA1,P.aw,P.ah,u=>{gl.uniform1i(u.u_z,0);gl.uniform2f(u.u_px,1/P.aw,1/P.ah);gl.uniform1f(u.u_proj,proj)});
    postPass(postAOBlur,[P.tA1,P.tD],P.fA2,P.aw,P.ah,u=>{gl.uniform1i(u.u_a,0);gl.uniform1i(u.u_z,1);gl.uniform2f(u.u_d,1/P.aw,0)});
    postPass(postAOBlur,[P.tA2,P.tD],P.fA1,P.aw,P.ah,u=>{gl.uniform1i(u.u_a,0);gl.uniform1i(u.u_z,1);gl.uniform2f(u.u_d,0,1/P.ah)})}
  postPass(postComp,[P.tC,P.tB1,P.tA1],null,W,H,u=>{gl.uniform1i(u.u_s,0);gl.uniform1i(u.u_b,1);gl.uniform1i(u.u_a,2);gl.uniform1f(u.u_bl,.42);gl.uniform1f(u.u_ao,fx>=3?.9:0);gl.uniform1f(u.u_t,(tNow*61)%97)});
  gl.activeTexture(gl.TEXTURE0);gl.bindVertexArray(null);gl.enable(gl.DEPTH_TEST);gl.depthMask(true)}
let curFov=.9;

/* ================= 9c. Sombra dos carros (mapa de profundidade do sol, PCF) + faróis =================
   Mapa 2048² ortográfico (±20 m) centrado no carro do jogador, preso à grade de texels (sem tremer). Recebe: pista e os próprios carros (auto-sombra).
   Só nos níveis Ultra/Alto. Faróis: cone de luz no asfalto (até 4 carros) + brilho dos faróis/lanternas; luz de freio acende ao frear. */
let SHADOW_PASS=false,NIGHT=0;
const OPT={shadow:1,shake:1};try{for(const k in OPT){const v=localStorage.getItem('xbadl:o:'+k);if(v!==null)OPT[k]=+v}}catch(e){}
const SH={n:2048,on:false,M:new Float32Array(16),h:20};
SH.tex=gl.createTexture();gl.activeTexture(gl.TEXTURE6);gl.bindTexture(gl.TEXTURE_2D,SH.tex);gl.texStorage2D(gl.TEXTURE_2D,1,gl.DEPTH_COMPONENT24,SH.n,SH.n);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_COMPARE_MODE,gl.COMPARE_REF_TO_TEXTURE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_COMPARE_FUNC,gl.LEQUAL);
SH.fbo=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,SH.fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,SH.tex,0);gl.drawBuffers([gl.NONE]);gl.readBuffer(gl.NONE);
gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.activeTexture(gl.TEXTURE0);
const SUN_GL=(()=>{const v=[.45,.78,-.42],l=Math.hypot(...v);return v.map(x=>x/l)})();
function shadowPass(cars,cam){
  SH.on=OPT.shadow&&!COARSE&&Q.tier<=1&&!!player&&state!=='menu0';
  const g=GAIN/GAIN0;NIGHT=clamp((.8-g)/.4,0,1);
  if(!SH.on)return;
  const C=[player.x,player.y,-player.z],S=SUN_GL;
  const L=M4.look([C[0]+S[0]*70,C[1]+S[1]*70,C[2]+S[2]*70],C,[0,1,0]);
  const tx=2*SH.h/SH.n,lx=L.r[0]*C[0]+L.r[1]*C[1]+L.r[2]*C[2],ly=L.u[0]*C[0]+L.u[1]*C[1]+L.u[2]*C[2];
  const dx=Math.round(lx/tx)*tx-lx,dy=Math.round(ly/tx)*tx-ly;
  const E=[C[0]+S[0]*70+L.r[0]*dx+L.u[0]*dy,C[1]+S[1]*70+L.r[1]*dx+L.u[1]*dy,C[2]+S[2]*70+L.r[2]*dx+L.u[2]*dy];
  const T=[C[0]+L.r[0]*dx+L.u[0]*dy,C[1]+L.r[1]*dx+L.u[1]*dy,C[2]+L.r[2]*dx+L.u[2]*dy];
  const LL=M4.look(E,T,[0,1,0]),h=SH.h,n=1,f=150;
  const O=new Float32Array([1/h,0,0,0, 0,1/h,0,0, 0,0,-2/(f-n),0, 0,0,-(f+n)/(f-n),1]);
  SH.M=M4.mul(O,LL.m);
  gl.bindFramebuffer(gl.FRAMEBUFFER,SH.fbo);gl.viewport(0,0,SH.n,SH.n);gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.colorMask(false,false,false,false);gl.enable(gl.DEPTH_TEST);gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);gl.frontFace(gl.CCW);
  gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(2,4);
  gl.useProgram(carP.p);gl.bindVertexArray(MD.vao);gl.uniformMatrix4fv(carP.u.u_vp,false,SH.M);gl.uniform1f(carP.u.u_shOn,0);gl.uniform1f(carP.u.u_alpha,1);gl.uniform3f(carP.u.u_cam,E[0],E[1],E[2]);gl.uniform3f(carP.u.u_sun,S[0],S[1],S[2]);
  gl.uniform1i(carP.u.u_tex,0);gl.uniform1i(carP.u.u_sky,1);gl.uniform1i(carP.u.u_sm,6);
  gl.activeTexture(gl.TEXTURE6);gl.bindTexture(gl.TEXTURE_2D,null);gl.activeTexture(gl.TEXTURE0);   // evita laço de realimentação
  SHADOW_PASS=true;
  for(const c of cars){const dx2=c.x-player.x,dz2=c.z-player.z;if(dx2*dx2+dz2*dz2>26*26)continue;drawCar(c,carMatrix(c),SH.M)}
  SHADOW_PASS=false;
  gl.activeTexture(gl.TEXTURE6);gl.bindTexture(gl.TEXTURE_2D,SH.tex);gl.activeTexture(gl.TEXTURE0);
  gl.disable(gl.POLYGON_OFFSET_FILL);gl.colorMask(true,true,true,true);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);
}
const SP_P=new Float32Array(16),SP_D=new Float32Array(16);
function lightsSet(cars,cam){
  SP_P.fill(0);SP_D.fill(0);
  if(NIGHT>.02){
    const L=cars.slice().sort((a,b)=>((a.x-cam.eye[0])**2+(a.z-cam.eye[2])**2)-((b.x-cam.eye[0])**2+(b.z-cam.eye[2])**2)).slice(0,4);
    L.forEach((c,i)=>{const sn=Math.sin(c.th),cs=Math.cos(c.th);
      SP_P[i*4]=c.x+sn*2.2;SP_P[i*4+1]=c.y+.7;SP_P[i*4+2]=-(c.z+cs*2.2);SP_P[i*4+3]=NIGHT;
      const dn=-.09,l=Math.hypot(1,dn);SP_D[i*4]=sn/l;SP_D[i*4+1]=dn/l;SP_D[i*4+2]=-cs/l})}
}

function draw(dt){
  resize();
  const cam=camFX(updateCamera(dt),dt);lastCam=cam;
  if(shakeT>0){const k=Math.min(1,shakeT)*.7;cam.eye=[cam.eye[0]+(R_()-.5)*k,cam.eye[1]+(R_()-.5)*k,cam.eye[2]+(R_()-.5)*k]}
  const eyeGL=[cam.eye[0],cam.eye[1],-cam.eye[2]],tgtGL=[cam.tgt[0],cam.tgt[1],-cam.tgt[2]];
  const asp=W/H;const LK=M4.look(eyeGL,tgtGL,[0,1,0]);
  const vp=M4.mul(M4.persp(cam.fov,asp,.3,2200),LK.m);
  { const _cs=player?allCars().filter(c=>!c.boom):[];shadowPass(_cs,cam);lightsSet(_cs,cam); }
  curFov=cam.fov;postBegin();
  setFrustum(vp);gl.viewport(0,0,W,H);gl.clearColor(.66,.72,.77,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  // céu
  gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.useProgram(skyP.p);
  gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,texSky);gl.uniform1i(skyP.u.u_sky,1);
  gl.uniform3fv(skyP.u.u_r,LK.r);gl.uniform3fv(skyP.u.u_u,LK.u);gl.uniform3fv(skyP.u.u_f,LK.f);
  const ty=Math.tan(cam.fov/2);gl.uniform2f(skyP.u.u_t,ty*asp,ty);
  gl.bindVertexArray(null);gl.drawArrays(gl.TRIANGLES,0,3);
  gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);
  // pista
  gl.activeTexture(gl.TEXTURE0);
  gl.useProgram(trkP.p);gl.bindVertexArray(tvao);
  gl.uniformMatrix4fv(trkP.u.u_vp,false,vp);gl.uniform3fv(trkP.u.u_eye,eyeGL);gl.uniform1f(trkP.u.u_gain,GAIN);gl.uniform1i(trkP.u.u_tex,0);
  gl.uniform1i(trkP.u.u_mode,0);gl.uniform1f(trkP.u.u_shOn,SH.on?1:0);gl.uniformMatrix4fv(trkP.u.u_sM,false,SH.M);gl.uniform1i(trkP.u.u_sm,6);gl.uniform4fv(trkP.u.u_sp,SP_P);gl.uniform4fv(trkP.u.u_sd,SP_D);
  for(const g of trkGroups.opaque){gl.uniform1i(trkP.u.u_mode,TRK.texnames[g.tex]==='gras.dds'?3:0);gl.bindTexture(gl.TEXTURE_2D,texTrk[g.tex]);gl.drawElements(gl.TRIANGLES,g.cnt,gl.UNSIGNED_SHORT,g.off*2)}
  gl.uniform1i(trkP.u.u_mode,1);
  for(const g of trkGroups.alpha){gl.bindTexture(gl.TEXTURE_2D,texTrk[g.tex]);gl.drawElements(gl.TRIANGLES,g.cnt,gl.UNSIGNED_SHORT,g.off*2)}
  // torcida (pedestres 3D animados)
  if(CROWD_ON){pedsUpdate(cam,player?allCars():[],tNow);
  drawPeds(vp,eyeGL)}
  drawHouses(vp,eyeGL,cam);
  drawTrees3(vp,eyeGL,cam);
  drawTires(vp,eyeGL,cam);
  drawGrass(vp,eyeGL,cam,performance.now());
  drawSea(vp,eyeGL);
  gl.useProgram(trkP.p);gl.bindVertexArray(tvao);
  // sombras de decalque
  gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(-2,-2);
  gl.uniform1i(trkP.u.u_mode,2);
  for(const g of trkGroups.shadow){gl.bindTexture(gl.TEXTURE_2D,texTrk[g.tex]);gl.drawElements(gl.TRIANGLES,g.cnt,gl.UNSIGNED_SHORT,g.off*2)}
  gl.disable(gl.POLYGON_OFFSET_FILL);gl.depthMask(true);gl.disable(gl.BLEND);
  // carros
  const cars=player?allCars().filter(c=>!c.boom):[];
  gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);gl.frontFace(gl.CCW);
  gl.useProgram(carP.p);gl.bindVertexArray(MD.vao);
  gl.uniformMatrix4fv(carP.u.u_vp,false,vp);gl.uniform3fv(carP.u.u_cam,eyeGL);gl.uniform3f(carP.u.u_sun,.45,.78,-.42);
  gl.uniform1i(carP.u.u_tex,0);gl.uniform1i(carP.u.u_sky,1);gl.uniform1f(carP.u.u_alpha,1);gl.uniform1f(carP.u.u_shOn,SH.on?1:0);gl.uniformMatrix4fv(carP.u.u_sM,false,SH.M);gl.uniform1i(carP.u.u_sm,6);
  const CMs=new Map();
  for(const c of cars){const dx=c.x-cam.eye[0],dz=c.z-cam.eye[2];if(dx*dx+dz*dz>500*500)continue;
    // descarta carros atrás da câmera
    const CM=carMatrix(c);CMs.set(c,CM);drawCar(c,CM,vp)}
  if(trophy&&state==='done')drawTrophy(vp,eyeGL);
  // borrão das rodas em alta velocidade
  gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);
  gl.uniform1f(carP.u.u_alpha,1);
  for(const c of cars){const CM=CMs.get(c);if(!CM)continue;drawGlass(c,CM)}
  for(const c of cars){const CM=CMs.get(c);if(!CM)continue;const a=clamp((Math.abs(c.vf??c.v)-22)/30,0,.85);if(a<.02)continue;
    gl.uniform1f(carP.u.u_alpha,a);drawBlur(c,CM)}
  // sombra sob o carro
  gl.useProgram(blobP.p);gl.bindVertexArray(bvao);gl.uniformMatrix4fv(blobP.u.u_vp,false,vp);gl.uniform3fv(blobP.u.u_sh,MD.shadow);gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(-3,-3);
  for(const c of cars){const CM=CMs.get(c);if(!CM)continue;gl.uniformMatrix4fv(blobP.u.u_model,false,M4.flipZ(CM.m.slice()));gl.drawArrays(gl.TRIANGLES,0,6)}
  if(trophy&&state==='done')drawTrophyShadow();
  gl.disable(gl.POLYGON_OFFSET_FILL);
  drawPickups(vp,LK);
  // partículas
  const np=updateParticles(dt);
  if(np>0){gl.useProgram(partP.p);gl.bindVertexArray(pvao);gl.bindBuffer(gl.ARRAY_BUFFER,pvbo);gl.bufferSubData(gl.ARRAY_BUFFER,0,pdata,0,np*10);
    gl.uniformMatrix4fv(partP.u.u_vp,false,vp);gl.uniform1f(partP.u.u_scale,H/(2*Math.tan(cam.fov/2)));
    gl.uniform1f(partP.u.u_use,texSmoke?1:0);gl.uniform1f(partP.u.u_k,texSmoke?2.4:1);
    if(texSmoke){gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texSmoke);gl.uniform1i(partP.u.u_s,0)}
    gl.drawArrays(gl.POINTS,0,np)}
  gl.depthMask(true);gl.disable(gl.BLEND);
  drawFx(vp,LK,dt);
  postEnd();
}
const GAIN0=1.75;let GAIN=GAIN0;

/* ================= 10. Minimapa ================= */
const mini=$('mini'),mctx=mini.getContext('2d');
let mb;
(function(){let a=1e9,b=-1e9,c=1e9,d=-1e9;for(const p of AIP){a=Math.min(a,p[0]);b=Math.max(b,p[0]);c=Math.min(c,p[2]);d=Math.max(d,p[2])}
  const pad=26,S=Math.min((mini.width-pad*2)/(b-a),(mini.height-pad*2)/(d-c));mb={a,b,c,d,S,ox:(mini.width-(b-a)*S)/2,oy:(mini.height-(d-c)*S)/2}})();
const mp=(x,z)=>[mb.ox+(x-mb.a)*mb.S,mini.height-(mb.oy+(z-mb.c)*mb.S)];
function drawMini(){
  mctx.clearRect(0,0,mini.width,mini.height);
  mctx.lineJoin='round';mctx.lineCap='round';mctx.beginPath();
  for(let i=0;i<=NN;i++){const p=NP(i),q=mp(p[0],p[2]);i?mctx.lineTo(q[0],q[1]):mctx.moveTo(q[0],q[1])}
  mctx.strokeStyle='rgba(255,255,255,.18)';mctx.lineWidth=11;mctx.stroke();
  mctx.strokeStyle='rgba(200,215,235,.55)';mctx.lineWidth=5;mctx.stroke();
  const f=mp(AIP[0][0],AIP[0][2]);mctx.fillStyle='#e8edf3';mctx.fillRect(f[0]-6,f[1]-2,12,4);
  if(!player)return;
  for(const k of PICKS){if(!k.on)continue;const q=mp(k.x,k.z);mctx.fillStyle=k.t?'#5fe08a':'#4db8ff';mctx.strokeStyle='#0c0e11';mctx.lineWidth=2;mctx.beginPath();mctx.arc(q[0],q[1],5,0,6.3);mctx.fill();mctx.stroke()}
  for(const a of ais){const q=mp(a.x,a.z);mctx.fillStyle=dotOf(a.skin)||'#fff';mctx.beginPath();mctx.arc(q[0],q[1],6,0,6.3);mctx.fill()}
  if(walkMode){const q=mp(player.x,player.z);mctx.fillStyle=dotOf(player.skin)||'#fff';mctx.beginPath();mctx.arc(q[0],q[1],6,0,6.3);mctx.fill();
    if(WLK.on){const w=mp(WLK.x,WLK.z),a=-WLK.yaw+Math.PI/2;mctx.save();mctx.translate(w[0],w[1]);mctx.rotate(-WLK.yaw);mctx.fillStyle='#fff';mctx.strokeStyle='#0c0e11';mctx.lineWidth=3;
      mctx.beginPath();mctx.moveTo(0,-14);mctx.lineTo(9,8);mctx.lineTo(0,3);mctx.lineTo(-9,8);mctx.closePath();mctx.stroke();mctx.fill();mctx.restore()}return}
  const q=mp(player.x,player.z);mctx.fillStyle='#ff7a2e';mctx.strokeStyle='#0c0e11';mctx.lineWidth=3;mctx.beginPath();mctx.arc(q[0],q[1],9,0,6.3);mctx.stroke();mctx.fill();
  if(onFoot&&WLK.on){const w=mp(WLK.x,WLK.z);mctx.save();mctx.translate(w[0],w[1]);mctx.rotate(-WLK.yaw);mctx.fillStyle='#fff';mctx.strokeStyle='#0c0e11';mctx.lineWidth=3;mctx.beginPath();mctx.moveTo(0,-14);mctx.lineTo(9,8);mctx.lineTo(0,3);mctx.lineTo(-9,8);mctx.closePath();mctx.stroke();mctx.fill();mctx.restore()}}

/* ================= 11. Áudio ================= */
let AC=null,master,eo1,eo2,efil,egain,sqG,wnG,muted=false;
function audioInit(){
  if(AC)return;try{AC=new (window.AudioContext||window.webkitAudioContext)()}catch(e){return}
  master=AC.createGain();master.gain.value=.55;
  const cmp=AC.createDynamicsCompressor();cmp.threshold.value=-10;cmp.knee.value=12;cmp.ratio.value=4;cmp.attack.value=.003;cmp.release.value=.2;master.connect(cmp);cmp.connect(AC.destination);
  if(AC.state==='suspended')AC.resume().catch(()=>{});
  efil=AC.createBiquadFilter();efil.type='lowpass';efil.frequency.value=900;efil.Q.value=1.2;
  egain=AC.createGain();egain.gain.value=0;efil.connect(egain);egain.connect(master);
  eo1=AC.createOscillator();eo1.type='sawtooth';eo2=AC.createOscillator();eo2.type='square';
  const g1=AC.createGain(),g2=AC.createGain();g1.gain.value=.5;g2.gain.value=.28;eo1.connect(g1);eo2.connect(g2);g1.connect(efil);g2.connect(efil);eo1.start();eo2.start();
  const nb=AC.createBuffer(1,AC.sampleRate*2,AC.sampleRate),d=nb.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
  const mkN=(type,f,q)=>{const s=AC.createBufferSource();s.buffer=nb;s.loop=true;const fl=AC.createBiquadFilter();fl.type=type;fl.frequency.value=f;fl.Q.value=q;const g=AC.createGain();g.gain.value=0;s.connect(fl);fl.connect(g);g.connect(master);s.start();return g};
  sqG=mkN('bandpass',1700,5);wnG=mkN('lowpass',500,.5);
  sndLoad();
}
function beep(f,d){if(!AC||muted)return;const o=AC.createOscillator(),g=AC.createGain();o.type='sine';o.frequency.value=f;g.gain.value=.0;o.connect(g);g.connect(master);
  const t=AC.currentTime;g.gain.linearRampToValueAtTime(.25,t+.01);g.gain.exponentialRampToValueAtTime(.001,t+d);o.start(t);o.stop(t+d+.05)}
function thump(v){if(!AC||muted)return;const nb=AC.createBufferSource(),b=AC.createBuffer(1,AC.sampleRate*.25,AC.sampleRate),d=b.getChannelData(0);
  for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*Math.exp(-i/(AC.sampleRate*.04));nb.buffer=b;const g=AC.createGain();g.gain.value=clamp(v/18,.1,.8);
  const f=AC.createBiquadFilter();f.type='lowpass';f.frequency.value=500;nb.connect(f);f.connect(g);g.connect(master);nb.start()}

/* ---- Áudio espacial: motores dos rivais (posição 3D, atenuação, Doppler), vento e ambiente. O motor do jogador continua por amostras. ---- */
const RA={list:[],wind:null,amb:null};
function rivalAudio(t){
  if(!AC||!master)return;
  const on=player&&state!=='menu'&&!paused&&!muted&&state!=='done';
  if(!RA.wind){const nb=AC.createBuffer(1,AC.sampleRate*2,AC.sampleRate),d=nb.getChannelData(0);let l=0;for(let i=0;i<d.length;i++){l=l*.97+(Math.random()*2-1)*.03;d[i]=l*6}
    const mk=(f,q,ty)=>{const s=AC.createBufferSource();s.buffer=nb;s.loop=true;const fl=AC.createBiquadFilter();fl.type=ty;fl.frequency.value=f;fl.Q.value=q;const g=AC.createGain();g.gain.value=0;s.connect(fl);fl.connect(g);g.connect(master);s.start(0,Math.random());return {g,fl}};
    RA.wind=mk(700,.7,'bandpass');RA.amb=mk(260,.5,'lowpass')}
  if(!on){RA.wind.g.gain.setTargetAtTime(0,t,.1);RA.amb.g.gain.setTargetAtTime(0,t,.1);for(const r of RA.list)r.g.gain.setTargetAtTime(0,t,.1);return}
  const c=player,sp=Math.abs(c.speed||0),inCar=!(walkMode||onFoot);
  RA.wind.g.gain.setTargetAtTime(inCar?clamp(sp/85,0,1)**1.6*.20:.03,t,.12);RA.wind.fl.frequency.setTargetAtTime(400+sp*14,t,.1);
  RA.amb.g.gain.setTargetAtTime(.035+(walkMode||onFoot?.05:0),t,.4);                // fundo urbano/torcida distante
  const cam=lastCam;if(!cam)return;
  const L=AC.listener,E=[cam.eye[0],cam.eye[1],-cam.eye[2]],F=[cam.tgt[0]-cam.eye[0],cam.tgt[1]-cam.eye[1],-(cam.tgt[2]-cam.eye[2])],fl=Math.hypot(...F)||1;
  if(L.positionX){L.positionX.value=E[0];L.positionY.value=E[1];L.positionZ.value=E[2];L.forwardX.value=F[0]/fl;L.forwardY.value=F[1]/fl;L.forwardZ.value=F[2]/fl;L.upX.value=0;L.upY.value=1;L.upZ.value=0}
  else{L.setPosition(E[0],E[1],E[2]);L.setOrientation(F[0]/fl,F[1]/fl,F[2]/fl,0,1,0)}
  (freeMode?[player,...ais]:ais).forEach((a,i)=>{let r=RA.list[i];
    if(!r){r={};r.o1=AC.createOscillator();r.o1.type='sawtooth';r.o2=AC.createOscillator();r.o2.type='square';
      r.f=AC.createBiquadFilter();r.f.type='lowpass';r.f.Q.value=1.1;r.g=AC.createGain();r.g.gain.value=0;
      r.p=AC.createPanner();r.p.panningModel='equalpower';r.p.distanceModel='inverse';r.p.refDistance=7;r.p.rolloffFactor=1.5;r.p.maxDistance=400;
      const g1=AC.createGain(),g2=AC.createGain();g1.gain.value=.5;g2.gain.value=.25;r.o1.connect(g1);r.o2.connect(g2);g1.connect(r.f);g2.connect(r.f);
      r.f.connect(r.g);r.g.connect(r.p);r.p.connect(master);r.o1.start();r.o2.start();RA.list[i]=r}
    const px=a.x,py=a.y+.6,pz=-a.z;
    if(r.p.positionX){r.p.positionX.value=px;r.p.positionY.value=py;r.p.positionZ.value=pz}else r.p.setPosition(px,py,pz);
    const dx=px-E[0],dy=py-E[1],dz=pz-E[2],dl=Math.hypot(dx,dy,dz)||1;
    const cvx=freeMode?0:(c.vx||0),cvz=freeMode?0:(c.vz||0),vr=((a.vx||0)-cvx)*dx/dl+(-(a.vz||0)+cvz)*dz/dl;        // velocidade radial (m/s) em coordenadas GL
    const dop=clamp(343/(343+vr),.88,1.14),rpm=a.rpm||3000,f=rpm/60*4*dop;
    r.o1.frequency.setTargetAtTime(f,t,.04);r.o2.frequency.setTargetAtTime(f*.5,t,.04);
    r.f.frequency.setTargetAtTime(450+rpm*.3,t,.06);
    r.g.gain.setTargetAtTime(inCar||true?.10+.05*clamp((a.thr||.6),0,1):0,t,.08)})
}
function audioUpdate(){
  if(!AC)return;const t=AC.currentTime;rivalAudio(t);
  if(master)master.gain.setTargetAtTime(footOn()&&state!=='menu'?.55*WLK.cv*WLK.cv:.55,t,.15);   // a pé: o som dos carros vem de longe
  if(SND.ready){sndUpdate(t);return}
  if(!player||state==='menu'||paused||muted||freeMode){egain.gain.setTargetAtTime(0,t,.05);sqG.gain.setTargetAtTime(0,t,.05);wnG.gain.setTargetAtTime(0,t,.05);return}
  const c=player,f=c.rpm/60*4;
  eo1.frequency.setTargetAtTime(f,t,.03);eo2.frequency.setTargetAtTime(f*.5,t,.03);
  efil.frequency.setTargetAtTime(500+c.rpm*.35+c.thr*900,t,.05);
  egain.gain.setTargetAtTime(.1+.17*c.thr+.05*clamp(c.rpm/7000,0,1),t,.05);
  sqG.gain.setTargetAtTime(c.slip*.22,t,.05);wnG.gain.setTargetAtTime(clamp(c.speed/90,0,1)*.22,t,.1);
  if(c.hit>3){thump(c.hit)}
}


/* ================= 11b. Áudio por amostras (sounds.zip) =================
   Os .wav ficam em assets/sounds/ (descodificados; data/snd.json tem xor=0) e são
   lidos aqui antes de ir para decodeAudioData.
   .snd -> curvas (x, volume, pitch) por camada; .gph -> curvas 0..1 de volume dos pneus. */
const SND={ready:false,loading:false};
let sndS=null;
function interp(p,x){const n=p.length;if(x<=p[0][0])return p[0][1];if(x>=p[n-1][0])return p[n-1][1];
  for(let i=1;i<n;i++)if(x<=p[i][0]){const a=p[i-1],b=p[i];return a[1]+(b[1]-a[1])*(x-a[0])/((b[0]-a[0])||1)}return p[n-1][1]}
function sndLoad(){if(SND.loading)return;SND.loading=true;
  sndBuild().catch(e=>{console.warn('Áudio por amostras indisponível; mantendo sintetizador:',e)})}
async function sndBuild(){
  const D=__DATA.snd;if(!D)return;
  const K=D.xor,cfg=D.cfg,bufs={};
  for(const k of Object.keys(D.files)){
    const bin=atob(D.files[k]),n=bin.length,u=new Uint8Array(n);
    for(let i=0;i<n;i++)u[i]=bin.charCodeAt(i)^K;                      // XOR 0x27
    bufs[k]=await new Promise((res,rej)=>{const p=AC.decodeAudioData(u.buffer,res,rej);if(p&&p.catch)p.catch(rej)});
    delete D.files[k];
    await new Promise(r=>setTimeout(r,0));                              // não trava a tela
  }
  const bus=AC.createGain();bus.gain.value=1;bus.connect(master);
  const mk=spec=>{const s=AC.createBufferSource();s.buffer=bufs[spec.f];s.loop=true;
    const g=AC.createGain();g.gain.value=0;s.connect(g);g.connect(bus);s.start(0,Math.random()*s.buffer.duration);
    return {s,g,vol:spec.vol,pit:spec.pit,base:spec.base}};
  const S={on:cfg.on.map(mk),off:cfg.off.map(mk),G:cfg.gph,bufs,one:cfg.one,tire:{},
    thrMix:0,t0:AC.currentTime,pThr:0,gear:1,lastHit:0,lastHitT:-1,bfT:-1,synthOff:false};
  for(const k of Object.keys(cfg.tire))S.tire[k]=mk(cfg.tire[k]);
  S.aroll=mk({f:cfg.one.aroll,vol:[[0,1]],pit:cfg.tire.askid.pit,base:1});
  S.ascrub=mk({f:cfg.one.ascrub,vol:[[0,1]],pit:cfg.tire.askid.pit,base:1});
  S.all=[...S.on,...S.off,...Object.values(S.tire),S.aroll,S.ascrub];
  sndS=S;SND.ready=true;
}
function sndOne(name,v,rate){const S=sndS,b=S.bufs[S.one[name]];if(!b)return;
  const s=AC.createBufferSource();s.buffer=b;s.playbackRate.value=rate||1;const g=AC.createGain();g.gain.value=clamp(v,0,1);
  s.connect(g);g.connect(master);s.start()}
function sndLayer(L,g,t,rate,tc){L.g.gain.setTargetAtTime(g,t,tc||.05);if(g>.002&&rate)L.s.playbackRate.setTargetAtTime(clamp(rate,.25,4),t,.05)}
function sndUpdate(t){
  const S=sndS,dt=clamp(t-S.t0,0,.1);S.t0=t;
  if(!S.synthOff){for(const p of [egain.gain,sqG.gain,wnG.gain]){p.cancelScheduledValues(t);p.setValueAtTime(0,t)}S.synthOff=true}
  if(!player||state==='menu'||paused||muted||freeMode){for(const L of S.all)L.g.gain.setTargetAtTime(0,t,.05);S.lastHit=0;return}
  const c=player,rpm=c.rpm,thr=c.thr||0;
  // --- motor: camadas on/off cruzadas pela marcha-lenta/aceleração; pitch = rpm / rpm-base da amostra
  const tgt=thr>.04?1:0;S.thrMix+=(tgt-S.thrMix)*(1-Math.exp(-dt/(tgt?.05:.14)));
  for(const L of S.on){const v=interp(L.vol,rpm);sndLayer(L,v*S.thrMix*.9,t,rpm/L.base*interp(L.pit,rpm),.04)}
  for(const L of S.off){const v=interp(L.vol,rpm);sndLayer(L,v*(1-S.thrMix)*.9,t,rpm/L.base*interp(L.pit,rpm),.04)}
  // --- pneus
  const sp=c.speed,vn=clamp(sp/70,0,1),gr=clamp(c.gr||0,0,1),wr=sp*29.67,surf=c.surf|0,G=S.G,T=S.tire; // wr = rpm da roda (m/s ÷ 0,322 m)
  const sv=interp(G.sv,vn),roll=interp(G.rollV,vn)*interp(G.rollG,gr),scr=interp(G.scrubG,gr)*sv,skd=interp(G.skidG,gr)*sv;
  const ap=interp(T.askid.pit,wr);
  let aR=0,aS=0,aK=0,kK=0,rum=0,grv=0,grs=0;
  if(surf===0){aR=roll*.85;aS=scr*.45;aK=skd*.9}
  else if(surf===1){aR=roll*.4;kK=skd*.8;rum=interp(T.rumble.vol,wr)*.9}
  else if(surf===2){grv=interp(T.gravel.vol,wr)}
  else{grs=interp(T.grass.vol,wr)}
  c.wallT=(c.wallT||0)-dt;const wall=c.wallT>0?interp(T.scrape.vol,wr)*.9:0;
  sndLayer(S.aroll,aR,t,ap);sndLayer(S.ascrub,aS,t,ap);sndLayer(T.askid,aK,t,ap,.03);
  sndLayer(T.kskid,kK,t,interp(T.kskid.pit,wr),.03);
  sndLayer(T.rumble,rum,t,interp(T.rumble.pit,wr));sndLayer(T.gravel,grv,t,interp(T.gravel.pit,wr));
  sndLayer(T.grass,grs,t,interp(T.grass.pit,wr));sndLayer(T.scrape,wall,t,interp(T.scrape.pit,wr),.03);
  // --- eventos: batida, estouro de escapamento ao tirar o pé / reduzir marcha
  if(c.hit>3&&c.hit>S.lastHit+.8&&t-S.lastHitT>.12){sndOne('hit',clamp(c.hit/18,.2,1),.95+Math.random()*.1);S.lastHitT=t}
  S.lastHit=c.hit;
  if(t-S.bfT>.5&&rpm>4200&&((S.pThr>.5&&thr<.1)||(c.gear>0&&c.gear<S.gear&&rpm>4500))){sndOne('back',.45+Math.random()*.35,.92+Math.random()*.16);S.bfT=t}
  S.pThr=thr;S.gear=c.gear;
}
['pointerdown','keydown','touchstart'].forEach(ev=>addEventListener(ev,()=>{try{audioInit()}catch(e){}if(AC&&AC.state==='suspended')AC.resume().catch(()=>{})},{passive:true}));

/* ================= 12. Entrada, telas, laço ================= */
const keys={},touch={l:0,r:0,g:0,b:0};
addEventListener('keydown',e=>{
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();
  if(e.repeat){keys[e.code]=true;return}
  keys[e.code]=true;
  if(state==='race'||state==='countdown'||state==='finish'||state==='board'){
    if(e.code==='KeyC')cycleCam();
    if(e.code==='KeyR'&&freeMode)freeInit();else if(e.code==='KeyR'&&state==='race'){if(walkMode||onFoot)walkRespawn();else resetPlayer()}
    if(e.code==='KeyE'||e.code==='KeyF')interact();
    if(e.code==='KeyP'||e.code==='Escape')togglePause();
  }
  if(e.code==='KeyM'){muted=!muted}
  if(e.code==='Enter'&&state==='menu')$('goBtn').click();
  if(e.code==='Enter'&&state==='gameover'&&!$('gameover').hidden)$('retryBtn').click();
});
addEventListener('keyup',e=>{keys[e.code]=false});
document.getElementById('camBtn').addEventListener('click',()=>{if(state==='race'||state==='countdown'||state==='finish'||state==='board')cycleCam()});
addEventListener('blur',()=>{for(const k in keys)keys[k]=false;if(state==='race'||state==='countdown')setPause(true)});
const bindTouch=(id,k)=>{const el=$(id);const on=e=>{e.preventDefault();touch[k]=1;el.style.opacity=.7;audioInit()},off=e=>{e.preventDefault();touch[k]=0;el.style.opacity=1};
  el.addEventListener('pointerdown',on);el.addEventListener('pointerup',off);el.addEventListener('pointercancel',off);el.addEventListener('pointerleave',off)};
bindTouch('tL','l');bindTouch('tR','r');bindTouch('tG','g');bindTouch('tB','b');

function setScreen(s){$('menu').hidden=s!=='menu';$('hud').hidden=s!=='hud';$('result').hidden=s!=='result';$('gameover').hidden=s!=='gameover';$('pause').hidden=!(s==='pause')}
function setPause(p){if(state==='menu'||state==='finish'&&!p)return;if(paused===p)return;paused=p;$('pause').hidden=!p}
function togglePause(){setPause(!paused)}
$('resumeBtn').onclick=()=>setPause(false);
$('quitBtn').onclick=()=>{paused=false;toMenu()};
function toMenu(){trophy=null;walkMode=false;freeMode=false;footUI(false);onFoot=false;deadPed=false;WLK.on=false;document.body.classList.remove('walk');state='menu';setScreen('menu');$('touch').classList.remove('on');prepareMenuCar()}
function prepareMenuCar(){
  player=new Car();player.skin=cfg.skin;player.isPlayer=true;const gs=gridSlot(3);placeOnLine(player,LAP-gs.gap,gs.lat);settle(player,0,true);ais=[];
  const ts=trackS(player.x,player.z,-1);player.sPrev=ts.s;player.idx=ts.idx;player.P=ts.s-LAP}
$('goBtn').onclick=()=>{audioInit();if(AC&&AC.state==='suspended')AC.resume();startRace()};
$('againBtn').onclick=()=>{startRace()};
$('menuBtn').onclick=()=>toMenu();
function renderSkins(){
  const box=$('skins');box.innerHTML='';
  for(const sk of MD.skins){
    const b=document.createElement('button');b.className='skin';b.dataset.s=sk.id;b.setAttribute('aria-pressed',sk.id===cfg.skin);
    b.innerHTML='<i style="background:'+sk.css+'"></i>'+sk.name;
    b.onclick=()=>{cfg.skin=sk.id;saveCar();box.querySelectorAll('.skin').forEach(x=>x.setAttribute('aria-pressed',x===b));if(player)player.skin=cfg.skin};
    box.append(b)}}
function saveCar(){try{localStorage.setItem('xbadl:car',JSON.stringify({car:cfg.car,skin:cfg.skin}))}catch(e){}}
function renderCars(){
  const box=$('cars');box.innerHTML='';
  for(const id of __DATA.carOrder){
    const b=document.createElement('button');b.dataset.v=id;b.textContent=MODELS[id].short;b.setAttribute('aria-pressed',id===cfg.car);
    b.onclick=()=>setCar(id);box.append(b)}
  $('lead').textContent=MD.name+' contra rivais no traçado original, com motor 3D, física e IA escritos do zero em WebGL2.'}
function setCar(id,skin){
  if(!MODELS[id])return;
  MD=MODELS[id];CP=MD.CP;TQ=MD.TQ;cfg.car=id;cfg.skin=MD.skins.some(s=>s.id===skin)?skin:MD.skins[0].id;saveCar();
  renderCars();renderSkins();
  if(player&&(state==='menu'||state==='done'))prepareMenuCar()}
try{const sv=JSON.parse(localStorage.getItem('xbadl:car')||'null');if(sv&&MODELS[sv.car]){MD=MODELS[sv.car];CP=MD.CP;TQ=MD.TQ;cfg.car=sv.car;cfg.skin=MD.skins.some(s=>s.id===sv.skin)?sv.skin:MD.skins[0].id}}catch(e){}
renderCars();renderSkins();
document.querySelectorAll('.seg[data-k]').forEach(sg=>sg.querySelectorAll('button').forEach(b=>b.onclick=()=>{cfg[sg.dataset.k]=+b.dataset.v;sg.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b));if(sg.dataset.k==='mode'){walkUI();saveWalk()}}));
const PED_LABEL={vwfyst1:'Mulher'};
function saveWalk(){try{localStorage.setItem('xbadl:walk',JSON.stringify({mode:cfg.mode,ped:cfg.ped}))}catch(e){}}
function walkUI(){
  const f=$('pedF'),box=$('pedSel');if(!f||!box)return;
  document.querySelectorAll('.seg[data-k="mode"] button').forEach(x=>x.setAttribute('aria-pressed',+x.dataset.v===cfg.mode));
  const has=!!(PD&&PD.types&&PD.types.length);
  const mb=document.querySelector('.seg[data-k="mode"] button[data-v="1"]');if(mb)mb.hidden=!has;if(!has)cfg.mode=0;
  f.hidden=cfg.mode!==1||(PD&&PD.types&&PD.types.length<2);
  if(!box.childElementCount&&has)PD.types.forEach((t,i)=>{const b=document.createElement('button');b.textContent=PED_LABEL[t.name]||t.name;b.dataset.v=i;b.onclick=()=>{cfg.ped=i;saveWalk();walkUI()};box.append(b)});
  box.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',+b.dataset.v===cfg.ped))}
try{const sv=JSON.parse(localStorage.getItem('xbadl:walk')||'null');if(sv){cfg.mode=sv.mode===2?2:0;cfg.ped=+sv.ped||0}}catch(e){}
walkUI();

/* ================= Clima / névoa (data/timecyc.json + data/fog.json) =================
   Cada clima do timecyc.dat tem, para 8 horários (0h 5h 6h 7h 12h 19h 20h 22h): cor do horizonte (SkyBot) = cor da névoa, FogSt = onde a névoa começa
   (pode ser negativo: já no carro) e FarClp = onde chega a 100%. Entre horários os valores são interpolados. "classic" = a névoa fixa de antes.
   Escolha no menu (salva no navegador) ou na URL: ?clima=FOGGY_SF&hora=12 */
const TC=__DATA.timecyc||null,FC=Object.assign({weather:'CLOUDY_LA',hour:12,density:1,presets:[['Clássico','classic']],hours:[['Dia',12]]},__DATA.fog||{});
const FSEL={w:FC.weather,h:+FC.hour};
try{const sv=JSON.parse(localStorage.getItem('xbadl:fog')||'null');if(sv){FSEL.cyc=!!sv.cyc;if(sv.w==='classic'||(TC&&TC.weathers[sv.w]))FSEL.w=sv.w;if(isFinite(sv.h))FSEL.h=+sv.h}}catch(e){}
{const q=new URLSearchParams(location.search),w=q.get('clima'),h=q.get('hora');if(w&&(w==='classic'||(TC&&TC.weathers[w.toUpperCase()])))FSEL.w=w==='classic'?w:w.toUpperCase();if(h!==null&&isFinite(+h))FSEL.h=+h}
function fogCalc(w,h,dens){
  if(!TC||!TC.weathers[w])return FOG_CLASSIC;
  const W=TC.weathers[w],H=TC.hours,n=H.length;h=((h%24)+24)%24;let i=0;for(let k=0;k<n;k++)if(H[k]<=h)i=k;
  const j=(i+1)%n,h1=j===0?24:H[j],t=h1>H[i]?(h-H[i])/(h1-H[i]):0,L=(a,b)=>a+(b-a)*t;
  const col=[0,1,2].map(k=>L(W.skyBot[i][k],W.skyBot[j][k])/255);
  let s=L(W.fogSt[i],W.fogSt[j]),e=L(W.farClp[i],W.farClp[j]);dens=dens>0?dens:1;
  e/=dens;s=s>0?s/dens:s*dens;if(e<s+20)e=s+20;
  return{c:col,s,e,m:1,sky:1}}
/* Luz pelo horário (ambiente do timecyc: noite escura, amanhecer/entardecer baixos, dia cheio); interpola entre as horas-chave */
const LIGHT_H=[[0,.30],[5,.32],[6,.55],[7,.85],[12,1],[19,.95],[20,.62],[22,.34],[24,.30]];
function lightAt(h){h=((h%24)+24)%24;for(let i=1;i<LIGHT_H.length;i++)if(h<=LIGHT_H[i][0]){const a=LIGHT_H[i-1],b=LIGHT_H[i],t=(h-a[0])/(b[0]-a[0]);return a[1]+(b[1]-a[1])*t}return 1}
function fogApply(){
  fogSet(fogCalc(FSEL.w,FSEL.h,+FC.density));GAIN=FSEL.w==='classic'?GAIN0:GAIN0*lightAt(FSEL.h);
  document.querySelectorAll('#wx button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===FSEL.w));
  document.querySelectorAll('#hr button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v==='cycle'?!!FSEL.cyc:(!FSEL.cyc&&+b.dataset.v===FSEL.h)));
  $('hr').style.display=FSEL.w==='classic'?'none':'';const hl=$('hrl');if(hl)hl.style.display=$('hr').style.display}
let dayAcc=0;
function dayTick(dt){if(!FSEL.cyc||FSEL.w==='classic'||!(dt>0&&dt<.5))return;FSEL.h=(FSEL.h+dt/40)%24;dayAcc+=dt;if(dayAcc>.2){dayAcc=0;fogApply()}}
function fogSave(){try{localStorage.setItem('xbadl:fog',JSON.stringify(FSEL))}catch(e){}}
(function fogUI(){
  const wx=$('wx'),hr=$('hr');if(!wx||!hr)return;
  for(const [lab,w] of FC.presets){if(w!=='classic'&&!(TC&&TC.weathers[w]))continue;const b=document.createElement('button');b.dataset.v=w;b.textContent=lab;b.onclick=()=>{FSEL.w=w;fogSave();fogApply()};wx.append(b)}
  for(const [lab,h] of FC.hours.concat([['Noite',22]])){const b=document.createElement('button');b.dataset.v=h;b.textContent=lab;b.onclick=()=>{FSEL.h=h;FSEL.cyc=false;fogSave();fogApply()};hr.append(b)}
  {const b=document.createElement('button');b.dataset.v='cycle';b.textContent='Ciclo';b.title='A hora avança sozinha (1 h a cada 40 s)';b.onclick=()=>{FSEL.cyc=!FSEL.cyc;fogSave();fogApply()};hr.append(b)}
  fogApply()})();

function showResult(){
  const rows=[];
  for(const c of allCars()){
    let t=c.finished?c.finTime:null;
    if(t===null){const rem=Math.max(0,LAP*cfg.laps-c.P);t=raceT+rem/Math.max(c.isAI?c.v:c.speed,28)}
    rows.push({c,t,fin:!!c.finished})}
  rows.sort((a,b)=>a.t-b.t);
  const pos=rows.findIndex(r=>r.c===player)+1;
  $('resTitle').textContent=walkMode?'Fim da corrida':pos===1?'Vitória':'P'+pos;if(!walkMode)giveTrophy(pos);
  $('resBody').innerHTML=rows.map((r,i)=>'<tr class="'+(r.c===player&&!walkMode?'you':'')+'"><td>'+(i+1)+'</td><td>'+r.c.name+(r.c.pers&&r.c!==player?' <small style="opacity:.6">'+r.c.pers.tag+'</small>':'')+'</td><td>'+(r.fin?fmt(r.t):'≈ '+fmt(r.t))+'</td><td>'+(r.c.best>0?fmt(r.c.best):'–')+'</td></tr>').join('');
  setScreen('result');state='done'}

/* ---- Governador de qualidade: mede o tempo de quadro e sobe/desce o nível (TIERS) para segurar 60 fps. Salvo em localStorage "xbadl:q". ---- */
const GOV={acc:0,n:0,mx:0,slow:0,good:0,settle:0,lock:0,up:-1e9,t0:0,fps:60,ms:16.7,show:/[?&]fps\b/.test(location.search)};
function applyTier(k){k=Math.max(0,Math.min(TIERS.length-1,k|0));Q.tier=k;const T=TIERS[k];Q.rs=T.rs;Q.lodK=T.lodK;
  if(peds){peds.near=Math.min(PD.near||75,T.near);peds.cap=Math.min(PD.cap||140,T.cap);peds.cx=1e9}
  if(houses)houses.far=Math.min(HS.far||1100,T.hfar);if(trucks)trucks.far=Math.min(TR.far||900,T.hfar);
  if(trees3)trees3.far=Math.min(TR3.far||520,T.tfar);
  if(grass)grass.q=T.gq;
  W=H=0}                                  // força o resize() a refazer o canvas
function govSet(mode){Q.mode=mode;try{localStorage.setItem('xbadl:qm',String(mode))}catch(e){}if(mode==='auto'){applyTier(COARSE?Math.max(2,Q.tier):Q.tier)}else applyTier(+mode)}
function govTick(now,dtms){
  GOV.ms+=(Math.min(dtms,100)-GOV.ms)*.08;GOV.fps=1000/GOV.ms;
  if(Q.mode!=='auto'||document.hidden||paused||!(state==='countdown'||state==='race'||state==='finish'||state==='board')||dtms>250){GOV.acc=GOV.n=GOV.mx=0;if(dtms>250)GOV.settle=Math.max(GOV.settle,now+1500);return}
  GOV.acc+=dtms;GOV.n++;GOV.mx=Math.max(GOV.mx,dtms);if(GOV.acc<1000)return;
  const avg=GOV.acc/GOV.n,mx=GOV.mx;GOV.acc=GOV.n=GOV.mx=0;if(now<GOV.settle)return;
  if(avg>19.5){GOV.good=0;if(++GOV.slow>=2&&Q.tier<TIERS.length-1){GOV.slow=0;if(now-GOV.up<9000)GOV.lock=now+60000;applyTier(Q.tier+1);GOV.settle=now+2500;try{localStorage.setItem('xbadl:q',String(Q.tier))}catch(e){}}}
  else{GOV.slow=0;if(avg<17.9&&mx<26)GOV.good++;else GOV.good=0;
    if(GOV.good>=12&&Q.tier>0&&now>GOV.lock){GOV.good=0;GOV.up=now;applyTier(Q.tier-1);GOV.settle=now+2500;try{localStorage.setItem('xbadl:q',String(Q.tier))}catch(e){}}}}
document.querySelectorAll('.seg[data-o]').forEach(sg=>{const k=sg.dataset.o;sg.querySelectorAll('button').forEach(b=>{b.setAttribute('aria-pressed',String(+b.dataset.v===OPT[k]));
  b.onclick=()=>{OPT[k]=+b.dataset.v;try{localStorage.setItem('xbadl:o:'+k,String(OPT[k]))}catch(e){}sg.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)))}})});
(function govInit(){let sv=null,qm='auto';try{sv=localStorage.getItem('xbadl:q');qm=localStorage.getItem('xbadl:qm')||'auto'}catch(e){}
  const t0=sv!==null&&sv!==''&&!isNaN(+sv)?+sv:(COARSE?2:0);Q.mode=/^[0-4]$/.test(qm)?+qm:'auto';
  GOV.init=()=>{applyTier(Q.mode==='auto'?t0:Q.mode);
    document.querySelectorAll('.seg[data-q] button').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.v)===String(Q.mode));b.onclick=()=>{govSet(b.dataset.v==='auto'?'auto':+b.dataset.v);document.querySelectorAll('.seg[data-q] button').forEach(x=>x.setAttribute('aria-pressed',x===b))}})}})();
let fpsEl=null;
function fpsOverlay(){if(!GOV.show)return;if(!fpsEl){fpsEl=document.createElement('div');fpsEl.style.cssText='position:fixed;left:6px;top:6px;z-index:99;font:12px/1.35 monospace;color:#9f9;background:rgba(0,0,0,.6);padding:4px 6px;border-radius:4px;pointer-events:none;white-space:pre';document.body.appendChild(fpsEl)}
  fpsEl.textContent=Math.round(GOV.fps)+' fps  '+GOV.ms.toFixed(1)+' ms\nnível '+Q.tier+(Q.mode==='auto'?' (auto)':' (fixo)')+'  '+W+'x'+H+(COARSE?' móvel':'')+'\ncasas '+(houses?houses.nv:0)+'  peds '+(peds?peds.drawn:0)+'  árv '+(trees3?trees3.nv|0:0)}
window.addEventListener('keydown',e=>{if(e.key==='F3'){e.preventDefault();GOV.show=!GOV.show;if(!GOV.show&&fpsEl){fpsEl.remove();fpsEl=null}}});
let last=performance.now(),hudT=0;
function frame(now){
  govTick(now,now-last);dayTick((now-last)/1000);updatePrompt();
  const dt=Math.min(.05,(now-last)/1000);last=now;tNow=now/1000;
  if(!paused&&(state==='board'||state==='countdown'||state==='race'||state==='finish'||state==='gameover')){
    acc+=dt;let n=0;while(acc>=DT&&n<12){step(DT);acc-=DT;n++}if(n>=12)acc=0;
    if(player&&state!=='countdown')player.hit*=.9; else if(player)player.hit=0;
  }
  if(player&&state!=='menu'&&(state==='race'||state==='finish'||state==='countdown'||state==='board')){
    hudT+=dt;
    if(hudT>.06){hudT=0;
      $('spd').textContent=Math.round(player.speed*3.6);
      $('gear').textContent=player.gear<0?'R':(player.speed<.8&&!player.thr?'N':player.gear);
      uiHud();
      updatePosHud();drawMini();
      const wrong=player.tx!==undefined&&player.speed>6&&(player.vx*player.tx+player.vz*player.tz)<-.35*player.speed;$('wrong').hidden=!wrong;
    }
    if(msgTimer>0){msgTimer-=dt;if(msgTimer<=0&&state!=='countdown')$('msg').textContent=''}
  }
  if(state==='menu'||state==='done'){ if(player)settle(player,0,true) }
  if(player&&state==='done'){}
  if(!$('hud').hidden)uiNeedle(dt);
  try{audioUpdate()}catch(e){}
  updateJumbo();
  if(texSky)draw(dt);
  fpsOverlay();
  requestAnimationFrame(frame)}


/* ================= 12b. Itens na pista: Nitro (azul) e Chave de roda (verde, conserta o carro) =================
   Poucos pontos espalhados pela volta toda; somem ao pegar e voltam depois de alguns segundos. */
const PICKS=[];let pickTex=null,pickVao=null,pickP=null,nosBar=null;
const PICK_DEF=[[.07,0,-2.6],[.19,1,2.6],[.31,0,0],[.44,0,2.6],[.56,1,-2.6],[.69,0,0],[.82,1,2.6],[.93,0,-2.6]]; // [fração da volta, tipo (0 nitro / 1 chave), lado]
function pickInit(){
  PICKS.length=0;if(walkMode){if(nosBar)nosBar.hidden=true;return}
  for(const [f,t,lat] of PICK_DEF){const sp=splineAt(LAP*f),rx=sp.tz,rz=-sp.tx;
    PICKS.push({x:sp.x+rx*lat,y:sp.y,z:sp.z+rz*lat,t,on:true,re:0,ph:f*40})}
  nosBar=nosBar||$('nos');if(nosBar)nosBar.hidden=true}
function pickGfx(){
  if(pickTex)return;
  const cv=document.createElement('canvas');cv.width=512;cv.height=256;const x=cv.getContext('2d');
  const disc=(cx,c1,c2)=>{const g=x.createRadialGradient(cx,128,10,cx,128,118);g.addColorStop(0,c1);g.addColorStop(1,c2);
    x.fillStyle=g;x.beginPath();x.arc(cx,128,112,0,6.3);x.fill();x.lineWidth=10;x.strokeStyle='rgba(255,255,255,.95)';x.stroke()};
  disc(128,'#7fd0ff','#1565d8');           // nitro: raio
  x.fillStyle='#fff';x.shadowColor='rgba(0,40,120,.8)';x.shadowBlur=10;x.beginPath();
  [[146,34],[84,138],[120,138],[100,222],[176,106],[138,106],[170,34]].forEach((p,i)=>i?x.lineTo(p[0],p[1]):x.moveTo(p[0],p[1]));x.closePath();x.fill();
  x.shadowBlur=0;
  disc(384,'#8cf0a8','#139a47');           // chave de roda
  x.save();x.translate(384,128);x.rotate(-Math.PI/4);x.fillStyle='#fff';x.shadowColor='rgba(0,70,30,.8)';x.shadowBlur=10;
  x.fillRect(-12,-34,24,110);x.beginPath();x.arc(0,-48,38,0,6.3);x.fill();x.globalCompositeOperation='destination-out';
  x.fillRect(-13,-100,26,50);x.globalCompositeOperation='source-over';x.beginPath();x.arc(0,80,17,0,6.3);x.fill();x.restore();
  pickTex=makeTex(cv);
  pickP=program(`#version 300 es
layout(location=0)in vec2 a;uniform mat4 u_vp;uniform vec3 u_c,u_r,u_u;uniform float u_s;out vec2 v_uv;
void main(){v_uv=a*.5+.5;gl_Position=u_vp*vec4(u_c+(u_r*a.x+u_u*a.y)*u_s,1.);}`,
`#version 300 es
precision highp float;in vec2 v_uv;out vec4 o;uniform sampler2D u_tex;uniform float u_k,u_al;
void main(){vec4 t=texture(u_tex,vec2(v_uv.x*.5+u_k*.5,1.-v_uv.y));if(t.a<.02)discard;o=vec4(t.rgb,t.a*u_al);}`);
  pickVao=gl.createVertexArray();gl.bindVertexArray(pickVao);const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,1,1,-1,-1,1,1,-1,1]),gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);gl.bindVertexArray(null)}
function repairCar(c){c.hurt=0;c.warn=0;c.fuse=0;c.dmg=[0,0,0,0];c.dents=[]}
function pickStep(dt){
  const c=player;if(!c||state!=='race')return;
  for(const k of PICKS){
    if(!k.on){k.re-=dt;if(k.re<=0)k.on=true;continue}
    const dx=c.x-k.x,dz=c.z-k.z;if(dx*dx+dz*dz>10||Math.abs(c.y-k.y)>4)continue;
    k.on=false;k.re=22;
    if(k.t){repairCar(c);flashMsg('Carro consertado!',true,2);beep(660,.1);setTimeout(()=>beep(990,.18),110)}
    else{c.boostT=Math.min(7,(c.boostT||0)+3.5);flashMsg('NITRO!',true,1.6);beep(520,.08);setTimeout(()=>beep(1040,.2),90)}}
  if(c.boostT>0){c.boostT=Math.max(0,c.boostT-dt);const sn=Math.sin(c.th),cs=Math.cos(c.th);
    for(const l of [-.45,.45]){if(R_()<60*dt)fx(R_()<.5?6:7,true,c.x-sn*2.35+cs*l,c.y+.25,c.z-cs*2.35-sn*l,c.vx*.6-sn*7,.2+R_()*.4,c.vz*.6-cs*7,.45,1.5,.28+R_()*.12,.4,.65,1,.95,.9,0,0)}}
  if(nosBar){nosBar.hidden=!(c.boostT>0);if(c.boostT>0)nosBar.querySelector('i').style.width=Math.min(100,c.boostT/7*100)+'%'}}
function drawPickups(vp,LK){
  if(!PICKS.length||!player||state==='menu')return;pickGfx();
  gl.useProgram(pickP.p);gl.bindVertexArray(pickVao);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,pickTex);
  gl.uniformMatrix4fv(pickP.u.u_vp,false,vp);gl.uniform3fv(pickP.u.u_r,LK.r);gl.uniform3fv(pickP.u.u_u,LK.u);gl.uniform1i(pickP.u.u_tex,0);gl.uniform1f(pickP.u.u_al,1);
  const cw=gl.isEnabled(gl.CULL_FACE);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);gl.disable(gl.CULL_FACE);
  for(const k of PICKS){if(!k.on)continue;const dx=k.x-player.x,dz=k.z-player.z,d2=dx*dx+dz*dz;if(d2>420*420)continue;
    const sz=.95+Math.min(1.6,Math.sqrt(d2)/90);   // um pouco maior de longe, para ser visto
    gl.uniform3f(pickP.u.u_c,k.x,k.y+1.9+.25*Math.sin(tNow*2.4+k.ph),-k.z);gl.uniform1f(pickP.u.u_s,sz);gl.uniform1f(pickP.u.u_k,k.t);gl.drawArrays(gl.TRIANGLES,0,6)}
  if(cw)gl.enable(gl.CULL_FACE);gl.bindVertexArray(null)}   // mantém BLEND ligado: as partículas logo depois dependem dele

/* ================= 12c. Modo "Observar a pé": você é um pedestre andando pelo mapa enquanto os carros correm sozinhos (IA) =================
   Menu → Modo "Observar a pé" + escolha do pedestre. WASD/setas: andar e girar · Shift: correr (no toque, correr sozinho depois de ~1,4 s andando) · C: câmera · R: voltar ao início.
   O carro do "jogador" vira mais um piloto automático. Os carros não param: se um pegar você em cheio, volta ao ponto de partida. */
const WLK={on:false,x:0,y:0,z:0,yaw:0,sp:0,sg:1,d:0,fwd:0,ty:0,sx:0,sy:0,sz:0,syaw:0,cv:1};
function wallNear(x,z,gy){
  const cx=Math.floor(x/CS),cz=Math.floor(z/CS);
  for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){const cell=wCells.get(gridKey(cx+a,cz+b));if(!cell)continue;
    for(let q=0;q<cell.length;q++){const o=cell[q]*6;if(WS[o+5]<gy+.2||WS[o+4]>gy+1.5)continue;
      const x1=WS[o],z1=WS[o+1],dx=WS[o+2]-x1,dz=WS[o+3]-z1,L=dx*dx+dz*dz;let t=L?((x-x1)*dx+(z-z1)*dz)/L:0;t=clamp(t,0,1);
      const px=x1+dx*t-x,pz=z1+dz*t-z;if(px*px+pz*pz<.14)return true}}
  return false}
let COL=null;   // colisores de árvores/casas/caminhões (data/colliders.json, tools/build_colliders.py)
function loadCol(){if(COL!==null)return;COL=false;
  fetch('data/colliders.json').then(r=>r.json()).then(d=>{const h=new Map(),K=32,put=(x,z,o)=>{const k=Math.floor(x/K)+','+Math.floor(z/K);let a=h.get(k);if(!a)h.set(k,a=[]);a.push(o)};
    for(const c of d.c)put(c[0],c[1],c);for(const b of d.b)put(b[0],b[1],b);COL={h,K,nc:d.c.length}}).catch(e=>{COL=false;console.warn('colisores indisponíveis',e)})}
function colHit(x,z,gy){
  if(!COL)return false;const K=COL.K,cx=Math.floor(x/K),cz=Math.floor(z/K);
  for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){const l=COL.h.get((cx+a)+','+(cz+b));if(!l)continue;
    for(const o of l){const dx=x-o[0],dz=z-o[1];
      if(o.length===3){const r=o[2]+.3;if(dx*dx+dz*dz<r*r)return true}
      else{const lx=dx*o[4]-dz*o[5],lz=dx*o[5]+dz*o[4];if(Math.abs(lx)<o[2]+.3&&Math.abs(lz)<o[3]+.3&&gy<o[7]-.2)return true}}}
  return false}
function walkOK(W,x,z){
  if(!groundAt(x,z,W.y+1.0))return false;const gy=gH;
  if(gy>W.y+.5||gy<W.y-1.1)return false;                    // degrau alto demais / precipício
  if(SEA&&gy<SEA.y+.3)return false;                         // água
  if(wallNear(x,z,gy)||colHit(x,z,gy))return false;
  if(onFoot&&player){const c=player,dx=x-c.x,dz=z-c.z,sn=Math.sin(c.th),cs=Math.cos(c.th),lx=dx*cs-dz*sn,lz=dx*sn+dz*cs;
    if(Math.abs(lx)<CP.hw+.3&&Math.abs(lz)<CP.hl+.25&&Math.abs(c.y-gy)<2.5)return false}   // não atravessa o próprio carro
  W.gy=gy;return true}
function walkRespawn(){const W=WLK;if(onFoot&&!walkMode){footAtDoor(3.2);return}W.x=W.sx;W.y=W.sy;W.z=W.sz;W.yaw=W.syaw;W.sp=0;W.d=0;camInit=false}
function walkInit(){
  loadCol();const W=WLK;W.on=false;W.ty=clamp(cfg.ped|0,0,PD.types.length-1);W.sp=0;W.d=0;W.fwd=0;W.sg=1;W.cv=1;
  for(const side of [1,-1])for(const s0 of [26,18,36,50]){
    const sp=splineAt(LAP-s0),rx=sp.tz,rz=-sp.tx;
    for(const extra of [6,9,13]){const off=(side>0?sp.wr:sp.wl)+extra,x=sp.x+rx*side*off,z=sp.z+rz*side*off;
      if(groundAt(x,z,sp.y+4)&&!(SEA&&gH<SEA.y+.5)){W.x=x;W.z=z;W.y=gH;W.gy=gH;W.yaw=Math.atan2(sp.tx,sp.tz);W.sx=x;W.sy=gH;W.sz=z;W.syaw=W.yaw;W.on=true;camInit=false;return}}}
  walkMode=false;document.body.classList.remove('walk');flashMsg('Não achei lugar para o pedestre')}
function walkStep(dt){
  const W=WLK;if(!(walkMode||onFoot)||!W.on)return;
  if(deadPed){W.sp=0;return}
  if(W.enter){const E=W.enter;E.t+=dt;const f=Math.min(1,E.t/.8),e=f*f*(3-2*f);W.x=E.x0+(E.x1-E.x0)*e;W.z=E.z0+(E.z1-E.z0)*e;W.yaw=E.yaw;W.sp=1.6;W.d+=1.6*dt;
    if(E.t>=.8)finishEnter();return}
  let tr=0,fw=0;
  if(keys.ArrowLeft||keys.KeyA||touch.l)tr-=1;if(keys.ArrowRight||keys.KeyD||touch.r)tr+=1;
  if(keys.ArrowUp||keys.KeyW||touch.g)fw+=1;if(keys.ArrowDown||keys.KeyS||touch.b)fw-=1;
  let run=!!(keys.ShiftLeft||keys.ShiftRight);
  const gp=(navigator.getGamepads&&navigator.getGamepads()[0]);
  if(gp){const ax=gp.axes[0]||0,ay=gp.axes[1]||0;if(Math.abs(ax)>.15)tr=ax;if(Math.abs(ay)>.15)fw=-ay;if(gp.buttons[0]&&gp.buttons[0].pressed)run=true}
  W.fwd=fw>0?W.fwd+dt:0;
  if(fw>0&&!run&&COARSE&&W.fwd>1.4)run=true;
  const vmax=fw>0?(run?5.2:1.65):fw<0?1.2:0;
  W.sp+=(vmax-W.sp)*Math.min(1,dt*(vmax>W.sp?5:10));
  if(fw)W.sg=fw>0?1:-1;
  W.yaw+=tr*(2.5-1.0*clamp(W.sp/5,0,1))*dt;
  const st=W.sp*W.sg*dt;
  if(Math.abs(st)>1e-5){
    const dx=Math.sin(W.yaw)*st,dz=Math.cos(W.yaw)*st;let mv=false;
    if(walkOK(W,W.x+dx,W.z+dz)){W.x+=dx;W.z+=dz;mv=true}
    else if(walkOK(W,W.x+dx,W.z)){W.x+=dx;mv=true}
    else if(walkOK(W,W.x,W.z+dz)){W.z+=dz;mv=true}
    if(mv)W.d+=st;else W.sp*=.5}
  if(groundAt(W.x,W.z,W.y+1.0))W.y+=(gH-W.y)*Math.min(1,dt*14);
  // carros: a distância ao mais próximo controla o som; atropelamento = volta ao ponto de partida
  let dm=1e9;
  for(const c of [player,...ais]){const dx=c.x-W.x,dz=c.z-W.z,d2=dx*dx+dz*dz;if(d2<dm)dm=d2;
    if(onFoot&&!walkMode){if(c!==player&&d2<3.4&&Math.abs(c.y-W.y)<3&&(c.isAI?c.v:c.speed)>3&&(state==='race'||state==='finish')){pedDie(c);return}}
    else if(d2<2.9&&Math.abs(c.y-W.y)<3&&(c.isAI?c.v:c.speed)>7&&state==='race'){walkRespawn();flashMsg('Cuidado! Os carros não param. Voltou ao ponto de partida',true,2.6);beep(200,.25)}}
  W.cv+=(clamp(1.15-Math.sqrt(dm)/130,.07,1)-W.cv)*Math.min(1,dt*3)}


/* ================= 12c. Pedestre entra e sai do carro ================= 
   Corrida normal: começa com a pedestre a pé ao lado do carro (estado 'board'); a contagem só roda depois que ela entra (E / botão).
   Durante a corrida, com o carro quase parado, E faz ela sair: o carro fica parado com o freio de mão e ela anda pela pista; E perto da porta volta a entrar.
   Se um carro em movimento a atinge, ela morre (fim de jogo). "?semembarque" na URL pula o embarque (testes). */
function footUI(on){document.body.classList.toggle('walk',!!on);
  const sb=document.querySelector('#tB span'),sg=document.querySelector('#tG span');if(sb)sb.textContent=on?'Ré':'Freio';if(sg)sg.textContent=on?'Andar':'Acelerar';
  const h=$('help');if(h){if(!h.dataset.o)h.dataset.o=h.textContent;h.textContent=on?'WASD / setas andar · Shift correr · E entrar/sair do carro · C câmera · R voltar ao carro · P pausa · M som':h.dataset.o}
  const n=document.getElementById('camName');if(n)n.textContent=camShort()[camMode]}
function setGoTexts(dead){const e=document.querySelector('#gameover .eyebrow'),h=document.querySelector('#gameover h1');if(e)e.textContent=dead?'Atropelada':'Carro destruído';if(h)h.textContent=dead?'Você morreu':'Game Over'}
function carDoor(d){const c=player,rx=Math.cos(c.th),rz=-Math.sin(c.th);return {x:c.x-rx*(CP.hw+d),z:c.z-rz*(CP.hw+d),rx,rz}}
function footAtDoor(d){const W=WLK,c=player,D=carDoor(d);W.x=D.x;W.z=D.z;W.y=groundAt(D.x,D.z,c.y+2)?gH:c.y-CP.ride;W.gy=W.y;W.yaw=Math.atan2(-D.rx,-D.rz);W.sp=0;W.d=0;W.enter=null;camInit=false}
function boardInit(){
  loadCol();const W=WLK,c=player;W.ty=0;W.sp=0;W.d=0;W.fwd=0;W.sg=1;W.cv=1;W.enter=null;
  const D=carDoor(3.6),fx=Math.sin(c.th),fz=Math.cos(c.th);
  W.x=D.x-fx*1.6;W.z=D.z-fz*1.6;W.y=groundAt(W.x,W.z,c.y+2)?gH:c.y-CP.ride;W.gy=W.y;W.yaw=Math.atan2(D.rx,D.rz);
  W.sx=W.x;W.sy=W.y;W.sz=W.z;W.syaw=W.yaw;W.on=true;onFoot=true;savedCam=camMode;camMode=0;camInit=false;footUI(true)}
function nearDoor(){const D=carDoor(.5),c=player,fx=Math.sin(c.th),fz=Math.cos(c.th);return Math.hypot(WLK.x-(D.x+fx*.3),WLK.z-(D.z+fz*.3))}
function interact(){
  if(paused||deadPed)return;const W=WLK;
  if(onFoot&&!walkMode&&!W.enter&&(state==='board'||state==='race'||state==='finish')){
    if(nearDoor()<3.3){const D=carDoor(.2),c=player;W.enter={t:0,x0:W.x,z0:W.z,x1:D.x+Math.sin(c.th)*.3,z1:D.z+Math.cos(c.th)*.3,yaw:Math.atan2(D.rx,D.rz)};beep(520,.06)}
    return}
  if(PED_ON&&!onFoot&&!walkMode&&state==='race'&&!player.finished&&player.speed<7&&PD&&PD.types&&PD.types.length){
    savedCam=camMode;camMode=0;footAtDoor(1.1);W.on=true;onFoot=true;footUI(true);beep(420,.06)}}
function finishEnter(){
  const W=WLK;W.enter=null;W.on=false;onFoot=false;footUI(false);camMode=savedCam;camInit=false;
  if(state==='board'){state='countdown';cdT=4.2;const m=$('msg');m.textContent='';m.className='';msgTimer=0}
  beep(380,.07)}
function pedDie(c){
  if(deadPed)return;deadPed=true;const W=WLK;W.sp=0;W.enter=null;state='gameover';goT=0;shakeT=.6;
  const vx=c.vx||0,vz=c.vz||0,L=Math.hypot(vx,vz)||1;W.yaw=Math.atan2(vx,vz)+Math.PI;W.x+=vx/L*.6;W.z+=vz/L*.6;if(groundAt(W.x,W.z,W.y+1))W.y=gH;
  for(let i=0;i<22;i++)emit(W.x+(Math.random()-.5)*.4,W.y+.2+Math.random()*.5,W.z+(Math.random()-.5)*.4,vx*.25+(Math.random()-.5)*2.5,1+Math.random()*2.2,vz*.25+(Math.random()-.5)*2.5,.45,[.55,.02,.03],.7+Math.random()*.5);
  setGoTexts(true);flashMsg('',true,0);beep(140,.35);footUI(true)}
const actEl=document.createElement('button');actEl.id='act';actEl.hidden=true;document.body.append(actEl);
actEl.addEventListener('pointerdown',e=>{e.preventDefault();interact()});
function updatePrompt(){
  let t='';
  if(!walkMode&&!deadPed&&!paused){
    if(onFoot&&!WLK.enter&&(state==='board'||state==='race'||state==='finish'))t=nearDoor()<3.3?'Entrar no carro':(state==='board'?'Vá até o seu carro':'');
    else if(!onFoot&&state==='race'&&!player.finished&&player.speed<7&&PD&&PD.types&&PD.types.length)t='Sair do carro';}
  if(t){const show=t!=='Vá até o seu carro',k=(COARSE||!show?'':'E · ')+t;if(actEl.textContent!==k)actEl.textContent=k;actEl.classList.toggle('hint',!show);actEl.hidden=false}else actEl.hidden=true}

/* ================= 13. Carregamento ================= */
(async function boot(){
  try{
    const prog=$('load');let n=0;const tot=TRK.tex.length+5+Object.values(MODELS).reduce((t,m)=>t+2+m.skins.length+Object.keys(m.def.glass||{}).length,0);const tick=()=>{n++;prog.textContent='Carregando pista… '+Math.round(n/tot*100)+'%'};
    texSky=makeTex(await loadImg(EXT.sky,'image/jpeg'),{});tick();
    try{texFx=texPlain(await loadImg(FXD.atlas,'image/webp'),false,true);texWater=texPlain(await loadImg(FXD.water,'image/webp'),true,true);texDepth=texPlain(await loadImg(FXD.depth,'image/png'),false,false)}catch(e){console.warn('texturas de mar/efeitos',e)}
    try{const FX=__DATA.fx;texSmoke=makeSmokeTex(await loadImg(FX.smoke,'image/png'))}catch(e){console.warn('fumaça animada indisponível; usando gradiente',e)}
    try{if(PD&&peds){for(let i=0;i<PD.types.length;i++)peds.T[i].atlas=makeTex(await loadImg(PD.types[i].tex,'image/webp'));for(let i=PD.types.length;i<peds.T.length;i++)peds.T[i].atlas=peds.T[i%PD.types.length].atlas}}catch(e){console.warn('texturas dos pedestres',e);peds=null}
    try{if(GR&&grass){for(const n of Object.keys(GR.tex))grass.tex[n]=makeTex(await loadImg(GR.tex[n],'image/webp'),{repeatX:false})}}catch(e){console.warn('texturas da grama',e);grass=null}
    try{if(HS&&houses){for(const n of Object.keys(HS.tex))houses.tex[n]=makeTex(await loadImg(HS.tex[n],'image/webp'))}}catch(e){console.warn('texturas das casas',e);houses=null}
    try{if(TR&&trucks){for(const n of Object.keys(TR.tex))trucks.tex[n]=makeTex(await loadImg(TR.tex[n],'image/webp'))}}catch(e){console.warn('texturas dos caminhões',e);trucks=null}
    try{if(TR3&&trees3){for(const n of Object.keys(TR3.tex))trees3.tex[n]=makeTex(await loadImg(TR3.tex[n],'image/webp'));trees3.ready=true}}catch(e){console.warn('texturas das árvores 3D',e)}
    try{if(TIR&&tires3){for(const n of Object.keys(TIR.tex))tires3.tex[n]=makeTex(await loadImg(TIR.tex[n],'image/webp'));tires3.ready=true}}catch(e){console.warn('texturas dos pneus',e)}
    for(const m of Object.values(MODELS)){const d=m.def;
      m.tex.wheel=makeTex(await loadImg(d.wheel,'image/jpeg'));tick();
      m.tex.blur=makeTex(await loadImg(d.blur,'image/png'));tick();
      for(const k of Object.keys(d.glass||{})){m.tex[k]=makeTex(await loadImg(d.glass[k],'image/png'));tick()}
      for(const sk of m.skins){m.tex[sk.id]=makeTex(await loadImg(sk.file,'image/jpeg'));tick()}}
    try{await uiInit()}catch(e){console.warn('HUD',e)}
    try{if(TRO)texWood=makeTex(await loadImg(TRO.wood,'image/jpeg'))}catch(e){console.warn('madeira do troféu',e)}
    // texturas da pista em paralelo
    texTrk=new Array(TRK.tex.length);
    await Promise.all(TRK.tex.map((t,i)=>loadImg(t.d,'image/webp').then(im=>{texTrk[i]=makeTex(im);tick()}).catch(e=>{console.warn('textura da pista falhou:',TRK.texnames[i],e);const cv=document.createElement('canvas');cv.width=cv.height=4;const cx=cv.getContext('2d');cx.fillStyle='#8a8a86';cx.fillRect(0,0,4,4);texTrk[i]=makeTex(cv);tick()})));
    gl.bindTexture(gl.TEXTURE_2D,null);
    try{const J=EXT.jumbo,ti=TRK.texnames.indexOf('jumbo.dds');
      if(J&&ti>=0){const img=await loadImg(J.d,'image/jpeg'),cv=document.createElement('canvas');cv.width=cv.height=128;
        const ctx=cv.getContext('2d');ctx.drawImage(img,0,0,64,64,0,0,128,128);const tex=makeTex(cv);texTrk[ti]=tex;jb={J,img,cv,ctx,tex,f:-1}}}catch(e){console.warn('telão',e)}
    // objetos do carro: parâmetros de desenho
    prepareMenuCar();setScreen('menu');renderTally();
    $('load').classList.add('off');
    GOV.init();
    window.__ready=true;
  }catch(e){$('load').textContent='Falha ao carregar: '+e.message;console.error(e)}
  requestAnimationFrame(frame);
})();
window.__game={RA,CFX,splineAt,st:()=>state,onFoot:()=>onFoot,dead:()=>deadPed,interact,col:()=>COL,colHit,wlk:()=>WLK,walkOK,gAt:(x,z,y)=>groundAt(x,z,y)?gH:null,picks:()=>PICKS,plr:()=>player,EXT,MODELS,setCar,demoTrophy:(pos,level)=>{if(!player)prepareMenuCar();if(level!==undefined)cfg.level=level;giveTrophy(pos);setScreen('result');state='done'},toMenu:()=>toMenu(),get state(){return state},get camState(){return camState},get player(){return player},get ais(){return ais},cfg,start:()=>startRace(),setAuto:v=>{auto=v},LAP,NN,
  step,setGain:v=>{GAIN=v},get raceT(){return raceT},set camMode(v){camMode=v},trackS,groundAt,get P(){return player&&player.P},get bestLap(){return bestLap},standings:()=>standings().map(c=>c.name||'?')};
