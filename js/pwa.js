/* App no navegador: tela cheia (botão ⛶ ou tecla F), instalar como app, paisagem, tela sempre ligada, service worker. */
(function(){
const de=document.documentElement,$=s=>document.querySelector(s);
const isFs=()=>!!(document.fullscreenElement||document.webkitFullscreenElement);
const standalone=()=>matchMedia('(display-mode: fullscreen)').matches||matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const canFs=!!(de.requestFullscreen||de.webkitRequestFullscreen);
const ios=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const framed=(()=>{try{return window.top!==window}catch(e){return true}})();
async function enter(){
  try{
    if(de.requestFullscreen)await de.requestFullscreen({navigationUI:'hide'});
    else if(de.webkitRequestFullscreen)de.webkitRequestFullscreen();
    else throw new Error('sem suporte');
    try{await screen.orientation.lock('landscape')}catch(e){}
    return true}
  catch(e){why();return false}}
function why(){
  const t=$('#iosTip');t.hidden=false;
  if(framed)t.innerHTML='O navegador não deixa este quadro ocupar a tela toda. <a href="'+location.href+'" target="_blank" rel="noopener" style="color:#ff7a1a">Abrir em nova aba</a> e tocar em ⛶ de novo.';
  else if(ios)t.innerHTML='O iPhone/iPad não permite tela cheia por botão. Toque em <b>Compartilhar</b> e depois <b>Adicionar à Tela de Início</b>: o app abre em tela cheia.';
  else t.innerHTML='O navegador recusou a tela cheia. Tente <b>F11</b>, ou instale como app (menu ⋮ → <b>Instalar</b>).';
  clearTimeout(why.t);why.t=setTimeout(()=>{t.hidden=true},9000)}
async function leave(){try{try{screen.orientation.unlock()}catch(e){}if(document.exitFullscreen)await document.exitFullscreen();else if(document.webkitExitFullscreen)document.webkitExitFullscreen()}catch(e){}}
const toggle=()=>isFs()?leave():enter();
/* botões flutuantes */
const box=document.createElement('div');box.id='pwa';
box.innerHTML='<button id="fsBtn" type="button" title="Tela cheia (F)" aria-label="Tela cheia">⛶</button><button id="instBtn" type="button" hidden title="Instalar como app">⤓ Instalar</button><div id="iosTip" hidden>Para usar em tela cheia: toque em <b>Compartilhar</b> e depois <b>Adicionar à Tela de Início</b>.</div>';
document.body.append(box);
const fsb=$('#fsBtn'),ib=$('#instBtn'),tip=$('#iosTip');
function sync(){const f=isFs();fsb.textContent=f?'🗗':'⛶';fsb.title=f?'Sair da tela cheia (F)':'Tela cheia (F)';fsb.hidden=standalone()&&!canFs;
  de.classList.toggle('is-fs',f||standalone());if(f||standalone())tip.hidden=true}
fsb.onclick=()=>{if(canFs&&!framed||isFs())toggle();else if(framed)enter().then(ok=>{if(!ok)why()});else why()};
document.addEventListener('fullscreenchange',sync);document.addEventListener('webkitfullscreenchange',sync);matchMedia('(display-mode: fullscreen)').addEventListener?.('change',sync);
addEventListener('keydown',e=>{if(e.code==='KeyF'&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)){e.preventDefault();toggle()}},true);
/* instalar */
let dp=null;addEventListener('beforeinstallprompt',e=>{e.preventDefault();dp=e;if(!standalone())ib.hidden=false});
ib.onclick=async()=>{if(!dp)return;dp.prompt();try{await dp.userChoice}catch(e){}dp=null;ib.hidden=true};
addEventListener('appinstalled',()=>{ib.hidden=true;dp=null});
/* celular: o primeiro toque no jogo entra em tela cheia (só se ainda não estiver) */
if(matchMedia('(pointer: coarse)').matches&&canFs&&!standalone())addEventListener('pointerup',function f(){if(!isFs())enter();removeEventListener('pointerup',f)},{once:true});
/* tela sempre ligada enquanto a página está visível */
let wl=null;async function wake(){try{if('wakeLock' in navigator&&document.visibilityState==='visible')wl=await navigator.wakeLock.request('screen')}catch(e){}}
document.addEventListener('visibilitychange',wake);wake();
/* sem zoom por duplo toque / gesto de pinça e sem menu de contexto no canvas */
document.addEventListener('gesturestart',e=>e.preventDefault());
/* segurar o dedo nos controles não pode abrir o menu do navegador (Voltar/Baixar/Imprimir/Compartilhar) */
addEventListener('contextmenu',e=>{if(!/INPUT|TEXTAREA/.test(e.target.tagName))e.preventDefault()},true);
addEventListener('selectstart',e=>{if(!/INPUT|TEXTAREA/.test(e.target.tagName))e.preventDefault()},true);
addEventListener('dragstart',e=>e.preventDefault(),true);
/* controles de toque: realce enquanto pressionado + vibração curta */
(function(){const t=document.getElementById('touch');if(!t)return;const dn=e=>{const b=e.target.closest&&e.target.closest('button');if(!b)return;b.classList.add('down');try{navigator.vibrate&&navigator.vibrate(b.id==='tG'?6:10)}catch(x){}},up=e=>{t.querySelectorAll('button.down').forEach(b=>b.classList.remove('down'))};
  t.addEventListener('pointerdown',dn,true);for(const ev of['pointerup','pointercancel','pointerleave','lostpointercapture'])t.addEventListener(ev,up,true);addEventListener('blur',up)})();
sync();
/* service worker (só em https ou localhost) */
if('serviceWorker' in navigator&&(location.protocol==='https:'||/^(localhost|127\.0\.0\.1)$/.test(location.hostname)))addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
})();
