import fbx, numpy as np, math
def rot(rx,ry,rz):
    rx,ry,rz=map(math.radians,(rx,ry,rz))
    X=np.array([[1,0,0],[0,math.cos(rx),-math.sin(rx)],[0,math.sin(rx),math.cos(rx)]])
    Y=np.array([[math.cos(ry),0,math.sin(ry)],[0,1,0],[-math.sin(ry),0,math.cos(ry)]])
    Z=np.array([[math.cos(rz),-math.sin(rz),0],[math.sin(rz),math.cos(rz),0],[0,0,1]])
    return Z@Y@X
def load(path='/mnt/user-data/uploads/Leaf_Oak.fbx'):
    top=fbx.parse(path); obj=[t for t in top if t[0]=='Objects'][0]; cn=[t for t in top if t[0]=='Connections'][0]
    geo={g[1][0]:g for g in obj[2] if g[0]=='Geometry'}; mod={m[1][0]:m for m in obj[2] if m[0]=='Model'}
    g2m={c[1][1]:c[1][2] for c in cn[2] if c[1][1] in geo}
    out=[]
    for gid,g in geo.items():
        m=mod[g2m[gid]]; name=m[1][1].split('\x00')[0]
        P={p[1][0]:p[1][4:] for p in fbx.find(fbx.find(m,'Properties70')[0],'P')}
        T=np.array(P.get('Lcl Translation',[0,0,0])); R=P.get('Lcl Rotation',[0,0,0]); S=np.array(P.get('Lcl Scaling',[1,1,1]))
        M=rot(*R)
        V=np.array(fbx.find(g,'Vertices')[0][1][0]).reshape(-1,3)
        pvi=fbx.find(g,'PolygonVertexIndex')[0][1][0]
        le=fbx.find(g,'LayerElementUV')[0]; uv=np.array(fbx.find(le,'UV')[0][1][0]).reshape(-1,2); uvi=fbx.find(le,'UVIndex')[0][1][0]
        ln=fbx.find(g,'LayerElementNormal')[0]; nr=np.array(fbx.find(ln,'Normals')[0][1][0]).reshape(-1,3)
        W=(V*S)@M.T+T; Nw=(nr/np.where(S==0,1,S))@M.T
        # polígonos -> triângulos (leque), vértices por canto de polígono
        pos,uvs,nrm,idx=[],[],[],[];poly=[];ci=0
        for i,v in enumerate(pvi):
            e=v<0; vi=~v if e else v
            poly.append((vi,ci)); ci+=1
            if e:
                base=len(pos)
                for (vv,c) in poly: pos.append(W[vv]); uvs.append(uv[uvi[c]]); nrm.append(Nw[c]/ (np.linalg.norm(Nw[c])+1e-9))
                for k in range(1,len(poly)-1): idx+= [base,base+k,base+k+1]
                poly=[]
        out.append(dict(name=name,pos=np.array(pos),uv=np.array(uvs),n=np.array(nrm),idx=np.array(idx),leaf=name.startswith('Plane')))
    return out
if __name__=='__main__':
    o=load(); 
    for k in ('leaf',):
        pass
    allp=np.concatenate([x['pos'] for x in o]); print('bbox',allp.min(0).round(1),allp.max(0).round(1))
    leaf=[x for x in o if x['leaf']]; bark=[x for x in o if not x['leaf']]
    print('leaf meshes',len(leaf),'verts',sum(len(x['pos']) for x in leaf),'tris',sum(len(x['idx'])//3 for x in leaf))
    print('bark meshes',len(bark),'verts',sum(len(x['pos']) for x in bark),'tris',sum(len(x['idx'])//3 for x in bark))
    lp=np.concatenate([x['pos'] for x in leaf]);print('leaf bbox',lp.min(0).round(1),lp.max(0).round(1))
    lu=np.concatenate([x['uv'] for x in leaf]);print('leaf uv',lu.min(0),lu.max(0))
    bu=np.concatenate([x['uv'] for x in bark]);print('bark uv',bu.min(0),bu.max(0))
    print([ (x['name'],len(x['pos'])) for x in o[:4]])
