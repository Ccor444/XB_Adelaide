import struct, io
from PIL import Image
def read_txd(path):
    d=open(path,'rb').read();t,s,v=struct.unpack_from('<III',d,0)
    o=12;end=12+s;o+=12+struct.unpack_from('<I',d,o+4)[0];out={}
    while o+12<=end:
        t,s,v=struct.unpack_from('<III',d,o)
        if t==0x15:
            p=o+24
            if struct.unpack_from('<I',d,p)[0]==8:
                nm=d[p+8:p+40].split(b'\0')[0].decode();im=_d3d8(d,p)
                if im is not None: out[nm.lower()]=im
                o+=12+s;continue
            name=d[p+8:p+40].split(b'\0')[0].decode()
            fmt=d[p+76:p+80];w,h,dep,nl,rt,cm=struct.unpack_from('<HHBBBB',d,p+80)
            q=p+88;sz=struct.unpack_from('<I',d,q)[0];data=d[q+4:q+4+sz]
            f32=struct.unpack_from('<I',d,p+76)[0]
            if f32 in (21,22):   # BGRA/BGRX sem compressão (palmeiras, pinheiros)
                import numpy as np
                a=np.frombuffer(data,np.uint8,w*h*4).reshape(h,w,4)[...,[2,1,0,3]].copy()
                if f32==22: a[...,3]=255
                out[name.lower()]=Image.fromarray(a,'RGBA');o+=12+s;continue
            hdr=bytearray(128);hdr[0:4]=b'DDS ';struct.pack_into('<7I',hdr,4,124,0x81007,h,w,sz,0,1)
            struct.pack_into('<I',hdr,76,32);struct.pack_into('<I',hdr,80,4);hdr[84:88]=fmt;struct.pack_into('<I',hdr,108,0x1000)
            im=Image.open(io.BytesIO(bytes(hdr)+data)).convert('RGBA');out[name.lower()]=im
        o+=12+s
    return out

def _d3d8(d,p):
    """Textura D3D8 (particle.txd do GTA SA PC): DXT1/3/5, 8888/4444/1555/565 e 8 bits com paleta."""
    import numpy as np
    rf,ha=struct.unpack_from('<II',d,p+72);w,h,dep,nl,rt,cp=struct.unpack_from('<HHBBBB',d,p+80);q=p+88
    pal=None
    if rf&0x2000: pal=np.frombuffer(d,np.uint8,1024,q).reshape(256,4);q+=1024   # RGBA
    sz=struct.unpack_from('<I',d,q)[0];data=d[q+4:q+4+sz]
    if cp in (1,3,5):
        hdr=bytearray(128);hdr[0:4]=b'DDS ';struct.pack_into('<7I',hdr,4,124,0x81007,h,w,sz,0,1)
        struct.pack_into('<I',hdr,76,32);struct.pack_into('<I',hdr,80,4);hdr[84:88]=b'DXT%d'%cp;struct.pack_into('<I',hdr,108,0x1000)
        return Image.open(io.BytesIO(bytes(hdr)+data)).convert('RGBA')
    if pal is not None:
        idx=np.frombuffer(data,np.uint8,w*h).reshape(h,w);a=pal[idx].copy()
        if not ha: a[...,3]=255
        return Image.fromarray(a,'RGBA')
    f=rf&0xf00
    if dep==32:
        a=np.frombuffer(data,np.uint8,w*h*4).reshape(h,w,4)[...,[2,1,0,3]].copy()
        if not ha: a[...,3]=255
        return Image.fromarray(a,'RGBA')
    v=np.frombuffer(data,'<u2',w*h).reshape(h,w).astype(np.uint32)
    if f==0x100: r=(v>>10)&31;g=(v>>5)&31;b=v&31;al=np.where(v&0x8000,255,0);r,g,b=r*255//31,g*255//31,b*255//31
    elif f==0x200: r=(v>>11)&31;g=(v>>5)&63;b=v&31;al=np.full(v.shape,255);r,g,b=r*255//31,g*255//63,b*255//31
    elif f==0x300: al=((v>>12)&15)*17;r=((v>>8)&15)*17;g=((v>>4)&15)*17;b=(v&15)*17
    else: return None
    return Image.fromarray(np.stack([r,g,b,al],-1).astype(np.uint8),'RGBA')
