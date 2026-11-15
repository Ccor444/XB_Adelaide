/* ZIP mínimo (sem dependências): lê (stored/deflate) e escreve. Funciona em file:// e http://. */
(function(){
const crcT=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
const crc32=u8=>{let c=0xFFFFFFFF;for(let i=0;i<u8.length;i++)c=crcT[(c^u8[i])&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0};
const pipe=async(u8,stream)=>new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer());
const inflateRaw=u8=>{if(typeof DecompressionStream==='undefined')throw new Error('Este navegador não descompacta .zip (DecompressionStream). Use Chrome/Edge/Firefox recentes ou extraia a pasta.');return pipe(u8,new DecompressionStream('deflate-raw'))};
const deflateRaw=u8=>pipe(u8,new CompressionStream('deflate-raw'));
const NOCOMP=/\.(jpe?g|png|webp|zip|gif|mp3|ogg)$/i;

/* lê: devolve [{name,size,read:()=>Promise<Uint8Array>}] sem carregar tudo */
async function read(buf){
  const u8=new Uint8Array(buf),dv=new DataView(buf);let e=-1;
  for(let i=u8.length-22;i>=Math.max(0,u8.length-65557);i--)if(dv.getUint32(i,true)===0x06054b50){e=i;break}
  if(e<0)throw new Error('Arquivo .zip inválido');
  const n=dv.getUint16(e+10,true);let p=dv.getUint32(e+16,true);const out=[],td=new TextDecoder();
  for(let k=0;k<n;k++){
    if(dv.getUint32(p,true)!==0x02014b50)break;
    const flags=dv.getUint16(p+8,true),method=dv.getUint16(p+10,true),csize=dv.getUint32(p+20,true),usize=dv.getUint32(p+24,true),
      nl=dv.getUint16(p+28,true),el=dv.getUint16(p+30,true),cl=dv.getUint16(p+32,true),lho=dv.getUint32(p+42,true);
    const name=td.decode(u8.subarray(p+46,p+46+nl));p+=46+nl+el+cl;
    if(name.endsWith('/'))continue;
    out.push({name:name.replace(/\\/g,'/'),size:usize,read:async()=>{
      const l=dv.getUint16(lho+26,true),x=dv.getUint16(lho+28,true),s=lho+30+l+x,raw=u8.subarray(s,s+csize);
      if(method===0)return raw.slice();if(method===8)return inflateRaw(raw);throw new Error('Método de compressão '+method+' não suportado em '+name)}})}
  return out}

/* escreve: entries=[{name,data:Uint8Array}] → Blob */
async function write(entries,onProgress){
  const parts=[],cd=[],te=new TextEncoder();let off=0;
  const now=new Date(),dt=((now.getFullYear()-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate(),tm=(now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1);
  let i=0;
  for(const en of entries){
    const nm=te.encode(en.name),raw=en.data,crc=crc32(raw);let method=0,data=raw;
    if(typeof CompressionStream!=='undefined'&&raw.length>256&&!NOCOMP.test(en.name)){try{const d=await deflateRaw(raw);if(d.length<raw.length){data=d;method=8}}catch(e){}}
    const h=new DataView(new ArrayBuffer(30));h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x0800,true);h.setUint16(8,method,true);h.setUint16(10,tm,true);h.setUint16(12,dt,true);
    h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,raw.length,true);h.setUint16(26,nm.length,true);h.setUint16(28,0,true);
    parts.push(h.buffer,nm,data);
    const c=new DataView(new ArrayBuffer(46));c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x0800,true);c.setUint16(10,method,true);c.setUint16(12,tm,true);c.setUint16(14,dt,true);
    c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,raw.length,true);c.setUint16(28,nm.length,true);c.setUint32(42,off,true);
    cd.push(c.buffer,nm);off+=30+nm.length+data.length;
    if(onProgress&&(++i%20===0))onProgress(i,entries.length)}
  let cdSize=0;for(const x of cd)cdSize+=x.byteLength;
  const e=new DataView(new ArrayBuffer(22));e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);e.setUint32(12,cdSize,true);e.setUint32(16,off,true);
  return new Blob([...parts,...cd,e.buffer],{type:'application/zip'})}
window.XZip={read,write,crc32};
})();
