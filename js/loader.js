/* Carrega data/*.json + assets/* e monta os mesmos objetos que antes ficavam embutidos no HTML.
   Qualquer campo {"$file":"assets/..."} vira string base64 do arquivo (formato que o motor já espera).
   Para trocar uma textura/som/modelo basta substituir o arquivo em assets/ — sem mexer no motor. */
(async function(){
  const load=document.getElementById('load');
  const say=t=>{if(load)load.textContent=t};
  const toB64=buf=>{const u=new Uint8Array(buf);let s='';for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s)};
  const cache=new Map();
  const getFile=p=>{if(!cache.has(p))cache.set(p,fetch(p).then(r=>{if(!r.ok)throw new Error(p+' → HTTP '+r.status);return r.arrayBuffer()}).then(toB64));return cache.get(p)};
  async function resolve(o){
    if(Array.isArray(o)){await Promise.all(o.map(async(v,i)=>{o[i]=await resolve(v)}));return o}
    if(o&&typeof o==='object'){
      if(typeof o.$file==='string')return getFile(o.$file);
      await Promise.all(Object.keys(o).map(async k=>{o[k]=await resolve(o[k])}));return o}
    return o}
  try{
    const names=['trk','ext','fx','snd','trophy','ui','peds','trees','grass','houses','tires','timecyc','fog','torcida','pedgrp','trucks'];
    say('Carregando arquivos do jogo…');
    const out={};
    await Promise.all(names.map(async n=>{
      const r=await fetch('data/'+n+'.json');if(!r.ok&&(n==='peds'||n==='trees'||n==='grass'||n==='houses'||n==='tires'||n==='timecyc'||n==='fog'||n==='torcida'||n==='pedgrp'||n==='trucks')){out[n]=null;return}if(!r.ok)throw new Error('data/'+n+'.json → HTTP '+r.status);
      out[n]=await resolve(await r.json())}));
    // carros: cars/cars.json lista as pastas; cada cars/<id>/car.json descreve um carro
    const idx=await (await fetch('cars/cars.json')).json();
    out.cars={};out.defaultCar=idx.default;
    await Promise.all(idx.cars.map(async id=>{
      const r=await fetch('cars/'+id+'/car.json');if(!r.ok)throw new Error('cars/'+id+'/car.json → HTTP '+r.status);
      out.cars[id]=await resolve(await r.json())}));
    out.carOrder=idx.cars;
    window.__DATA=out;
    const s=document.createElement('script');s.src='js/game.js';document.body.appendChild(s);
  }catch(e){
    console.error(e);
    say(location.protocol==='file:'
      ?'Abra com o servidor local (iniciar.bat / iniciar.sh) — o navegador bloqueia arquivos via file://'
      :'Erro ao carregar: '+e.message);
  }
})();
