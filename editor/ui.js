/* Ferramentas gerais de interface: barra de zoom flutuante, janela de atalhos (?), atalhos de abas, título com "●" quando há algo não salvo.
   Carregado logo depois de editor.js. */
(function(){
const $=E.$;

/* ---------- barra de zoom flutuante ----------
   E.zoomBar(host,{out,in,fit,reset,label:'txt',extra:[{t,title,fn}]}) → {label(txt)}   (host precisa ser position:relative) */
E.zoomBar=function(host,o){
  const bar=E.el('div',{class:'zb'+(o.cls?' '+o.cls:'')});
  const b=(t,title,fn,cls)=>{const x=E.el('button',{text:t,title,class:cls||'',type:'button'});x.addEventListener('click',e=>{e.stopPropagation();fn()});x.addEventListener('pointerdown',e=>e.stopPropagation());x.addEventListener('dblclick',e=>e.stopPropagation());return x};
  for(const x of o.extra||[])bar.append(b(x.t,x.title,x.fn,'xt'));
  if(o.out)bar.append(b('−','Menos zoom  ( - )',o.out));
  const lab=E.el('span',{class:'zl',text:o.label||'',title:'Nível de zoom'});if(o.reset){lab.style.cursor='pointer';lab.onclick=o.reset}bar.append(lab);
  if(o.in)bar.append(b('+','Mais zoom  ( + )',o.in));
  if(o.fit)bar.append(b('⤢','Enquadrar tudo  ( F )',o.fit));
  bar.addEventListener('pointerdown',e=>e.stopPropagation());bar.addEventListener('wheel',e=>e.stopPropagation());
  host.append(bar);return{el:bar,label:t=>{lab.textContent=t}}};

/* ---------- nível de zoom "bonito": 1 → 100% ---------- */
E.pct=r=>r>=10?Math.round(r*100)+'%':r>=1?(r*100).toFixed(0)+'%':(r*100).toFixed(r<.1?1:0)+'%';
E.niceNum=v=>{const p=Math.pow(10,Math.floor(Math.log10(v))),f=v/p;return(f<1.5?1:f<3.5?2:f<7.5?5:10)*p};
/* dica: tentativa de ler/gravar preferências sem quebrar se o navegador bloquear */
E.pref=(k,v)=>{try{if(v===undefined){const s=localStorage.getItem('xbed.'+k);return s===null?undefined:JSON.parse(s)}localStorage.setItem('xbed.'+k,JSON.stringify(v))}catch(e){return undefined}};

/* ---------- animação suave de valores numéricos (zoom por botão) ---------- */
E.tween=(from,to,ms,step,done)=>{const t0=performance.now(),ease=t=>t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;let stop=false;
  const f=now=>{if(stop)return;const t=Math.min(1,(now-t0)/ms),k=ease(t),v={};for(const key in to)v[key]=from[key]+(to[key]-from[key])*k;step(v);if(t<1)requestAnimationFrame(f);else done&&done()};requestAnimationFrame(f);return()=>{stop=true}};

/* ---------- atalhos ---------- */
const G=[['Ctrl+S','Salvar a aba atual'],['Ctrl+Z / Ctrl+Y','Desfazer / refazer (nas abas com edição)'],['Alt+1 … 9','Ir para a aba 1 … 9'],['?','Abrir/fechar esta janela'],['Esc','Fechar janelas e limpar seleção']];
const HELP={
 path:[['Roda','Zoom na posição do mouse'],['Arrastar fundo / botão do meio / Espaço+arrastar','Mover o mapa'],['Pinça (toque)','Zoom e mover com dois dedos'],['Clique num ponto','Selecionar (Shift = somar / tirar)'],['Shift+arrastar fundo','Seleção em caixa'],['Arrastar ponto','Mover (todos os selecionados juntos)'],['Duplo clique na linha','Inserir ponto ali'],['Duplo clique no fundo','Aproximar 2×'],['Setas','Mover seleção 0,5 m (Shift 5 m · Alt 5 cm)'],['Delete','Remover pontos selecionados'],['Ctrl+A','Selecionar todos'],['[  ]  ou  Tab','Ponto anterior / próximo'],['+  −','Zoom'],['F ou 0','Enquadrar a pista'],['Z','Zoom na seleção'],['I','Inserir ponto depois do selecionado'],['G','Mostrar/ocultar grade']],
 mdl:[['Arrastar','Girar a câmera'],['Botão direito / Shift+arrastar / botão do meio','Mover a câmera'],['Roda','Zoom na posição do mouse (Ctrl = mais rápido)'],['Duplo clique','Centrar a câmera no ponto clicado'],['Pinça / dois dedos','Zoom e mover'],['F','Enquadrar'],['+  −','Zoom'],['1  2  3  4','Vista frente · lado · topo · 3D'],['Setas','Girar (Shift = mover)']],
 coll:[['Arrastar','Girar a câmera'],['Botão direito / Shift+arrastar / Espaço+arrastar','Mover a câmera'],['Roda','Zoom na posição do mouse'],['Clique / Shift / Alt','Selecionar / somar / subtrair'],['Delete','Excluir triângulos selecionados'],['F','Enquadrar'],['+  −','Zoom'],['1  2  3  4','Vista frente · lado · topo · 3D']],
 tex:[['Roda','Zoom na posição do mouse'],['Espaço+arrastar / botão do meio','Mover a imagem'],['+  −','Zoom'],['0','Ajustar à janela'],['1','100%'],['[  ]','Diminuir / aumentar o pincel'],['Alt+clique','Origem do carimbo']],
 snd:[['Roda','Zoom na posição do mouse'],['Arrastar','Selecionar trecho (preenche “cortar início/fim”)'],['Shift+arrastar / botão do meio','Mover a forma de onda'],['Duplo clique','Limpar seleção'],['Espaço','Tocar / parar'],['+  −','Zoom'],['0','Mostrar tudo']],
 code:[['Ctrl+S','Salvar arquivo']]};
let dlg=null;
function help(open){
  if(!dlg){dlg=E.el('div',{class:'overlay',id:'help'},[E.el('div',{class:'card',id:'help-card'})]);dlg.onclick=e=>{if(e.target===dlg)help(false)};document.body.append(dlg)}
  if(open===undefined)open=!dlg.classList.contains('on');
  dlg.classList.toggle('on',open);if(!open)return;
  const c=$('#help-card');c.innerHTML='';c.append(E.el('h2',{text:'Atalhos'}));
  const tbl=(t,rows)=>{c.append(E.el('h3',{class:'hk',text:t}));const tb=E.el('table',{class:'hk'});rows.forEach(([k,d])=>tb.append(E.el('tr',{},[E.el('td',{},[E.el('kbd',{text:k})]),E.el('td',{text:d})])));c.append(tb)};
  const name=(E.TABS.find(x=>x[0]===E.cur)||[])[1];
  if(HELP[E.cur])tbl('Aba atual · '+name,HELP[E.cur]);tbl('Em todo o editor',G);
  c.append(E.el('button',{text:'Fechar',onclick:()=>help(false)}))}
E.help=help;

/* título da página com ● quando há alteração não salva */
const _sd=E.setDirty;E.setDirty=(k,v)=>{_sd(k,v);document.title=(Object.values(E.dirty).some(Boolean)?'● ':'')+'XB Adelaide · Editor'};

document.addEventListener('keydown',e=>{
  const t=e.target,typing=/INPUT|TEXTAREA|SELECT/.test(t.tagName)||t.isContentEditable;
  if(e.key==='Escape'&&dlg&&dlg.classList.contains('on')){help(false);return}
  if(typing)return;
  if(e.key==='?'||(e.key==='/'&&e.shiftKey)){e.preventDefault();help();return}
  if(e.altKey&&!e.ctrlKey&&!e.metaKey&&/^[1-9]$/.test(e.key)){const T=E.TABS[+e.key-1];if(T){e.preventDefault();E.show(T[0])}}
});
document.addEventListener('DOMContentLoaded',()=>{const b=$('#btn-help');if(b)b.onclick=()=>help()});
})();
