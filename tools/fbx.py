import struct, zlib
def parse(path):
    d=open(path,'rb').read(); ver=struct.unpack('<I',d[23:27])[0]; big=ver>=7500
    def node(o):
        if big: end,nprop,plen,nl=struct.unpack('<QQQB',d[o:o+25]);o+=25
        else: end,nprop,plen,nl=struct.unpack('<IIIB',d[o:o+13]);o+=13
        if end==0: return None,o
        name=d[o:o+nl].decode();o+=nl;props=[]
        for _ in range(nprop):
            t=chr(d[o]);o+=1
            if t in 'YCFDILB':
                fmt={'Y':'<h','C':'<?','F':'<f','D':'<d','I':'<i','L':'<q'}[t] if t!='B' else None
                if t=='B': props.append(bool(d[o]));o+=1
                else: sz=struct.calcsize(fmt);props.append(struct.unpack(fmt,d[o:o+sz])[0]);o+=sz
            elif t in 'fdilb':
                n,enc,cl=struct.unpack('<III',d[o:o+12]);o+=12
                raw=d[o:o+cl];o+=cl
                if enc: raw=zlib.decompress(raw)
                c={'f':'f','d':'d','i':'i','l':'q','b':'b'}[t]
                props.append(list(struct.unpack('<%d%s'%(n,c),raw)))
            elif t in 'SR':
                n=struct.unpack('<I',d[o:o+4])[0];o+=4;raw=d[o:o+n];o+=n
                props.append(raw.decode('latin1') if t=='S' else raw)
        kids=[]
        while o<end:
            k,o=node(o)
            if k is None: break
            kids.append(k)
        return (name,props,kids),end
    o=27;top=[]
    while o<len(d)-1:
        n,o=node(o)
        if n is None: break
        top.append(n)
    return top
def find(n,name): return [k for k in n[2] if k[0]==name]
def dump(n,ind=0,maxd=3):
    print(' '*ind+n[0],[p if not isinstance(p,list) else f'[{len(p)}]' for p in n[1]][:6])
    if ind//2<maxd:
        for k in n[2]: dump(k,ind+2,maxd)
