/* Aba Configurações: carros (física, torque, pinturas), som (curvas), constantes do jogo, troféus, pista. */
(function(){
const $=E.$;let sec='car',docs={},mod=new Set(),tun=null,curCar=null,seq=0;
const SECS=[['car','Carros'],['snd','Som (motor / pneus)'],['game','Regras e física do jogo'],['tro','Troféus'],['trk','Pista / ambiente'],['fog','Clima / névoa'],['crowd','Torcida']];
const PHYL={m:['Massa (kg)',''],a:['CG → eixo dianteiro (m)',''],b:['CG → eixo traseiro (m)',''],Iz:['Inércia de guinada (kg·m²)',''],wr:['Raio da roda (m)',''],rev:['Relação da ré',''],fin:['Relação final (diferencial)',''],
  idle:['Marcha lenta (rpm)',''],red:['Rotação de corte (rpm)',''],up:['Rotação de troca de marcha (rpm)',''],wx:['Meia bitola (m)',''],wfz:['Eixo dianteiro, z (m)',''],wrz:['Eixo traseiro, z (m)',''],ride:['Altura do chassi (m)',''],hw:['Meia largura de colisão (m)',''],hl:['Meio comprimento de colisão (m)','']};
const touch=p=>{mod.add(p);E.setDirty('config',true)};
const J=async p=>docs[p]||(docs[p]=await E.api.json(p));
function fld(label,input,hint){return E.el('label',{class:'fld'},[E.el('span',{},[E.el('b',{text:label}),hint?E.el('small',{text:'  '+hint}):null]),input])}
function numIn(v,set,step){const i=E.el('input',{type:'text',value:v});i.onchange=()=>{const n=parseFloat(String(i.value).replace(',','.'));if(isFinite(n)){set(n);touch.cb&&touch.cb()}else i.value=v};return i}
function txtIn(v,set){const i=E.el('input',{type:'text',value:v});i.onchange=()=>set(i.value);return i}
function sel(items,v,set){const s=E.el('select');E.fillSelect(s,items.map(x=>Array.isArray(x)?x:[x,x]),v);s.onchange=()=>set(s.value);return s}

E.init_cfg=async function(){
  const nav=$('#cf-nav');SECS.forEach(([id,t])=>nav.append(E.el('div',{class:'it','data-s':id,text:t,onclick:E.guard(()=>go(id))})));
  E.on('cf-save','click',E.guard(save));E.on('cf-reload','click',E.guard(async()=>{if(E.dirty.config&&!confirm('Descartar alterações não salvas?'))return;docs={};mod.clear();tun=null;E.setDirty('config',false);await go(sec)}));
  await go('car')};
async function go(id){if(sec!==id&&E.dirty.config&&!confirm('Há alterações não salvas nas configurações. Trocar de seção mesmo assim? (as alterações ficam na memória, mas só são gravadas com “Salvar”)'))return;
  sec=id;E.$$('#cf-nav .it').forEach(e=>e.classList.toggle('on',e.dataset.s===id));$('#cf-title').textContent=SECS.find(s=>s[0]===id)[1];$('#cf-body').innerHTML='';
  await({car:secCar,snd:secSnd,game:secGame,tro:secTro,trk:secTrk,fog:secFog,crowd:secCrowd})[id]()}
async function save(){let n=0;
  for(const p of mod){if(p==='js/game.js'){await saveTun();n++}else{await E.jsonSave(p,docs[p]);n++}}
  mod.clear();E.setDirty('config',false);E.toast(n+' arquivo(s) salvo(s) — recarregue o jogo na aba Jogo')}

/* ================= CARROS ================= */
async function secCar(){const body=$('#cf-body'),idx=await J('cars/cars.json');if(!curCar||!idx.cars.includes(curCar))curCar=idx.default;
  const top=E.el('div',{class:'box'});body.append(top);
  const s=sel(idx.cars,curCar,v=>{curCar=v;go('car')});
  top.append(E.el('div',{class:'hd'},[E.el('b',{text:'Carros do jogo'}),E.el('span',{class:'pill',text:idx.cars.length+' carro(s)'})]));
  top.append(E.el('div',{class:'rowf'},[s,
    E.el('button',{text:'★ Definir como padrão',onclick:()=>{idx.default=curCar;touch('cars/cars.json');E.toast('Padrão: '+curCar)}}),
    E.el('button',{text:'↑',title:'Mover acima',onclick:()=>{const i=idx.cars.indexOf(curCar);if(i>0){idx.cars.splice(i,1);idx.cars.splice(i-1,0,curCar);touch('cars/cars.json');go('car')}}}),
    E.el('button',{text:'↓',title:'Mover abaixo',onclick:()=>{const i=idx.cars.indexOf(curCar);if(i<idx.cars.length-1){idx.cars.splice(i,1);idx.cars.splice(i+1,0,curCar);touch('cars/cars.json');go('car')}}}),
    E.el('button',{text:'＋ Novo carro (cópia deste)',onclick:E.guard(()=>newCar(idx))}),
    E.el('button',{text:'🗑 Excluir',onclick:E.guard(()=>delCar(idx))})]));
  top.append(E.el('div',{class:'hint',text:'Padrão atual: '+idx.default+'. A ordem define o menu do jogo. Malha/peças: aba Modelos 3D.'}));
  const p='cars/'+curCar+'/car.json',c=await J(p),ch=()=>touch(p);
  const g=E.el('div',{class:'box'});body.append(g);g.append(E.el('div',{class:'hd'},[E.el('b',{text:'Identificação'})]));
  g.append(E.el('div',{class:'grid2'},[fld('Nome completo',txtIn(c.name||'',v=>{c.name=v;ch()})),fld('Nome curto (menu)',txtIn(c.short||'',v=>{c.short=v;ch()}))]));
  const ph=E.el('div',{class:'box'});body.append(ph);ph.append(E.el('div',{class:'hd'},[E.el('b',{text:'Física e dimensões'})]));
  const gr=E.el('div',{class:'grid2'});ph.append(gr);
  for(const k of Object.keys(c.phys)){if(k==='gear')continue;gr.append(fld(PHYL[k]?PHYL[k][0]:k,numIn(c.phys[k],v=>{c.phys[k]=v;ch()}),'['+k+']'))}
  gr.append(fld('Marchas (relações; 1º valor = neutro 0)',txtIn(c.phys.gear.join(', '),v=>{const a=v.split(/[ ,;]+/).filter(Boolean).map(Number);if(a.length>=2&&a.every(isFinite)){c.phys.gear=a;ch()}else E.toast('Use números separados por vírgula',true)}),'[gear]'));
  const tq=E.el('div',{class:'box'});body.append(tq);tq.append(E.el('div',{class:'hd'},[E.el('b',{text:'Curva de torque'}),E.el('span',{class:'muted',text:'arraste · duplo clique adiciona · Shift+clique remove'})]));
  const info=E.el('span',{class:'muted'});const upd=()=>{const mx=Math.max(...c.torque.pts.map(q=>q[1]));info.textContent='pico '+c.torque.peakNm+' Nm em '+(c.torque.pts.find(q=>q[1]===mx)[0]*10000|0)+' rpm · corte em '+(c.torque.pts[c.torque.pts.length-1][0]*10000|0)+' rpm'};
  tq.append(E.el('div',{class:'rowf'},[fld('Torque de pico (Nm)',numIn(c.torque.peakNm,v=>{c.torque.peakNm=v;ch();upd()})),info]));
  const host=E.el('div');tq.append(host);
  E.curve(host,{pts:c.torque.pts,h:200,ymax:1.2,xfmt:v=>Math.round(v*10000),yfmt:v=>Math.round(v/Math.max(...c.torque.pts.map(q=>q[1]))*c.torque.peakNm)+' Nm',onchange:pts=>{c.torque.pts=pts;ch();upd()}});upd();
  tq.append(E.el('div',{class:'hint',text:'Eixo X em rpm (valor×10000); o eixo Y é relativo — o ponto mais alto vale o “torque de pico”.'}));
  // pinturas
  const sk=E.el('div',{class:'box'});body.append(sk);sk.append(E.el('div',{class:'hd'},[E.el('b',{text:'Pinturas (skins)'}),E.el('button',{text:'＋ Adicionar',onclick:()=>{const b=c.skins[0],n=Object.assign(JSON.parse(JSON.stringify(b)),{id:'skin'+(c.skins.length+1),name:'Nova pintura'});c.skins.push(n);ch();go('car')}})]));
  const tb=E.el('table');tb.append(E.el('tr',{},['','id','nome','cor do ponto','css do botão','imagem',''].map(t=>E.el('th',{text:t}))));
  c.skins.forEach((s,i)=>{const im=E.el('img',{class:'sk'});if(s.file&&s.file.$file)E.api.blobUrl(s.file.$file).then(u=>im.src=u).catch(()=>{});
    const dot=E.el('input',{type:'color',value:/^#[0-9a-f]{6}$/i.test(s.dot)?s.dot:'#888888'});dot.onchange=()=>{s.dot=dot.value;ch()};
    const fi=E.el('input',{type:'file',accept:'image/*',hidden:''});fi.onchange=E.guard(async()=>{const f=fi.files[0];if(!f)return;const ext=(f.name.split('.').pop()||'jpg').toLowerCase(),np='cars/'+curCar+'/skin_'+s.id+'.'+ext;await E.api.save(np,await f.arrayBuffer());s.file={$file:np};ch();go('car')});
    tb.append(E.el('tr',{},[E.el('td',{},im),E.el('td',{},txtIn(s.id,v=>{s.id=v;ch()})),E.el('td',{},txtIn(s.name,v=>{s.name=v;ch()})),E.el('td',{},dot),E.el('td',{},txtIn(s.css||'',v=>{s.css=v;ch()})),
      E.el('td',{},[E.el('small',{text:(s.file&&s.file.$file||'').split('/').pop()+' '}),E.el('button',{text:'trocar…',onclick:()=>fi.click()}),fi]),
      E.el('td',{},E.el('button',{text:'✕',title:'Remover',onclick:()=>{if(c.skins.length<2)return E.toast('Precisa de pelo menos 1 pintura',true);c.skins.splice(i,1);ch();go('car')}}))]))});
  sk.append(tb);sk.append(E.el('div',{class:'hint',text:'A imagem da pintura também pode ser pintada na aba Texturas (cars/'+curCar+'/skin_*.jpg).'}));
  const sh=E.el('div',{class:'box'});body.append(sh);const sd=c.shadow||[1.25,2.9,-.64];
  sh.append(E.el('div',{class:'hd'},[E.el('b',{text:'Sombra no chão (largura, comprimento, deslocamento z)'})]));
  sh.append(E.el('div',{class:'grid2'},[0,1,2].map(i=>fld(['Meia largura','Meio comprimento','Deslocamento z'][i],numIn(sd[i],v=>{c.shadow=sd;sd[i]=v;ch()})))))}
async function newCar(idx){const src=curCar,id=(E.ask('ID do novo carro (letras minúsculas/números):',src+'2')||'').toLowerCase();if(!id)return;if(!/^[a-z0-9_]+$/.test(id))throw new Error('ID inválido');if(idx.cars.includes(id))throw new Error('ID já existe');
  const files=E.tree.filter(f=>f.p.startsWith('cars/'+src+'/')&&!f.p.includes('/_slrr/'));
  for(const f of files){const np='cars/'+id+'/'+f.p.slice(('cars/'+src+'/').length);let u=await E.api.u8(f.p);
    if(f.p.endsWith('/car.json')){const j=JSON.parse(new TextDecoder().decode(u).split('cars/'+src+'/').join('cars/'+id+'/'));j.id=id;j.name=(j.name||src)+' (cópia)';j.short=(j.short||src)+' 2';u=JSON.stringify(j)}
    await E.api.save(np,u)}
  idx.cars.push(id);await E.jsonSave('cars/cars.json',idx);docs['cars/cars.json']=idx;docs['cars/'+id+'/car.json']=undefined;curCar=id;E.toast('Carro '+id+' criado (arquivos copiados e já salvos)');await go('car')}
async function delCar(idx){if(idx.cars.length<2)throw new Error('O jogo precisa de pelo menos 1 carro');if(!confirm('Excluir o carro “'+curCar+'” e todos os arquivos de cars/'+curCar+'/ ?'))return;
  for(const f of E.tree.filter(f=>f.p.startsWith('cars/'+curCar+'/')))await E.api.del(f.p);
  idx.cars=idx.cars.filter(x=>x!==curCar);if(idx.default===curCar)idx.default=idx.cars[0];await E.jsonSave('cars/cars.json',idx);delete docs['cars/'+curCar+'/car.json'];mod.delete('cars/'+curCar+'/car.json');curCar=idx.default;await go('car')}

/* ================= SOM ================= */
async function secSnd(){const body=$('#cf-body'),p='data/snd.json',d=await J(p),ch=()=>touch(p),cfg=d.cfg;
  const names=Object.keys(d.files).sort();
  const miss=E.tree.filter(f=>/^assets\/sounds\/.*\.wav$/i.test(f.p)&&!d.files[f.p.split('/').pop()]);
  if(miss.length){const b=E.el('div',{class:'box'},[E.el('b',{text:miss.length+' som(ns) em assets/sounds não registrados em snd.json: '+miss.map(f=>f.p.split('/').pop()).join(', ')}),
    E.el('button',{text:'Registrar todos',onclick:()=>{miss.forEach(f=>d.files[f.p.split('/').pop()]={$file:f.p});ch();go('snd')}})]);body.append(b)}
  body.append(E.el('div',{class:'hint',text:'Cada camada toca em loop; o volume e o tom (pitch) mudam conforme a curva. No motor o eixo X é rpm; nos pneus é a velocidade/derrapagem. “base” é a rpm em que o arquivo foi gravado (tom 1,0).'}));
  const layer=(title,L,arr,i)=>{const box=E.el('div',{class:'box'});
    box.append(E.el('div',{class:'hd'},[E.el('b',{text:title}),arr?E.el('button',{text:'✕ remover',onclick:()=>{if(arr.length>1){arr.splice(i,1);ch();go('snd')}}}):null]));
    box.append(E.el('div',{class:'grid2'},[fld('Arquivo',sel(names,L.f,v=>{L.f=v;ch()})),fld('Base (rpm de referência)',numIn(L.base,v=>{L.base=v;ch()}))]));
    const row=E.el('div',{class:'grid2'});box.append(row);
    for(const[k,nm]of[['vol','Volume'],['pit','Tom (pitch)']]){if(!L[k])continue;const h=E.el('div',{},[E.el('span',{class:'muted',text:nm})]);row.append(h);E.curve(h,{pts:L[k],h:130,xdec:0,onchange:pts=>{L[k]=pts;ch()}})}
    body.append(box)};
  body.append(E.el('h3',{text:'Motor — acelerando (on)'}));cfg.on.forEach((L,i)=>layer('on #'+i+' · '+L.f,L,cfg.on,i));
  body.append(E.el('button',{text:'＋ camada on',onclick:()=>{cfg.on.push(JSON.parse(JSON.stringify(cfg.on[cfg.on.length-1])));ch();go('snd')}}));
  body.append(E.el('h3',{text:'Motor — aliviando (off)'}));cfg.off.forEach((L,i)=>layer('off #'+i+' · '+L.f,L,cfg.off,i));
  body.append(E.el('button',{text:'＋ camada off',onclick:()=>{cfg.off.push(JSON.parse(JSON.stringify(cfg.off[cfg.off.length-1])));ch();go('snd')}}));
  body.append(E.el('h3',{text:'Pneus'}));const TN={grass:'Grama',gravel:'Cascalho',rumble:'Zebra',scrape:'Raspando na parede',kskid:'Derrapagem (zebra/grama)',askid:'Derrapagem (asfalto)'};
  for(const k in cfg.tire)layer((TN[k]||k)+' ['+k+']',cfg.tire[k]);
  body.append(E.el('h3',{text:'Efeitos únicos'}));const one=E.el('div',{class:'box'}),og=E.el('div',{class:'grid2'});one.append(og);
  const ON={hit:'Batida',back:'Estouro do escapamento',aroll:'Rolagem no asfalto',ascrub:'Pneu esfregando (asfalto)'};
  for(const k in cfg.one)og.append(fld(ON[k]||k,sel(names,cfg.one[k],v=>{cfg.one[k]=v;ch()}),'['+k+']'));body.append(one);
  body.append(E.el('h3',{text:'Curvas globais (X de 0 a 1)'}));const GN={rollV:'Volume da rolagem × velocidade',rollG:'Rolagem (grama/cascalho)',scrubG:'Esfregar',skidG:'Derrapar',sv:'Sv'};
  const gb=E.el('div',{class:'box'}),gg=E.el('div',{class:'grid2'});gb.append(gg);
  for(const k in cfg.gph){const h=E.el('div',{},[E.el('span',{class:'muted',text:(GN[k]||k)+' ['+k+']'})]);gg.append(h);E.curve(h,{pts:cfg.gph[k],h:120,xmax:1,ymax:1,xdec:4,xfmt:v=>v.toFixed(2),onchange:pts=>{cfg.gph[k]=pts;ch()}})}body.append(gb)}

/* ================= CONSTANTES DO JOGO (js/game.js) ================= */
const TUN=[
  {k:'laps',g:'Corrida',l:'Voltas padrão',re:/let cfg=\{[^}]*?laps:(\d+)/,t:'int'},
  {k:'rivals',g:'Corrida',l:'Rivais padrão (0 = treino)',re:/let cfg=\{[^}]*?rivals:(\d+)/,t:'int'},
  {k:'level',g:'Corrida',l:'Dificuldade padrão (0 fácil, 1 normal, 2 difícil)',re:/let cfg=\{[^}]*?level:(\d+)/,t:'int'},
  {k:'base',g:'Corrida',l:'Habilidade da IA por dificuldade (fácil, normal, difícil)',re:/const base=\[([^\]]*)\]\[cfg\.level\]/,t:'nums'},
  {k:'names',g:'Corrida',l:'Nomes dos rivais',re:/const NAMES=\[([^\]]*)\]/,t:'strs'},
  {k:'MU',g:'Física',l:'Aderência por piso (asfalto, zebra, cascalho, grama)',re:/const MU=\[([^\]]*)\]/,t:'nums'},
  {k:'CRR',g:'Física',l:'Resistência ao rolamento (asfalto, zebra, cascalho, grama)',re:/CRR=\[([^\]]*)\]/,t:'nums'},
  {k:'grav',g:'Física',l:'Gravidade (m/s²)',re:/g=(9\.81)/,t:'num'},
  {k:'down',g:'Física',l:'Downforce (coeficiente × v²)',re:/down=([\d.]+)\*sp\*sp/,t:'num'},
  {k:'maxdent',g:'Dano',l:'Máx. de amassados visíveis',re:/const MAXDENT=(\d+)/,t:'int'},
  {k:'dentmax',g:'Dano',l:'Profundidade máx. do amassado',re:/DENT_MAX=([\d.]+)/,t:'num'},
  {k:'gain',g:'Áudio',l:'Ganho geral do som',re:/let GAIN=([\d.]+)/,t:'num'}];
async function loadTun(){if(tun)return tun;const txt=await E.api.text('js/game.js');tun={txt,v:{}};
  for(const d of TUN){const m=new RegExp(d.re.source,'d').exec(txt);if(!m){d.miss=true;continue}d.miss=false;d.idx=m.indices[1];d.raw=m[1];d.v=d.t==='nums'?m[1].split(',').map(Number):d.t==='strs'?[...m[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map(x=>x[1]??x[2]):Number(m[1]);d.cur=JSON.parse(JSON.stringify(d.v))}
  return tun}
async function saveTun(){const edits=TUN.filter(d=>!d.miss&&JSON.stringify(d.cur)!==JSON.stringify(d.v)).sort((a,b)=>b.idx[0]-a.idx[0]);let t=tun.txt;
  for(const d of edits){const s=d.t==='nums'?d.cur.join(','):d.t==='strs'?d.cur.map(x=>"'"+x.replace(/'/g,"\\'")+"'").join(','):String(d.cur);t=t.slice(0,d.idx[0])+s+t.slice(d.idx[1])}
  await E.api.save('js/game.js',t);tun=null;await loadTun()}
async function secGame(){const body=$('#cf-body');await loadTun();let g='';
  body.append(E.el('div',{class:'hint',text:'Estes valores ficam dentro de js/game.js e são editados no lugar (o resto do arquivo não muda). Para mexer em qualquer outra coisa use a aba Código.'}));
  let grid=null;
  for(const d of TUN){if(d.g!==g){g=d.g;body.append(E.el('h3',{text:g}));grid=E.el('div',{class:'grid2'});body.append(grid)}
    if(d.miss){grid.append(fld(d.l,E.el('span',{class:'muted',text:'não encontrado no código (foi alterado?)'})));continue}
    const ch=()=>{touch('js/game.js')};
    if(d.t==='nums')grid.append(fld(d.l,txtIn(d.cur.join(', '),v=>{const a=v.split(/[ ,;]+/).filter(Boolean).map(Number);if(a.length===d.v.length&&a.every(isFinite)){d.cur=a;ch()}else E.toast('Informe '+d.v.length+' números',true)})));
    else if(d.t==='strs')grid.append(fld(d.l,txtIn(d.cur.join(', '),v=>{const a=v.split(',').map(x=>x.trim()).filter(Boolean);if(a.length){d.cur=a;ch()}})));
    else grid.append(fld(d.l,numIn(d.cur,v=>{d.cur=d.t==='int'?Math.round(v):v;ch()})))}}

/* ================= TROFÉUS ================= */
async function secTro(){const body=$('#cf-body'),p='data/trophy.json',t=await J(p),ch=()=>touch(p);
  const hx=a=>'#'+a.map(v=>Math.round(E.clamp(v,0,1)*255).toString(16).padStart(2,'0')).join(''),rg=h=>[1,3,5].map(i=>E.fix(parseInt(h.slice(i,i+2),16)/255,4));
  body.append(E.el('h3',{text:'Cores dos metais'}));const g=E.el('div',{class:'grid2'});body.append(g);
  for(const[k,n]of[['gold','Ouro'],['silver','Prata'],['bronze','Bronze']]){const i=E.el('input',{type:'color',value:hx(t.tint[k])});i.oninput=()=>{t.tint[k]=rg(i.value);ch()};g.append(fld(n,i))}
  g.append(fld('Brilho do material escuro (dark)',numIn(t.dark,v=>{t.dark=v;ch()})));
  body.append(E.el('h3',{text:'Alturas (câmera/escala)'}));const h=E.el('div',{class:'grid2'});body.append(h);
  h.append(fld('Taça — meia altura (cup.hh)',numIn(t.cup.hh,v=>{t.cup.hh=v;ch()})),fld('Caixa — meia altura (box.hh)',numIn(t.box.hh,v=>{t.box.hh=v;ch()})));
  body.append(E.el('div',{class:'hint',text:'As malhas ficam em Modelos 3D → Troféu; a madeira em assets/trophy/wood.jpg (aba Texturas).'}))}

/* ================= PISTA / AMBIENTE ================= */
/* ================= CLIMA / NÉVOA (data/fog.json + data/timecyc.json) ================= */
const toHex=c=>'#'+c.map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
const fromHex=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
let fogW=null;
async function secFog(){const body=$('#cf-body'),pf='data/fog.json',pt='data/timecyc.json';let f,t;
  try{f=await J(pf);t=await J(pt)}catch(e){body.append(E.el('div',{class:'hint',text:'Faltam data/fog.json ou data/timecyc.json. Rode: python3 tools/build_timecyc.py'}));return}
  const names=t.order.filter(n=>!/^(UNDERWATER|EXTRACOLOURS)/.test(n)),all=['classic',...names],ch=()=>touch(pf),ct=()=>touch(pt);
  body.append(E.el('h3',{text:'Padrão do jogo'}));const a=E.el('div',{class:'grid2'});body.append(a);
  a.append(fld('Clima inicial',sel(all,f.weather,v=>{f.weather=v;ch()}),'“classic” = névoa fixa antiga'));
  a.append(fld('Hora inicial (0–24)',numIn(f.hour,v=>{f.hour=Math.max(0,Math.min(24,v));ch()}),'interpola entre 0h 5h 6h 7h 12h 19h 20h 22h'));
  a.append(fld('Densidade',numIn(f.density,v=>{f.density=Math.max(.1,v);ch()}),'1 = valores do timecyc · 2 = metade da distância'));
  body.append(E.el('div',{class:'hint',text:'O jogador escolhe clima e hora no menu (fica salvo no navegador); abrir o jogo com ?clima=FOGGY_SF&hora=12 força um clima. Céu e iluminação continuam os do dia — só a névoa e o horizonte seguem o timecyc.'}));
  body.append(E.el('h3',{text:'Botões do menu'}));const bx=E.el('div',{class:'box'});body.append(bx);
  const tb=E.el('table');tb.append(E.el('tr',{},['Rótulo','Clima',''].map(x=>E.el('th',{text:x}))));
  f.presets.forEach((p,i)=>tb.append(E.el('tr',{},[E.el('td',{},txtIn(p[0],v=>{p[0]=v;ch()})),E.el('td',{},sel(all,p[1],v=>{p[1]=v;ch()})),E.el('td',{},E.el('button',{text:'✕',onclick:()=>{f.presets.splice(i,1);ch();go('fog')}}))])));
  bx.append(tb);bx.append(E.el('div',{class:'rowf'},[E.el('button',{text:'＋ Botão',onclick:()=>{f.presets.push(['Novo','CLOUDY_LA']);ch();go('fog')}}),
    fld('Horas do menu (rótulo=hora, separado por vírgula)',txtIn(f.hours.map(h=>h[0]+'='+h[1]).join(', '),v=>{const o=v.split(',').map(x=>x.split('=')).filter(x=>x.length===2&&isFinite(+x[1])).map(x=>[x[0].trim(),+x[1]]);if(o.length){f.hours=o;ch()}else E.toast('Use: Dia=12, Entardecer=19',true)}))]));
  body.append(E.el('h3',{text:'Valores do timecyc'}));
  if(!fogW||!t.weathers[fogW])fogW=names.includes(f.weather)?f.weather:names[0];
  body.append(E.el('div',{class:'rowf'},[sel(names,fogW,v=>{fogW=v;go('fog')}),E.el('span',{class:'muted',text:'Distâncias em metros. Início negativo = névoa já em cima do carro. Cor = horizonte/névoa.'})]));
  const W=t.weathers[fogW],tab=E.el('table');tab.append(E.el('tr',{},['Hora','Início da névoa','Névoa 100% em','Cor da névoa'].map(x=>E.el('th',{text:x}))));
  t.hours.forEach((h,i)=>{const c=E.el('input',{type:'color',value:toHex(W.skyBot[i])});c.onchange=()=>{W.skyBot[i]=fromHex(c.value);ct()};
    tab.append(E.el('tr',{},[E.el('td',{text:h+'h'}),E.el('td',{},numIn(W.fogSt[i],v=>{W.fogSt[i]=Math.round(v);ct()})),E.el('td',{},numIn(W.farClp[i],v=>{W.farClp[i]=Math.max(10,Math.round(v));ct()})),E.el('td',{},c)]))});
  body.append(E.el('div',{class:'box'},tab));
  body.append(E.el('div',{class:'hint',text:'Fonte original: tools/timecyc/timecycp.dat (python3 tools/build_timecyc.py regenera data/timecyc.json e apaga edições feitas aqui).'}))}
/* ================= TORCIDA (data/torcida.json + data/peds.json + data/pedgrp.json) ================= */
async function secCrowd(){const body=$('#cf-body'),pt='data/torcida.json',pp='data/peds.json';let T,P,G=null;
  try{T=await J(pt);P=await J(pp)}catch(e){body.append(E.el('div',{class:'hint',text:'Faltam data/torcida.json ou data/peds.json.'}));return}
  try{G=await J('data/pedgrp.json')}catch(e){}
  const types=P.types.map(t=>t.name),ch=()=>touch(pt),cp=()=>touch(pp);T.mix=T.mix||{};types.forEach(n=>{if(T.mix[n]===undefined)T.mix[n]=1});
  body.append(E.el('h3',{text:'Mistura de pedestres'}));
  const info=E.el('div',{class:'hint'}),bx=E.el('div',{class:'box'});body.append(bx);
  const inGroups=n=>G?[...new Set(G.groups.filter(g=>g.models.includes(n)).map(g=>g.name.toLowerCase()))].join(', '):'';
  const upd=()=>{const tot=types.reduce((a,n)=>a+Math.max(0,T.mix[n]||0),0);info.textContent=tot>0?types.filter(n=>T.mix[n]>0).map(n=>n+' '+Math.round(T.mix[n]/tot*100)+'%').join(' · '):'Todos os pesos são 0: o jogo usa a distribuição original.';
    rows.forEach(([n,sp])=>sp.textContent=tot>0?Math.round(Math.max(0,T.mix[n]||0)/tot*100)+'%':'—')};
  const rows=[],tb=E.el('table');tb.append(E.el('tr',{},['Tipo','Gênero','Peso','Parte da torcida','Grupo(s) do pedgrp.dat'].map(x=>E.el('th',{text:x}))));
  P.types.forEach(t=>{const n=t.name,r=E.el('input',{type:'range',min:0,max:10,step:1,value:T.mix[n]}),num=E.el('span',{class:'pill',text:T.mix[n]});r.oninput=()=>{T.mix[n]=+r.value;num.textContent=r.value;ch();upd()};
    const sp=E.el('span');rows.push([n,sp]);tb.append(E.el('tr',{},[E.el('td',{text:n}),E.el('td',{text:t.female?'feminino':'masculino'}),E.el('td',{},E.el('div',{class:'rowf'},[r,num])),E.el('td',{},sp),E.el('td',{},E.el('small',{text:inGroups(n)||'—'}))]))});
  bx.append(tb);bx.append(info);
  const pr=E.el('div',{class:'rowf'});for(const k of Object.keys(T.presets||{}))pr.append(E.el('button',{text:k,onclick:()=>{T.mix=Object.assign({},T.presets[k]);types.forEach(n=>{if(T.mix[n]===undefined)T.mix[n]=0});ch();go('crowd')}}));
  bx.append(E.el('div',{class:'hint',text:'Atalhos de mistura:'}));bx.append(pr);upd();
  body.append(E.el('div',{class:'hint',text:'Peso 0 = esse tipo não aparece. O sorteio é fixo (cada espectador sempre recebe o mesmo tipo). Vale após recarregar o jogo. Só existem os 9 modelos acima: para outros pedestres do GTA SA converta mais modelos com tools/build_peds.py.'}));
  body.append(E.el('h3',{text:'Desempenho e tamanho'}));const g=E.el('div',{class:'grid2'});body.append(g);
  g.append(fld('Distância de desenho (m, 0 = sem torcida 3D)',numIn(P.near,v=>{P.near=Math.max(0,v);cp()}),'[near]'));
  g.append(fld('Máximo de pedestres desenhados por tipo',numIn(P.cap,v=>{P.cap=Math.max(10,Math.round(v));cp()}),'[cap]'));
  g.append(fld('Escala dos pedestres',numIn(P.scale,v=>{P.scale=Math.max(.3,v);cp()}),'[scale]'));
  if(G){body.append(E.el('h3',{text:'Grupos do pedgrp.dat (referência)'}));const have=new Set(types),sg=E.el('select');E.fillSelect(sg,G.groups.map((x,i)=>[i,x.name+' ('+x.region+')']),0);
    const out=E.el('div',{class:'hint'}),show=()=>{const x=G.groups[+sg.value];out.innerHTML='';x.models.forEach(m=>out.append(E.el('span',{class:'pill',text:m+(have.has(m)?' ✓ no jogo':' · sem modelo'),style:'margin:2px 4px 2px 0;display:inline-block'+(have.has(m)?';color:var(--ok)':'')})))};
    sg.onchange=show;body.append(E.el('div',{class:'rowf'},[sg]));body.append(out);show();
    body.append(E.el('div',{class:'hint',text:G.groups.length+' grupos lidos de tools/pedgrp/pedgrp.dat (python3 tools/build_pedgrp.py regenera data/pedgrp.json). Só bfori e bfost existem como modelos no jogo.'}))}}
async function secTrk(){const body=$('#cf-body'),p='data/ext.json',x=await J(p),ch=()=>touch(p);
  const skies=E.tree.filter(f=>/\.(jpe?g|png|webp)$/i.test(f.p)&&/^assets\/track\/[^/]+$/.test(f.p)).map(f=>f.p);
  body.append(E.el('h3',{text:'Ambiente'}));const a=E.el('div',{class:'grid2'});body.append(a);
  a.append(fld('Imagem do céu',sel(skies,x.sky.$file,v=>{x.sky={$file:v};ch()}),'equiretangular'));
  body.append(E.el('h3',{text:'Telão (jumbotron)'}));const j=E.el('div',{class:'grid2'});body.append(j);
  for(const k of['cols','fw','n','fps'])j.append(fld({cols:'Colunas do atlas',fw:'Largura do quadro (px)',n:'Nº de quadros',fps:'Quadros por segundo'}[k]+' ['+k+']',numIn(x.jumbo[k],v=>{x.jumbo[k]=Math.round(v);ch()})));
  body.append(E.el('h3',{text:'Resumo'}));
  let L=0;for(let i=0;i<x.ai.length;i++){const p0=x.ai[i],q=x.ai[(i+1)%x.ai.length];L+=Math.hypot(q[0]-p0[0],q[2]-p0[2])}
  body.append(E.el('div',{class:'hint',text:'Traçado da IA: '+x.ai.length+' pontos, volta ≈ '+L.toFixed(0)+' m (edite na aba Traçado). Colisão: '+x.phy.nt+' triângulos, '+x.phy.nv+' vértices (aba Colisão). Público: '+x.crowd.n+' pessoas.'}))}
})();
