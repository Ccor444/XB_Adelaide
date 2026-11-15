import struct
import numpy as np
def rd(d,o):
    t,s,v=struct.unpack_from('<III',d,o);return t,s,v,o+12
def kids(d,o,end):
    out=[]
    while o+12<=end:
        t,s,v=struct.unpack_from('<III',d,o)
        if t==0 and s==0 and v==0: break
        out.append((t,o+12,s));o+=12+s
    return out
def cstr(b): return b.split(b'\0')[0].decode('latin1')
def parse_tex(d,o,s):
    name=mask=''
    for t,p,sz in kids(d,o,o+s):
        if t==2:
            if not name: name=cstr(d[p:p+sz])
            else: mask=cstr(d[p:p+sz])
    return name,mask
def parse_geom(d,o,s):
    ch=kids(d,o,o+s);g={}
    st=ch[0][1]
    flags,nuv,nat,ntri,nvert,nmorph=struct.unpack_from('<HBBIII',d,st);p=st+16
    ver=struct.unpack_from('<I',d,o-4)[0]
    if ver<0x34000: p+=12
    g['flags']=flags
    cols=None;uv=None
    if not (nat&1):
        if flags&8: cols=np.frombuffer(d,np.uint8,nvert*4,p).reshape(nvert,4);p+=nvert*4
        n=nuv if nuv else (2 if flags&128 else (1 if flags&4 else 0))
        if n: uv=np.frombuffer(d,np.float32,nvert*2*n,p).reshape(n,nvert,2);p+=nvert*2*n*4
        tri=np.frombuffer(d,np.uint16,ntri*4,p).reshape(ntri,4);p+=ntri*8
    else: tri=np.zeros((0,4),np.uint16)
    p+=16
    hv,hn=struct.unpack_from('<II',d,p);p+=8
    v=np.frombuffer(d,np.float32,nvert*3,p).reshape(nvert,3).copy() if hv else None
    if hv:p+=nvert*12
    nr=np.frombuffer(d,np.float32,nvert*3,p).reshape(nvert,3).copy() if hn else None
    g.update(nvert=nvert,ntri=ntri,verts=v,norms=nr,uv=uv,cols=cols,tri=tri)
    mats=[];binmesh=None;ext=None
    for t,p2,sz in ch[1:]:
        if t==8:
            mc=kids(d,p2,p2+sz);cnt=struct.unpack_from('<I',d,mc[0][1])[0]
            for t3,p3,s3 in mc[1:]:
                if t3==7:
                    mk=kids(d,p3,p3+s3)
                    fl,col,un,tx=struct.unpack_from('<IIII',d,mk[0][1])
                    am,sp,df=struct.unpack_from('<3f',d,mk[0][1]+16)
                    m=dict(color=[col&255,(col>>8)&255,(col>>16)&255,(col>>24)&255],tex=None,mask='',amb=am,spec=sp,diff=df,refl=None)
                    for t4,p4,s4 in mk[1:]:
                        if t4==6: m['tex'],m['mask']=parse_tex(d,p4,s4)
                        if t4==3:
                            for t5,p5,s5 in kids(d,p4,p4+s4):
                                if t5==0x253F2FC: m['refl']=struct.unpack_from('<5f',d,p5)
                    mats.append(m)
        if t==3:
            for t3,p3,s3 in kids(d,p2,p2+sz):
                if t3==0x50E:
                    fl,nm,tot=struct.unpack_from('<III',d,p3);q=p3+12;meshes=[]
                    for _ in range(nm):
                        ni,mi=struct.unpack_from('<II',d,q);q+=8
                        meshes.append((mi,np.frombuffer(d,np.uint32,ni,q).copy()));q+=ni*4
                    binmesh=(fl,meshes)
    g['mats']=mats;g['bin']=binmesh
    return g
def parse(path):
    d=open(path,'rb').read()
    clump=kids(d,0,len(d))[0]
    frames=[];geoms=[];atomics=[]
    for t,p,s in kids(d,clump[1],clump[1]+clump[2]):
        if t==0xE:
            fc=kids(d,p,p+s);n=struct.unpack_from('<I',d,fc[0][1])[0];q=fc[0][1]+4
            for i in range(n):
                m=np.array(struct.unpack_from('<9f',d,q),np.float32).reshape(3,3);pos=np.array(struct.unpack_from('<3f',d,q+36));par=struct.unpack_from('<i',d,q+48)[0];q+=56
                frames.append(dict(rot=m,pos=pos,parent=par,name=''))
            for i,(t2,p2,s2) in enumerate(fc[1:1+n]):
                for t3,p3,s3 in kids(d,p2,p2+s2):
                    if t3==0x253F2FE: frames[i]['name']=cstr(d[p3:p3+s3])
        if t==0x1A:
            for t2,p2,s2 in kids(d,p,p+s):
                if t2==0xF: geoms.append(parse_geom(d,p2,s2))
        if t==0x14:
            ac=kids(d,p,p+s);fi,gi,fl,_=struct.unpack_from('<4I',d,ac[0][1]);atomics.append((fi,gi,fl))
    return frames,geoms,atomics
def world(frames,i):
    M=np.eye(4)
    while i>=0:
        f=frames[i];T=np.eye(4);T[:3,:3]=f['rot'].T;T[:3,3]=f['pos'];M=T@M;i=f['parent']
    return M
