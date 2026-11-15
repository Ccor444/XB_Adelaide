/* Decodificador DDS (DXT1/3/5 e RGB/RGBA sem compressão, 1º mipmap) → canvas. Só leitura. */
(function(){
function c565(v){return[((v>>11)&31)*255/31|0,((v>>5)&63)*255/63|0,(v&31)*255/31|0]}
function colorBlock(u8,o,out,x0,y0,W,H,alphaMode,alpha){
  const c0=u8[o]|u8[o+1]<<8,c1=u8[o+2]|u8[o+3]<<8,a=c565(c0),b=c565(c1),pal=[a,b,null,null];
  if(c0>c1||alphaMode){pal[2]=a.map((v,i)=>(2*v+b[i])/3|0);pal[3]=b.map((v,i)=>(v+2*a[i])/3|0)}
  else{pal[2]=a.map((v,i)=>(v+b[i])/2|0);pal[3]=null}
  let bits=u8[o+4]|u8[o+5]<<8|u8[o+6]<<16|u8[o+7]<<24;
  for(let y=0;y<4;y++)for(let x=0;x<4;x++){const idx=bits&3;bits>>>=2;const px=x0+x,py=y0+y;if(px>=W||py>=H)continue;
    const d=(py*W+px)*4,c=pal[idx];if(c){out[d]=c[0];out[d+1]=c[1];out[d+2]=c[2];out[d+3]=alphaMode?alpha[y*4+x]:255}else{out[d]=out[d+1]=out[d+2]=0;out[d+3]=0}}}
function decode(u8){
  const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
  if(dv.getUint32(0,true)!==0x20534444)throw new Error('Não é um DDS');
  const H=dv.getUint32(12,true),W=dv.getUint32(16,true),pfFlags=dv.getUint32(80,true),cc=dv.getUint32(84,true),bpp=dv.getUint32(88,true),
    rm=dv.getUint32(92,true),gm=dv.getUint32(96,true),bm=dv.getUint32(100,true),am=dv.getUint32(104,true);
  const out=new Uint8ClampedArray(W*H*4),fcc=String.fromCharCode(cc&255,cc>>8&255,cc>>16&255,cc>>>24);let o=128;
  if(pfFlags&4){ // fourCC
    if(fcc==='DXT1'){for(let y=0;y<H;y+=4)for(let x=0;x<W;x+=4){colorBlock(u8,o,out,x,y,W,H,false);o+=8}}
    else if(fcc==='DXT3'){for(let y=0;y<H;y+=4)for(let x=0;x<W;x+=4){const al=[];for(let i=0;i<16;i++){const v=u8[o+(i>>1)];al.push(((i&1?v>>4:v&15)*17))}colorBlock(u8,o+8,out,x,y,W,H,true,al);o+=16}}
    else if(fcc==='DXT5'){for(let y=0;y<H;y+=4)for(let x=0;x<W;x+=4){const a0=u8[o],a1=u8[o+1],t=[a0,a1];
        if(a0>a1)for(let i=1;i<7;i++)t.push(((7-i)*a0+i*a1)/7|0);else{for(let i=1;i<5;i++)t.push(((5-i)*a0+i*a1)/5|0);t.push(0,255)}
        let lo=u8[o+2]|u8[o+3]<<8|u8[o+4]<<16,hi=u8[o+5]|u8[o+6]<<8|u8[o+7]<<16;const al=[];
        for(let i=0;i<8;i++)al.push(t[(lo>>(i*3))&7]);for(let i=0;i<8;i++)al.push(t[(hi>>(i*3))&7]);
        colorBlock(u8,o+8,out,x,y,W,H,true,al);o+=16}}
    else throw new Error('DDS '+fcc+' não suportado')}
  else if(pfFlags&(0x40|0x1)&&(bpp===32||bpp===24)){ // RGB(A) sem compressão
    const bytes=bpp>>3,sh=m=>m?Math.log2(m&-m):0,mx=m=>m?m/(m&-m):1;
    const rs=sh(rm),gs=sh(gm),bs=sh(bm),as=sh(am),rM=mx(rm),gM=mx(gm),bM=mx(bm),aM=mx(am);
    for(let i=0;i<W*H;i++,o+=bytes){let v=u8[o]|u8[o+1]<<8|u8[o+2]<<16|(bytes>3?u8[o+3]<<24:0);v>>>=0;const d=i*4;
      out[d]=((v&rm)>>>rs)*255/rM;out[d+1]=((v&gm)>>>gs)*255/gM;out[d+2]=((v&bm)>>>bs)*255/bM;out[d+3]=am?((v&am)>>>as)*255/aM:255}}
  else throw new Error('Formato DDS não suportado (bpp '+bpp+')');
  return{w:W,h:H,data:out}}
function toCanvas(u8){const im=decode(u8),c=document.createElement('canvas');c.width=im.w;c.height=im.h;c.getContext('2d').putImageData(new ImageData(im.data,im.w,im.h),0,0);return c}
E.dds={decode,toCanvas};
})();
