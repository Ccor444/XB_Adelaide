/* Aba Código / Dados (editor de texto com números de linha, localizar/trocar, busca global, verificação) + aba Jogo (prévia). */
(function(){
const $=E.$;let cur=null;
const EDITABLE=/\.(json|js|css|html?|txt|md|bat|sh|py)$/i;
const LH=()=>parseFloat(getComputedStyle($('#cd-ta')).lineHeight)||19;
E.init_code=async function(){
  list();$('#cd-q').oninput=list;E.sub('saved',E.debounce(list,400));
  const ta=$('#cd-ta');
  ta.oninput=()=>{E.setDirty('arquivo',true);gut()};ta.onscroll=()=>{$('#cd-gut').scrollTop=ta.scrollTop};
  ta.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();E.guard(save)()}
    if((e.ctrlKey||e.metaKey)&&e.key==='f'){e.preventDefault();$('#cd-ff').focus()}
    if(e.key==='Tab'){e.preventDefault();ta.setRangeText('  ',ta.selectionStart,ta.selectionEnd,'end');E.setDirty('arquivo',true)}});
  E.on('cd-save','click',E.guard(save));E.on('cd-chk','click',()=>E.guard(async()=>check(true))());
  E.on('cd-fmt','click',()=>{try{ta.value=JSON.stringify(JSON.parse(ta.value),null,2);E.setDirty('arquivo',true);gut()}catch(e){E.toast('JSON inválido: '+e.message,true)}});
  E.on('cd-ver','click',E.guard(async()=>{if(!cur)return;const v=await E.api.backups(cur);if(!v.length)return E.toast('Sem versões anteriores');
    const s=E.el('select',{},[E.el('option',{value:'',text:'Escolha uma versão…'}),...v.map(t=>E.el('option',{value:t,text:t}))]);E.$('#cd-ver').after(s);
    s.onchange=E.guard(async()=>{if(s.value){await E.api.restore(cur,s.value);await open(cur,null,true);E.toast('Versão restaurada')}s.remove()})}));
  E.on('cd-fnext','click',()=>next(1));$('#cd-ff').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();next(e.shiftKey?-1:1)}};
  E.on('cd-frep','click',()=>replaceOne());E.on('cd-frall','click',()=>replaceAll());
  E.on('cd-goto','click',()=>{const n=parseInt(E.ask('Ir para a linha:','1'));if(n)goLine(n)});
  E.on('cd-fall','click',E.guard(findAll));E.on('cd-rall','click',E.guard(replaceGlobal));
  $('#cd-find').onkeydown=e=>{if(e.key==='Enter')E.guard(findAll)()};
};
E.open_code=(p,line)=>open(p,line);
function list(){const q=$('#cd-q').value.toLowerCase(),box=$('#cd-list');box.innerHTML='';
  E.tree.filter(f=>EDITABLE.test(f.p)&&!/^_backup\//.test(f.p)&&(!q||f.p.toLowerCase().includes(q))).forEach(f=>{
    const d=E.el('div',{class:'it'+(cur===f.p?' on':'')},[E.el('span',{text:f.p}),E.el('small',{text:E.fmtKB(f.s)})]);d.onclick=E.guard(()=>open(f.p));box.append(d)})}
function gut(){const n=$('#cd-ta').value.split('\n').length;$('#cd-gut').textContent=Array.from({length:n},(_,i)=>i+1).join('\n');$('#cd-msg').textContent=n+' linhas'}
async function open(p,line,force){if(!force&&E.dirty.arquivo&&cur!==p&&!confirm('Há alterações não salvas. Descartar?'))return;cur=p;
  const t=await E.api.text(p);$('#cd-ta').value=t;E.setDirty('arquivo',false);$('#cd-title').textContent=p;gut();list();if(line)goLine(line);else $('#cd-ta').scrollTop=0}
function goLine(n){const ta=$('#cd-ta'),L=ta.value.split('\n');n=Math.max(1,Math.min(L.length,n));let pos=0;for(let i=0;i<n-1;i++)pos+=L[i].length+1;ta.focus();ta.setSelectionRange(pos,pos+L[n-1].length);ta.scrollTop=Math.max(0,(n-4)*LH())}
function check(show){const t=$('#cd-ta').value;if(!cur)return true;let ok=true,msg='OK — sem erros de sintaxe';
  try{if(/\.json$/i.test(cur))JSON.parse(t);else if(/\.js$/i.test(cur))new Function(t)}catch(e){ok=false;msg=e.message;
    const m=/position (\d+)/.exec(e.message);if(m){const ln=t.slice(0,+m[1]).split('\n').length;msg+=' (linha '+ln+')';if(show)goLine(ln)}}
  if(show)E.toast(msg,!ok);return ok}
async function save(){if(!cur)return;if(!check(false)){if(!confirm('O arquivo tem erro de sintaxe ('+(/\.json$/i.test(cur)?'JSON':'JS')+'). Salvar mesmo assim? O jogo pode parar de carregar.'))return}
  await E.api.save(cur,$('#cd-ta').value);E.setDirty('arquivo',false);E.toast('Salvo: '+cur+(/\.js$/.test(cur)?' — recarregue o jogo':''))}
function mkRe(s,flags){const m=/^\/(.+)\/([gimsuy]*)$/.exec(s);try{return m?new RegExp(m[1],(m[2].replace('g','')+flags)):new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),flags)}catch(e){throw new Error('Expressão inválida: '+e.message)}}
function next(dir){const ta=$('#cd-ta'),s=$('#cd-ff').value;if(!s)return;const re=mkRe(s,'gi'),t=ta.value;let m,pos=dir>0?ta.selectionEnd:ta.selectionStart-1,hit=null;
  if(dir>0){re.lastIndex=pos;hit=re.exec(t);if(!hit){re.lastIndex=0;hit=re.exec(t)}}else{let last=null;re.lastIndex=0;while((m=re.exec(t))&&m.index<=pos){last=m;if(!m[0].length)re.lastIndex++}hit=last}
  if(!hit)return E.toast('Não encontrado');ta.focus();ta.setSelectionRange(hit.index,hit.index+hit[0].length);const ln=t.slice(0,hit.index).split('\n').length;ta.scrollTop=Math.max(0,(ln-4)*LH())}
function replaceOne(){const ta=$('#cd-ta'),s=$('#cd-ff').value,r=$('#cd-fr').value;if(!s)return;const re=mkRe(s,'i'),sel=ta.value.slice(ta.selectionStart,ta.selectionEnd);
  if(sel&&re.test(sel)){ta.setRangeText(sel.replace(re,r),ta.selectionStart,ta.selectionEnd,'end');E.setDirty('arquivo',true);gut()}next(1)}
function replaceAll(){const ta=$('#cd-ta'),s=$('#cd-ff').value;if(!s)return;const re=mkRe(s,'gi');let n=0;ta.value=ta.value.replace(re,()=>{n++;return $('#cd-fr').value});E.setDirty('arquivo',true);gut();E.toast(n+' troca(s)')}
async function scan(re,fn){const files=E.tree.filter(f=>EDITABLE.test(f.p)&&!/^_backup\//.test(f.p)&&f.s<3e6);for(const f of files){const t=await E.api.text(f.p);await fn(f.p,t)}}
async function findAll(){const s=$('#cd-find').value;if(!s)return;const re=mkRe(s,'i'),box=$('#cd-res');box.innerHTML='';let n=0;
  await scan(re,(p,t)=>{if(n>=200)return;const L=t.split('\n');for(let i=0;i<L.length&&n<200;i++)if(re.test(L[i])){n++;const d=E.el('div',{class:'it',title:p},[E.el('span',{text:p.split('/').pop()+':'+(i+1)+'  '+L[i].trim().slice(0,70)})]);d.onclick=E.guard(()=>open(p,i+1));box.append(d)}});
  if(!n)box.append(E.el('div',{class:'hint',text:'Nada encontrado'}));else if(n>=200)box.append(E.el('div',{class:'hint',text:'… mostrando só os 200 primeiros'}))}
async function replaceGlobal(){const s=$('#cd-find').value,r=$('#cd-repl').value;if(!s)return;const re=mkRe(s,'gi'),hits=[];
  await scan(re,(p,t)=>{re.lastIndex=0;const c=(t.match(re)||[]).length;if(c)hits.push([p,c])});
  if(!hits.length)return E.toast('Nada encontrado');if(!confirm('Substituir em '+hits.length+' arquivo(s) ('+hits.reduce((a,h)=>a+h[1],0)+' ocorrências)?\n'+hits.slice(0,12).map(h=>h[0]+' ('+h[1]+')').join('\n')))return;
  for(const[p]of hits){const t=await E.api.text(p);await E.api.save(p,t.replace(re,r))}E.toast('Substituído em '+hits.length+' arquivo(s)');if(cur&&hits.some(h=>h[0]===cur))await open(cur,null,true)}

/* ================= prévia do jogo (funciona em file://, localhost e pasta local) ================= */
const esc=s=>s.replace(/<\/(script)/gi,'<\\/$1');
async function buildPreview(){
  let html=await E.api.text('index.html');const css=E.api.has('css/style.css')?await E.api.text('css/style.css'):'';const js={};
  for(const f of E.tree.filter(f=>/^js\/.*\.js$/.test(f.p)))js[f.p]=await E.api.text(f.p);
  html=html.replace(/<link[^>]*href="css\/style\.css"[^>]*>/,()=>'<style>'+css+'</style>');
  const hook=`<script>(function(){const P=parent.E,JS=${esc(JSON.stringify(js))};const of=window.fetch.bind(window);
  window.fetch=async function(u,o){const s=String(u);if(/^(https?:|data:|blob:)/.test(s))return of(u,o);const p=s.split('?')[0].replace(/^\\.?\\//,'');
    try{const b=new Uint8Array(await P.api.u8(p));return new Response(b,{status:200,headers:{'Content-Type':P.mimeOf(p)}})}catch(e){console.warn('prévia:',p,e);return new Response('not found',{status:404})}};
  const d=Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype,'src');
  Object.defineProperty(HTMLScriptElement.prototype,'src',{configurable:true,get(){return d.get.call(this)},set(v){const k=String(v).split('?')[0].replace(/^\\.?\\//,'');if(JS[k]!==undefined){this.textContent=JS[k]}else d.set.call(this,v)}});})()<\/script>`;
  html=html.replace(/<script src="(js\/[^"]+)"><\/script>/g,(m,p)=>js[p]!==undefined?'<script>'+esc(js[p])+'</script>':m);
  html=/<head[^>]*>/i.test(html)?html.replace(/<head[^>]*>/i,m=>m+hook):hook+html;return html}
async function reloadGame(){const fr=$('#gm-fr');$('#gm-msg').textContent='montando…';fr.srcdoc=await buildPreview();$('#gm-msg').textContent='';E.status('')}
E.init_game=()=>{E.on('gm-reload','click',E.guard(reloadGame));return reloadGame()};
E.show_game=()=>{};
})();
