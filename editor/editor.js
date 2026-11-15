/* Núcleo do editor: helpers, eventos, abas, atalhos. Todos os módulos usam o objeto global E.
   Ordem dos scripts: editor.js → zip.js → dds.js → fs.js → abas. Só scripts clássicos (funciona em file://). */
const E={tabInit:{},dirty:{},_subs:{}};window.E=E;
E.$=(s,r=document)=>r.querySelector(s);E.$$=(s,r=document)=>[...r.querySelectorAll(s)];
E.el=(tag,props={},kids=[])=>{const e=document.createElement(tag);for(const k in props){if(k==='class')e.className=props[k];else if(k==='text')e.textContent=props[k];else if(k.startsWith('on'))e[k]=props[k];else if(k==='value')e.value=props[k];else e.setAttribute(k,props[k])}
  [].concat(kids).forEach(c=>c!=null&&e.append(c));return e};
E.sub=(n,f)=>{(E._subs[n]=E._subs[n]||[]).push(f)};
E.emit=(n,...a)=>{(E._subs[n]||[]).forEach(f=>{try{f(...a)}catch(e){console.error(e)}})};
E.toast=(msg,err)=>{const d=E.el('div',{class:err?'err':'',text:msg});E.$('#toast').append(d);setTimeout(()=>d.remove(),err?8000:3000)};
E.status=t=>E.$('#status').textContent=t||'';
E.download=(name,data,type='application/octet-stream')=>{const a=document.createElement('a');a.href=URL.createObjectURL(data instanceof Blob?data:new Blob([data],{type}));a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000)};
E.num=(el,d=0)=>{const v=parseFloat(String(el.value).replace(',','.'));return isFinite(v)?v:d};
E.jsonSave=(p,o,ind)=>E.api.save(p,JSON.stringify(o,null,ind));
E.fillSelect=(sel,items,val)=>{sel.innerHTML='';items.forEach(([v,t])=>sel.append(E.el('option',{value:v,text:t})));if(val!==undefined)sel.value=val};
E.on=(id,ev,fn)=>{const e=E.$('#'+id);if(!e)throw new Error('elemento #'+id+' não existe');e.addEventListener(ev,fn)};
E.guard=fn=>async(...a)=>{try{return await fn(...a)}catch(e){console.error(e);E.toast(e.message||String(e),true)}};
E.fmtKB=n=>n>=1048576?(n/1048576).toFixed(1)+' MB':n>=1024?(n/1024).toFixed(n<10240?1:0)+' KB':n+' B';
E.setDirty=(k,v)=>{E.dirty[k]=v;E.status(Object.keys(E.dirty).filter(k=>E.dirty[k]).map(k=>'● '+k+' não salvo').join('  '))};
E.ask=(msg,def)=>{const v=prompt(msg,def);return v===null?null:v.trim()};
E.debounce=(f,ms=150)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>f(...a),ms)}};
E.clamp=(x,a,b)=>x<a?a:x>b?b:x;
E.fix=(v,n=3)=>+(+v).toFixed(n);
window.addEventListener('beforeunload',e=>{if(Object.values(E.dirty).some(Boolean)||(E.fs&&E.fs.kind==='mem'&&E.changed.size)){e.preventDefault();e.returnValue=''}});

/* lista de abas: [id, rótulo] */
E.TABS=[['files','Arquivos'],['tex','Texturas'],['mdl','Modelos 3D'],['coll','Colisão'],['path','Traçado'],['snd','Sons'],['cfg','Configurações'],['code','Código / Dados'],['game','Jogo']];

E.show=t=>{
  if(!E.TABS.some(x=>x[0]===t))t='files';
  E.$$('#tabs button').forEach(b=>b.classList.toggle('on',b.dataset.t===t));E.$$('.tab').forEach(s=>s.classList.toggle('on',s.id==='tab-'+t));
  E.cur=t;
  if(!E.tabInit[t]&&E['init_'+t])E.tabInit[t]=E.guard(E['init_'+t])();
  if(E['show_'+t])E['show_'+t]();
  try{history.replaceState(null,'','#'+t)}catch(e){}};

E.tabReady=t=>Promise.resolve(E.tabInit[t]);

E.boot=async function(){
  const nav=E.$('#tabs');E.TABS.forEach(([id,t])=>nav.append(E.el('button',{'data-t':id,text:t,onclick:()=>E.show(id)})));
  E.$('#btn-switch').onclick=E.changeProject;
  E.$('#btn-export').onclick=E.guard(async()=>{E.status('Gerando .zip…');const b=await E.api.exportZip(false,(i,n)=>E.status('Compactando '+i+'/'+n));E.status('');E.download('XB_Adelaide_editado_'+E.stamp()+'.zip',b);E.toast('Projeto exportado ('+E.fmtKB(b.size)+')')});
  document.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();const b=E.$('#tab-'+E.cur+' button[id$="-save"]');if(b)b.click()}});
  E.sub('open',fs=>{
    const bd=E.$('#badge'),k=fs.kind;bd.textContent=k==='server'?'● servidor local · grava no disco':k==='dir'?'● pasta local · grava no disco':'● memória · exporte o .zip';
    bd.className=k==='mem'?'warn':'ok';bd.title=fs.label;
    E.$('#btn-export').classList.toggle('pri',k==='mem');
    const g=E.$('#lnk-game');g.hidden=k!=='server';if(k==='server')g.href=fs.base;
    if(k==='mem')E.toast('Modo memória: “Salvar” guarda dentro do editor. Use “Exportar .zip” para levar as alterações.');
    E.show((location.hash||'').slice(1)||'files')});
  await E.initProject();
};
document.addEventListener('DOMContentLoaded',()=>E.guard(E.boot)());
