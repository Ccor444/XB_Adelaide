/* Aba Arquivos: explorador do projeto, prévia, substituir/renomear/excluir, zip, verificação. */
(function(){
const $=E.$;let sel=null,curDir='',open=new Set(['assets','cars','data','js','css']);
const EXT=p=>(p.split('.').pop()||'').toLowerCase();
const kindOf=p=>/\.(webp|jpe?g|png|gif|dds|svg)$/i.test(p)?'img':/\.(wav|mp3|ogg)$/i.test(p)?'snd':/\.bin$/i.test(p)?'bin':/\.(json|js|css|html?|txt|md|py|bat|sh|msh|gph)$/i.test(p)||/\.txt\.enc$/.test(p)?'txt':'oth';
E.kindOf=kindOf;

E.init_files=async function(){
  $('#fl-q').oninput=$('#fl-filter').onchange=E.debounce(render,120);
  E.on('fl-open','click',E.guard(openIn));E.on('fl-dl','click',E.guard(async()=>{if(!sel)return;E.download(sel.split('/').pop(),await E.api.u8(sel))}));
  E.on('fl-rep','click',()=>sel&&$('#fl-repf').click());
  $('#fl-repf').onchange=E.guard(async e=>{const f=e.target.files[0];e.target.value='';if(!f||!sel)return;await E.api.save(sel,await f.arrayBuffer());E.toast('Substituído: '+sel);await select(sel);render()});
  E.on('fl-ren','click',E.guard(async()=>{if(!sel)return;const n=E.ask('Novo caminho (relativo à raiz do projeto):',sel);if(!n||n===sel)return;
    if(!confirm('Atenção: os JSON/código que apontam para “'+sel+'” NÃO são atualizados automaticamente. Continuar?'))return;
    await E.api.rename(sel,n);sel=n;await select(n);render();E.toast('Movido')}));
  E.on('fl-dup','click',E.guard(async()=>{if(!sel)return;const i=sel.lastIndexOf('.'),def=i>0?sel.slice(0,i)+'_copia'+sel.slice(i):sel+'_copia';const n=E.ask('Salvar cópia como:',def);if(!n)return;
    if(E.treeMap[n]&&!confirm('Já existe. Sobrescrever?'))return;await E.api.save(n,await E.api.u8(sel));await select(n);render();E.toast('Copiado')}));
  E.on('fl-del','click',E.guard(async()=>{if(!sel)return;if(!confirm('Excluir “'+sel+'”? '+(E.fs.nativeBackup||E.fs.putBackup?'(fica uma cópia em _backup)':''))) return;
    await E.api.del(sel);sel=null;$('#fl-prev').innerHTML='';$('#fl-title').textContent='Selecione um arquivo';render();E.toast('Excluído')}));
  E.on('fl-up','click',()=>$('#fl-upf').click());
  $('#fl-upf').onchange=E.guard(async e=>{const fs=[...e.target.files];e.target.value='';let n=0;
    for(const f of fs){const p=(curDir?curDir+'/':'')+f.name;if(E.treeMap[p]&&!confirm('Sobrescrever '+p+'?'))continue;await E.api.save(p,await f.arrayBuffer());n++}
    E.toast(n+' arquivo(s) enviados para /'+curDir);render()});
  E.on('fl-new','click',E.guard(async()=>{const n=E.ask('Nome do novo arquivo (em /'+curDir+'):','novo.txt');if(!n)return;const p=(curDir?curDir+'/':'')+n;await E.api.save(p,'');await select(p);render()}));
  E.on('fl-zip','click',E.guard(()=>E.$('#btn-export').click()));
  E.on('fl-zipc','click',E.guard(async()=>{if(!E.changed.size)return E.toast('Nada foi alterado nesta sessão');
    const b=await E.api.exportZip(true);E.download('XB_alterados_'+E.stamp()+'.zip',b);E.toast(E.changed.size+' arquivo(s) no zip — extraia por cima da pasta do jogo')}));
  E.on('fl-merge','click',()=>$('#fl-mergef').click());
  $('#fl-mergef').onchange=E.guard(async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;const ents=await XZip.read(await f.arrayBuffer());
    if(!confirm('Importar '+ents.length+' arquivos de “'+f.name+'” por cima do projeto (sobrescreve os de mesmo nome)?'))return;
    let n=0;for(const en of ents){if(/(^|\/)(_backup|\.git)\//.test(en.name))continue;await E.api.save(en.name,await en.read());n++}E.toast(n+' arquivos importados');render()});
  E.on('fl-check','click',E.guard(check));
  $('#fl-vers').onfocus=E.guard(async()=>{if(!sel)return;const v=await E.api.backups(sel),s=$('#fl-vers');s.innerHTML='<option value="">Versões anteriores…</option>';
    v.forEach(t=>s.append(E.el('option',{value:t,text:fmtTs(t)})))});
  E.on('fl-rest','click',E.guard(async()=>{const ts=$('#fl-vers').value;if(!ts||!sel)return;await E.api.restore(sel,ts);await select(sel);render();E.toast('Versão restaurada')}));
  E.sub('saved',E.debounce(()=>{if(E.cur==='files')render()},300));
  render();
};
E.show_files=()=>{if(E.tabInit.files)render()};
const fmtTs=t=>t.replace(/^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d).*/,'$3/$2/$1 $4:$5:$6');

function match(f){const q=$('#fl-q').value.toLowerCase().trim(),t=$('#fl-filter').value;
  if(q&&!f.p.toLowerCase().includes(q))return false;
  if(t==='chg')return E.changed.has(f.p);if(t&&kindOf(f.p)!==t)return false;return true}
function render(){
  const box=$('#fl-tree');box.innerHTML='';const files=E.tree.filter(match),flat=!!($('#fl-q').value.trim()||$('#fl-filter').value);
  $('#fl-info').textContent=E.tree.length+' arquivos · '+E.fmtKB(E.tree.reduce((a,f)=>a+f.s,0))+' · alterados nesta sessão: '+E.changed.size;
  if(flat){files.slice(0,500).forEach(f=>box.append(fileRow(f,f.p)));if(files.length>500)box.append(E.el('div',{class:'hint',text:'… mais '+(files.length-500)+' (refine a busca)'}));return}
  const root={d:{},f:[]};for(const f of files){const parts=f.p.split('/');let n=root;for(let i=0;i<parts.length-1;i++)n=n.d[parts[i]]=n.d[parts[i]]||{d:{},f:[]};n.f.push(f)}
  const count=n=>n.f.length+Object.values(n.d).reduce((a,x)=>a+count(x),0);
  const draw=(n,pre,host)=>{for(const k of Object.keys(n.d).sort()){const path=pre?pre+'/'+k:k,isOpen=open.has(path),c=count(n.d[k]);
      const d=E.el('div',{class:'d'},[E.el('span',{text:(isOpen?'▾ ':'▸ ')+k}),E.el('small',{text:c})]);
      d.onclick=()=>{curDir=path;$('#fl-dir').textContent='/'+path;if(open.has(path))open.delete(path);else open.add(path);render()};host.append(d);
      if(isOpen){const kids=E.el('div',{class:'kids'});draw(n.d[k],path,kids);host.append(kids)}}
    for(const f of n.f.sort((a,b)=>a.p<b.p?-1:1))host.append(fileRow(f,f.p.split('/').pop()))};
  draw(root,'',box)}
function fileRow(f,label){const r=E.el('div',{class:'f'+(f.p===sel?' on':'')+(E.changed.has(f.p)?' chg':''),title:f.p},[E.el('span',{text:label}),E.el('small',{text:E.fmtKB(f.s)})]);r.onclick=E.guard(()=>select(f.p));return r}

async function select(p){
  sel=p;curDir=p.includes('/')?p.slice(0,p.lastIndexOf('/')):'';$('#fl-dir').textContent='/'+curDir;
  E.$$('#fl-tree .f').forEach(r=>r.classList.toggle('on',r.title===p));
  const pv=$('#fl-prev');pv.innerHTML='';const k=kindOf(p),t=E.treeMap[p];$('#fl-title').textContent=p;$('#fl-meta').textContent=t?E.fmtKB(t.s)+(E.changed.has(p)?' · alterado':''):'';
  $('#fl-vers').innerHTML='<option value="">Versões anteriores…</option>';
  if(!t){pv.textContent='arquivo não existe mais';return}
  if(k==='img'){const u=await E.api.blobUrl(p),im=E.el('img',{src:u});im.onload=()=>{$('#fl-meta').textContent=im.naturalWidth+'×'+im.naturalHeight+' · '+E.fmtKB(t.s)};pv.append(im)}
  else if(k==='snd'){pv.append(E.el('audio',{controls:'',src:await E.api.blobUrl(p)}))}
  else if(k==='txt'){const u=await E.api.u8(p),s=new TextDecoder().decode(u.subarray(0,60000));pv.append(E.el('pre',{text:s+(u.length>60000?'\n… (truncado)':'')}))}
  else{const u=await E.api.u8(p),n=Math.min(u.length,640);let s='';for(let i=0;i<n;i+=16){let h='',a='';for(let j=0;j<16&&i+j<n;j++){const v=u[i+j];h+=v.toString(16).padStart(2,'0')+' ';a+=v>31&&v<127?String.fromCharCode(v):'.'}s+=i.toString(16).padStart(6,'0')+'  '+h.padEnd(48)+a+'\n'}
    pv.append(E.el('pre',{text:s+(u.length>n?'…':'')}))}
}
E.files_select=async p=>{E.show('files');await E.tabReady('files');
  const parts=p.split('/');let acc='';for(let i=0;i<parts.length-1;i++){acc+=(acc?'/':'')+parts[i];open.add(acc)}render();await select(p)};
async function openIn(){if(!sel)return;const k=kindOf(sel);
  if(/^assets\/track\/phy\./.test(sel))return E.show('coll');
  if(k==='img'){E.show('tex');await E.tabReady('tex');return E.open_tex&&E.open_tex(sel)}
  if(k==='snd'){E.show('snd');await E.tabReady('snd');return E.open_snd&&E.open_snd(sel)}
  if(k==='txt'){E.show('code');await E.tabReady('code');return E.open_code&&E.open_code(sel)}
  if(k==='bin'){E.show('mdl');return}
  E.toast('Sem editor específico para este tipo — use Baixar/Substituir')}

/* ---------------- verificação do projeto ---------------- */
async function check(){
  const rep=$('#fl-report');rep.innerHTML='';const add=(c,t)=>rep.append(E.el('div',{class:c,text:t}));add('','Verificando…');
  const errs=[],warn=[];const refs=new Set();
  const walk=(o,src)=>{if(Array.isArray(o))o.forEach(v=>walk(v,src));else if(o&&typeof o==='object'){if(typeof o.$file==='string'){refs.add(o.$file);if(!E.treeMap[o.$file])errs.push(src+' → arquivo ausente: '+o.$file)}else for(const k in o)walk(o[k],src)}};
  const jsons=E.tree.filter(f=>/^(data\/[^/]+|cars\/[^/]+\/car|cars\/cars)\.json$/.test(f.p)),J={};
  for(const f of jsons){try{J[f.p]=await E.api.json(f.p);walk(J[f.p],f.p)}catch(e){errs.push(f.p+' → JSON inválido: '+e.message)}}
  try{const t=J['data/trk.json'];if(t){const vb=await E.api.u8(t.vb.$file),ib=await E.api.u8(t.ib.$file),nv=vb.length/28,ni=ib.length/2;
      if(vb.length%28)errs.push('track.vb.bin: tamanho não é múltiplo de 28');if(nv>65535)errs.push('pista: '+nv+' vértices (máx. 65535)');
      const I=new Uint16Array(ib.buffer,ib.byteOffset,ni);let mx=0;for(let i=0;i<ni;i++)if(I[i]>mx)mx=I[i];if(mx>=nv)errs.push('pista: índice '+mx+' fora dos vértices ('+nv+')');
      t.groups.forEach((g,i)=>{if(g.off+g.cnt>ni)errs.push('pista: grupo '+i+' passa do fim dos índices');if(g.tex<0||g.tex>=t.texnames.length)errs.push('pista: grupo '+i+' usa textura inexistente '+g.tex)});
      let nBad=0;for(let i=0;i<t.tex.length;i++){const f=t.tex[i].d&&t.tex[i].d.$file;if(!f||!E.treeMap[f])continue;try{const bm=await createImageBitmap(new Blob([await E.api.u8(f)],{type:E.mime(f)}));if(bm.width!==t.tex[i].w||bm.height!==t.tex[i].h)nBad++}catch(e){errs.push(f+' → imagem ilegível')}}
      if(nBad)warn.push(nBad+' textura(s) da pista com w/h diferentes do trk.json (o jogo usa o tamanho do arquivo; ajuste ao salvar pela aba Texturas)')}}catch(e){errs.push('pista: '+e.message)}
  for(const id of(J['cars/cars.json']||{cars:[]}).cars){const c=J['cars/'+id+'/car.json'];if(!c){errs.push('cars/'+id+'/car.json ausente');continue}
    try{const vb=await E.api.u8(c.vb.$file),ib=await E.api.u8(c.ib.$file),nv=vb.length/24,ni=ib.length/2;
      c.objs.forEach(o=>{if(o.start+o.count>ni)errs.push(id+': peça '+o.name+' passa do fim dos índices');if(o.fv+o.nv>nv)warn.push(id+': peça '+o.name+' fv+nv além dos vértices')});
      const pts=c.torque.pts;for(let i=1;i<pts.length;i++)if(pts[i][0]<=pts[i-1][0]){errs.push(id+': curva de torque fora de ordem');break}
      if(!c.skins||!c.skins.length)errs.push(id+': sem pinturas (skins)')}catch(e){errs.push(id+': '+e.message)}}
  const sn=J['data/snd.json'];if(sn){const names=new Set(Object.keys(sn.files));const chk=n=>{if(n&&!names.has(n))errs.push('snd.json: som “'+n+'” não está em "files"')};
    sn.cfg.on.concat(sn.cfg.off).forEach(x=>chk(x.f));Object.values(sn.cfg.tire).forEach(x=>chk(x.f));Object.values(sn.cfg.one).forEach(chk)}
  const ex=J['data/ext.json'];if(ex){try{const v=await E.api.u8(ex.phy.v.$file),i=await E.api.u8(ex.phy.i.$file),f=await E.api.u8(ex.phy.f.$file);
      if(v.length/12!==ex.phy.nv)warn.push('colisão: nv do ext.json ('+ex.phy.nv+') ≠ arquivo ('+v.length/12+')');if(f.length!==ex.phy.nt||i.length/6!==ex.phy.nt)errs.push('colisão: nt do ext.json ('+ex.phy.nt+') não bate com os arquivos');
      if(ex.ai.length<8)errs.push('traçado da IA com menos de 8 pontos')}catch(e){errs.push('colisão: '+e.message)}}
  const unused=E.tree.filter(f=>/^(assets|cars)\//.test(f.p)&&!/\/_slrr\//.test(f.p)&&!/\.json$/.test(f.p)&&!refs.has(f.p));
  rep.innerHTML='';
  errs.slice(0,60).forEach(t=>add('e',t));warn.forEach(t=>add('w',t));
  if(unused.length)add('w',unused.length+' arquivo(s) em assets/ e cars/ não são citados por nenhum JSON: '+unused.slice(0,8).map(f=>f.p).join(', ')+(unused.length>8?'…':''));
  if(!errs.length)add('o','Sem erros estruturais. '+refs.size+' referências conferidas.');else add('e','Total: '+errs.length+' erro(s)');
}
})();
