/* Visualizador WebGL2 simples (órbita, picking por raio, textura por faixa de índices). */
E.Viewer=class{
  constructor(cv){
    this.cv=cv;const gl=this.gl=cv.getContext('webgl2',{antialias:true,alpha:false});if(!gl)throw new Error('WebGL2 indisponível');
    this.cam={yaw:.8,pit:.4,dist:10,tx:0,ty:0,tz:0};this.model=null;this.dirty=true;this.wire=false;this.onpick=null;
    const sh=(t,s)=>{const o=gl.createShader(t);gl.shaderSource(o,s);gl.compileShader(o);if(!gl.getShaderParameter(o,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(o));return o};
    const mk=(v,f)=>{const p=gl.createProgram();gl.attachShader(p,sh(gl.VERTEX_SHADER,v));gl.attachShader(p,sh(gl.FRAGMENT_SHADER,f));gl.bindAttribLocation(p,0,'a_p');gl.bindAttribLocation(p,1,'a_n');gl.bindAttribLocation(p,2,'a_c');gl.bindAttribLocation(p,3,'a_t');gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));return p};
    this.prog=mk(`#version 300 es
in vec3 a_p;in vec3 a_n;in vec4 a_c;in vec2 a_t;uniform mat4 u_vp;uniform vec3 u_off;out vec3 v_n;out vec4 v_c;out vec2 v_t;
void main(){v_n=a_n;v_c=a_c;v_t=a_t;gl_Position=u_vp*vec4(a_p+u_off,1.);}`,`#version 300 es
precision mediump float;in vec3 v_n;in vec4 v_c;in vec2 v_t;uniform sampler2D u_tex;uniform vec4 u_col;uniform float u_hl,u_at,u_useTex;out vec4 o;
void main(){vec4 t=u_useTex>.5?texture(u_tex,v_t):vec4(1.);vec4 c=t*v_c*u_col;if(u_at>.5&&c.a<.5)discard;
 vec3 n=normalize(v_n);float l=.45+.55*max(dot(n,normalize(vec3(.4,.8,.3))),0.)+.15*max(dot(n,normalize(vec3(-.5,.2,-.6))),0.);
 vec3 rgb=c.rgb*l;rgb=mix(rgb,vec3(1.,.48,.12),u_hl*.55);o=vec4(rgb,1.);}`);
    this.lprog=mk(`#version 300 es
in vec3 a_p;in vec3 a_n;in vec4 a_c;in vec2 a_t;uniform mat4 u_vp;void main(){gl_Position=u_vp*vec4(a_p,1.);}`,`#version 300 es
precision mediump float;uniform vec4 u_col;out vec4 o;void main(){o=u_col;}`);
    this.white=this.makeTex(null);this.texs=new Map();
    new ResizeObserver(()=>{this.dirty=true;this.req()}).observe(cv);
    this._loop=()=>{if(this.dirty){this.dirty=false;this.draw()}requestAnimationFrame(this._loop)};requestAnimationFrame(this._loop);
  }
  req(){this.dirty=true}
  makeTex(img){const gl=this.gl,t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
    if(img){gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR)}
    else{gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([200,200,200,255]));gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST)}
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);return t}
  setTexImage(key,img){const old=this.texs.get(key);if(old)this.gl.deleteTexture(old);this.texs.set(key,this.makeTex(img));this.req()}
  /* model: {vb:Uint8Array,ib:Uint16Array,stride,colorOff:-1|n,uvOff,ranges:[{start,count,tex:key|null,alpha,color:[r,g,b,a],hidden,hl}]} */
  setModel(m){const gl=this.gl;this.model=m;this._wireIb=null;
    if(!this.vao){this.vao=gl.createVertexArray();this.vbo=gl.createBuffer();this.ibo=gl.createBuffer()}
    gl.bindVertexArray(this.vao);gl.bindBuffer(gl.ARRAY_BUFFER,this.vbo);gl.bufferData(gl.ARRAY_BUFFER,m.vb,gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,m.stride,0);
    gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.BYTE,true,m.stride,12);
    if(m.colorOff>=0){gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,4,gl.UNSIGNED_BYTE,true,m.stride,m.colorOff)}else{gl.disableVertexAttribArray(2);gl.vertexAttrib4f(2,1,1,1,1)}
    gl.enableVertexAttribArray(3);gl.vertexAttribPointer(3,2,gl.FLOAT,false,m.stride,m.uvOff);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.ibo);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,m.ib,gl.DYNAMIC_DRAW);gl.bindVertexArray(null);
    this.f32=new Float32Array(m.vb.buffer,m.vb.byteOffset,m.vb.byteLength>>2);this.req()}
  bounds(ranges){const m=this.model,F=this.f32,S=m.stride>>2,I=m.ib;let mn=[1e30,1e30,1e30],mx=[-1e30,-1e30,-1e30];
    for(const r of ranges){const of=r.off||[0,0,0];for(let k=r.start;k<r.start+r.count;k++){const v=I[k]*S;for(let a=0;a<3;a++){const x=F[v+a]+of[a];if(x<mn[a])mn[a]=x;if(x>mx[a])mx[a]=x}}}
    if(mn[0]>mx[0])return null;return{mn,mx,c:mn.map((v,i)=>(v+mx[i])/2),r:Math.hypot(mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2])/2}}
  frame(ranges){const b=this.bounds(ranges||this.model.ranges.filter(r=>!r.hidden));if(!b)return;const c=this.cam;c.tx=b.c[0];c.ty=b.c[1];c.tz=b.c[2];c.dist=Math.max(.5,b.r*2.2);this.far=Math.max(100,b.r*40);this.req()}
  eye(){const c=this.cam;return[c.tx+c.dist*Math.cos(c.pit)*Math.sin(c.yaw),c.ty+c.dist*Math.sin(c.pit),c.tz+c.dist*Math.cos(c.pit)*Math.cos(c.yaw)]}
  matrices(){const cv=this.cv,asp=cv.clientWidth/Math.max(1,cv.clientHeight),c=this.cam,e=this.eye(),f=1/Math.tan(.45),n=Math.max(.02,c.dist*.01),fa=(this.far||1000)+c.dist;
    let z=[e[0]-c.tx,e[1]-c.ty,e[2]-c.tz],l=Math.hypot(...z);z=z.map(v=>v/l);let x=[z[2],0,-z[0]];l=Math.hypot(...x)||1;x=x.map(v=>v/l);const y=[z[1]*x[2]-z[2]*x[1],z[2]*x[0]-z[0]*x[2],z[0]*x[1]-z[1]*x[0]];
    const V=[x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-(x[0]*e[0]+x[1]*e[1]+x[2]*e[2]),-(y[0]*e[0]+y[1]*e[1]+y[2]*e[2]),-(z[0]*e[0]+z[1]*e[1]+z[2]*e[2]),1];
    const nf=1/(n-fa),P=[f/asp,0,0,0,0,f,0,0,0,0,(fa+n)*nf,-1,0,0,2*fa*n*nf,0];
    const M=new Float32Array(16);for(let cI=0;cI<4;cI++)for(let r=0;r<4;r++){let s=0;for(let k=0;k<4;k++)s+=P[k*4+r]*V[cI*4+k];M[cI*4+r]=s}
    return{M,eye:e,x,y,z,asp,f}}
  buildWire(){const m=this.model,gl=this.gl,I=m.ib,out=new Uint16Array(I.length*2);
    for(let k=0;k+2<I.length;k+=3){const o=k*2;out[o]=I[k];out[o+1]=I[k+1];out[o+2]=I[k+1];out[o+3]=I[k+2];out[o+4]=I[k+2];out[o+5]=I[k]}
    if(!this.wibo)this.wibo=gl.createBuffer();gl.bindVertexArray(this.vao);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.wibo);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,out,gl.DYNAMIC_DRAW);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.ibo);gl.bindVertexArray(null);this._wireIb=m.ib}
  draw(){const gl=this.gl,cv=this.cv,dpr=Math.min(2,devicePixelRatio||1),w=cv.clientWidth*dpr|0,h=cv.clientHeight*dpr|0;if(w<2||h<2)return;if(cv.width!==w||cv.height!==h){cv.width=w;cv.height=h}
    gl.viewport(0,0,w,h);gl.clearColor(.04,.05,.06,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.disable(gl.BLEND);
    const{M}=this.matrices();this.drawGrid(M);const m=this.model;
    if(m){
    const wire=!!this.wire;if(wire&&this._wireIb!==m.ib)this.buildWire();
    gl.useProgram(this.prog);gl.uniformMatrix4fv(gl.getUniformLocation(this.prog,'u_vp'),false,M);const U=n=>gl.getUniformLocation(this.prog,n);
    gl.bindVertexArray(this.vao);if(wire){gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.wibo)}gl.uniform1i(U('u_tex'),0);gl.activeTexture(gl.TEXTURE0);
    for(const r of m.ranges){if(r.hidden||!r.count)continue;const tx=!wire&&!this.flat&&r.tex!=null&&this.texs.get(r.tex);gl.bindTexture(gl.TEXTURE_2D,tx||this.white);
      const c=wire?(r.hl?[1,.55,.2,1]:[.62,.7,.78,1]):(r.color||[1,1,1,1]);gl.uniform4f(U('u_col'),c[0],c[1],c[2],c[3]);gl.uniform1f(U('u_hl'),r.hl?1:0);gl.uniform1f(U('u_at'),!wire&&r.alpha&&tx?1:0);gl.uniform1f(U('u_useTex'),tx?1:0);const of=r.off||[0,0,0];gl.uniform3f(U('u_off'),of[0],of[1],of[2]);
      if(wire)gl.drawElements(gl.LINES,r.count*2,gl.UNSIGNED_SHORT,r.start*4);else gl.drawElements(gl.TRIANGLES,r.count,gl.UNSIGNED_SHORT,r.start*2)}
    if(wire)gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.ibo);
    gl.bindVertexArray(null)}
    if(this.onframe)this.onframe(gl,M,this.matrices());if(this.onchange)this.onchange()}
  drawGrid(M){const gl=this.gl;if(!this.gridBuf){const a=[];for(let i=-20;i<=20;i++){a.push(i,0,-20,i,0,20,-20,0,i,20,0,i)}this.gridN=a.length/3;this.gridBuf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.gridBuf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(a),gl.STATIC_DRAW);this.gvao=gl.createVertexArray();gl.bindVertexArray(this.gvao);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,12,0);gl.disableVertexAttribArray(1);gl.disableVertexAttribArray(2);gl.disableVertexAttribArray(3);
      const ax=[0,0,0,3,0,0,0,0,0,0,3,0,0,0,0,0,0,3];this.axBuf=gl.createBuffer();this.avao=gl.createVertexArray();gl.bindVertexArray(this.avao);gl.bindBuffer(gl.ARRAY_BUFFER,this.axBuf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(ax),gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,12,0)}
    gl.useProgram(this.lprog);gl.uniformMatrix4fv(gl.getUniformLocation(this.lprog,'u_vp'),false,M);const uc=gl.getUniformLocation(this.lprog,'u_col');
    gl.bindVertexArray(this.gvao);gl.uniform4f(uc,.2,.24,.3,1);gl.drawArrays(gl.LINES,0,this.gridN);
    gl.bindVertexArray(this.avao);const cols=[[1,.3,.3,1],[.4,1,.4,1],[.4,.6,1,1]];for(let i=0;i<3;i++){gl.uniform4fv(uc,cols[i]);gl.drawArrays(gl.LINES,i*2,2)}gl.bindVertexArray(null)}
  /* raio a partir de coordenadas de tela (px do elemento) */
  ray(px,py){const cv=this.cv,{x,y,z,eye,asp,f}=this.matrices();const nx=(px/cv.clientWidth)*2-1,ny=1-(py/cv.clientHeight)*2;
    const d=[0,1,2].map(i=>x[i]*nx*asp/f+y[i]*ny/f-z[i]);const l=Math.hypot(...d);return{o:eye,d:d.map(v=>v/l)}}
  pick(px,py){const m=this.model;if(!m)return null;const{o:O,d}=this.ray(px,py),F=this.f32,S=m.stride>>2,I=m.ib;let best=1e30,hit=null;
    for(let ri=0;ri<m.ranges.length;ri++){const r=m.ranges[ri];if(r.hidden||!r.count)continue;const of=r.off||[0,0,0],o=[O[0]-of[0],O[1]-of[1],O[2]-of[2]];
      for(let k=r.start;k+2<r.start+r.count;k+=3){const a=I[k]*S,b=I[k+1]*S,c=I[k+2]*S;
        const e1=[F[b]-F[a],F[b+1]-F[a+1],F[b+2]-F[a+2]],e2=[F[c]-F[a],F[c+1]-F[a+1],F[c+2]-F[a+2]];
        const p=[d[1]*e2[2]-d[2]*e2[1],d[2]*e2[0]-d[0]*e2[2],d[0]*e2[1]-d[1]*e2[0]],det=e1[0]*p[0]+e1[1]*p[1]+e1[2]*p[2];if(Math.abs(det)<1e-12)continue;
        const inv=1/det,t=[o[0]-F[a],o[1]-F[a+1],o[2]-F[a+2]],u=(t[0]*p[0]+t[1]*p[1]+t[2]*p[2])*inv;if(u<0||u>1)continue;
        const q=[t[1]*e1[2]-t[2]*e1[1],t[2]*e1[0]-t[0]*e1[2],t[0]*e1[1]-t[1]*e1[0]],v=(d[0]*q[0]+d[1]*q[1]+d[2]*q[2])*inv;if(v<0||u+v>1)continue;
        const dist=(e2[0]*q[0]+e2[1]*q[1]+e2[2]*q[2])*inv;if(dist>0&&dist<best){best=dist;hit={range:ri,tri:k,dist,point:[O[0]+d[0]*dist,O[1]+d[1]*dist,O[2]+d[2]*dist]}}}}
    return hit}
  /* ---------- câmera: zoom, vistas, controles ---------- */
  /* ponto do mundo sob o cursor, no plano que passa pelo alvo da câmera (usado para zoom "para o cursor") */
  _focusPt(px,py){const{o,d}=this.ray(px,py),c=this.cam,z=this.matrices().z,den=d[0]*z[0]+d[1]*z[1]+d[2]*z[2];if(Math.abs(den)<1e-6)return null;
    const t=((c.tx-o[0])*z[0]+(c.ty-o[1])*z[1]+(c.tz-o[2])*z[2])/den;return[o[0]+d[0]*t,o[1]+d[1]*t,o[2]+d[2]*t]}
  distLimits(){const far=this.far||1000;return[this.minDist||.05,Math.max(20,far*1.2)]}
  /* f<1 aproxima, f>1 afasta. px,py (px CSS do canvas) = ponto que fica parado; sem eles zoom no centro */
  zoomAt(f,px,py){const c=this.cam,[mn,mx]=this.distLimits(),nd=E.clamp(c.dist*f,mn,mx);if(nd===c.dist)return;
    const hasP=px!=null,P=hasP?this._focusPt(px,py):null;c.dist=nd;
    if(P){const Q=this._focusPt(px,py);if(Q){c.tx+=P[0]-Q[0];c.ty+=P[1]-Q[1];c.tz+=P[2]-Q[2]}}this.req()}
  zoomAnim(f){const c=this.cam,[mn,mx]=this.distLimits(),to=E.clamp(c.dist*f,mn,mx);if(this._tw)this._tw();this._tw=E.tween({d:c.dist},{d:to},180,v=>{c.dist=v.d;this.req()})}
  /* vistas prontas: name = 'front' | 'side' | 'top' | 'iso' (suave) */
  setView(name){const c=this.cam,V={front:[0,0],back:[Math.PI,0],side:[Math.PI/2,0],left:[-Math.PI/2,0],top:[c.yaw,1.5],iso:[.8,.4]}[name];if(!V)return;
    let ty=V[0];const dy=((ty-c.yaw+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;ty=c.yaw+dy;
    if(this._tv)this._tv();this._tv=E.tween({y:c.yaw,p:c.pit},{y:ty,p:V[1]},260,v=>{c.yaw=v.y;c.pit=v.p;this.req()})}
  /* barra flutuante: fit = função de enquadrar da aba */
  addToolbar(host,fit){const V=this;fit=fit||(()=>V.frame());
    const zb=E.zoomBar(host,{out:()=>V.zoomAnim(1.4),in:()=>V.zoomAnim(1/1.4),fit,label:'—',
      extra:[{t:'Frente',title:'Vista de frente  ( 1 )',fn:()=>V.setView('front')},{t:'Lado',title:'Vista lateral  ( 2 )',fn:()=>V.setView('side')},{t:'Topo',title:'Vista de cima  ( 3 )',fn:()=>V.setView('top')},{t:'3D',title:'Vista em perspectiva  ( 4 )',fn:()=>V.setView('iso')}]});
    this.zb=zb;this._fit=fit;this.onchange=()=>{const d=V.cam.dist;zb.label(d>=100?d.toFixed(0)+' m':d>=10?d.toFixed(1)+' m':d.toFixed(2)+' m')};this.onchange();return zb}
  attachControls(){const cv=this.cv,V=this,pts=new Map();let drag=null,moved=0,pinch=null,hover=false;
    const pan=(dx,dy)=>{const c=this.cam,{x,y}=this.matrices(),k=2*c.dist*Math.tan(.45)/Math.max(1,cv.clientHeight);c.tx+=(-x[0]*dx+y[0]*dy)*k;c.ty+=(-x[1]*dx+y[1]*dy)*k;c.tz+=(-x[2]*dx+y[2]*dy)*k};
    const rel=e=>{const r=cv.getBoundingClientRect();return[e.clientX-r.left,e.clientY-r.top]};
    const two=()=>{const a=[...pts.values()];return{d:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)||1,mx:(a[0].x+a[1].x)/2,my:(a[0].y+a[1].y)/2}};
    cv.onpointerdown=e=>{cv.setPointerCapture(e.pointerId);pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(pts.size===2){pinch=two();drag=null;return}
      drag={x:e.clientX,y:e.clientY,btn:e.button,pan:e.button===2||e.shiftKey||e.button===1||!!this._space};moved=0};
    cv.onpointermove=e=>{const p=pts.get(e.pointerId);if(p){p.x=e.clientX;p.y=e.clientY}
      if(pinch&&pts.size>=2){const n=two(),r=cv.getBoundingClientRect();this.zoomAt(pinch.d/n.d,n.mx-r.left,n.my-r.top);pan(n.mx-pinch.mx,n.my-pinch.my);pinch=n;this.req();return}
      if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.x=e.clientX;drag.y=e.clientY;moved+=Math.abs(dx)+Math.abs(dy);const c=this.cam;
      if(drag.pan)pan(dx,dy);else{c.yaw-=dx*.006;c.pit=Math.max(-1.5,Math.min(1.5,c.pit+dy*.006))}this.req()};
    cv.onpointerup=cv.onpointercancel=e=>{pts.delete(e.pointerId);if(pinch){if(pts.size<2)pinch=null;drag=null;return}
      if(drag&&moved<4&&drag.btn===0&&this.onpick&&e.type==='pointerup'){const r=cv.getBoundingClientRect();this.onpick(this.pick(e.clientX-r.left,e.clientY-r.top),e)}drag=null};
    cv.oncontextmenu=e=>e.preventDefault();
    cv.addEventListener('wheel',e=>{e.preventDefault();const u=e.deltaMode===1?16:e.deltaMode===2?400:1,k=Math.exp(Math.max(-300,Math.min(300,e.deltaY*u))*(e.ctrlKey?.008:.0016)),[px,py]=rel(e);this.zoomAt(k,px,py)},{passive:false});
    cv.addEventListener('pointerenter',()=>hover=true);cv.addEventListener('pointerleave',()=>hover=false);
    /* teclado: só vale com o mouse em cima do visualizador e sem estar digitando */
    document.addEventListener('keydown',e=>{if(e.code==='Space'&&hover&&!/INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName)){this._space=true;cv.style.cursor='grab';e.preventDefault()}});
    document.addEventListener('keyup',e=>{if(e.code==='Space'){this._space=false;cv.style.cursor=''}});
    document.addEventListener('keydown',e=>{if(!hover||e.ctrlKey||e.metaKey||e.altKey||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||cv.offsetParent===null)return;const c=this.cam,k=e.key;let h=true;
      if(k==='+'||k==='=')this.zoomAnim(1/1.3);else if(k==='-'||k==='_')this.zoomAnim(1.3);
      else if(k==='f'||k==='F'||k==='Home')(this._fit||(()=>this.frame()))();
      else if(k==='1')this.setView('front');else if(k==='2')this.setView('side');else if(k==='3')this.setView('top');else if(k==='4')this.setView('iso');
      else if(k.startsWith('Arrow')){const dx=k==='ArrowLeft'?1:k==='ArrowRight'?-1:0,dy=k==='ArrowUp'?1:k==='ArrowDown'?-1:0;if(e.shiftKey)pan(dx*30,dy*30);else{c.yaw+=dx*.12;c.pit=E.clamp(c.pit-dy*.12,-1.5,1.5)}this.req()}
      else h=false;if(h)e.preventDefault()})}
};
