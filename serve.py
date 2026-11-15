#!/usr/bin/env python3
"""Servidor local do XB Adelaide + API do editor.
   python serve.py [porta]  →  jogo: http://localhost:8080/   editor: http://localhost:8080/editor/
   Só escuta em 127.0.0.1. O editor só escreve em assets/ cars/ data/ js/ css/ e index.html (com backup em _backup/)."""
import http.server, socketserver, os, sys, json, time, shutil, webbrowser, urllib.parse
ROOT=os.path.dirname(os.path.abspath(__file__)); os.chdir(ROOT)
PORT=int(sys.argv[1]) if len(sys.argv)>1 else 8080
WRITABLE=('assets/','cars/','data/','js/','css/'); WRITABLE_FILES=('index.html','LEIA-ME.txt')
def safe(rel):
    rel=rel.replace('\\','/').lstrip('/')
    full=os.path.realpath(os.path.join(ROOT,rel))
    if not full.startswith(ROOT+os.sep): return None
    r=os.path.relpath(full,ROOT).replace('\\','/')
    return (r,full) if (r.startswith(WRITABLE) or r in WRITABLE_FILES) else None
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self): self.send_header('Cache-Control','no-store'); super().end_headers()
    def log_message(self,*a): pass
    def js(self,o,code=200):
        b=json.dumps(o).encode(); self.send_response(code); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        u=urllib.parse.urlparse(self.path)
        if u.path=='/api/ping': return self.js({'xb':True,'v':2})
        if u.path=='/api/tree':
            out=[]
            for base in ('assets','cars','data','js','css'):
                for d,_,fs in os.walk(os.path.join(ROOT,base)):
                    for f in fs:
                        p=os.path.join(d,f); out.append({'p':os.path.relpath(p,ROOT).replace('\\','/'),'s':os.path.getsize(p)})
            out.append({'p':'index.html','s':os.path.getsize('index.html')})
            return self.js(sorted(out,key=lambda x:x['p']))
        if u.path=='/api/backups':
            q=urllib.parse.parse_qs(u.query); rel=q.get('path',[''])[0]; res=[]
            bd=os.path.join(ROOT,'_backup')
            if os.path.isdir(bd):
                for t in sorted(os.listdir(bd),reverse=True):
                    if os.path.isfile(os.path.join(bd,t,rel)): res.append(t)
            return self.js(res[:30])
        return super().do_GET()
    def do_POST(self):
        u=urllib.parse.urlparse(self.path); q=urllib.parse.parse_qs(u.query); rel=q.get('path',[''])[0]
        n=int(self.headers.get('Content-Length',0)); body=self.rfile.read(n) if n else b''
        s=safe(rel)
        if not s: return self.js({'error':'caminho não permitido'},403)
        r,full=s
        if u.path=='/api/save':
            if os.path.isfile(full):
                bk=os.path.join(ROOT,'_backup',time.strftime('%Y%m%d-%H%M%S'),r)
                os.makedirs(os.path.dirname(bk),exist_ok=True); shutil.copy2(full,bk)
            os.makedirs(os.path.dirname(full),exist_ok=True)
            tmp=full+'.tmp'; open(tmp,'wb').write(body); os.replace(tmp,full)
            return self.js({'ok':True,'size':len(body)})
        if u.path=='/api/delete':
            if not os.path.isfile(full): return self.js({'error':'arquivo não existe'},404)
            bk=os.path.join(ROOT,'_backup',time.strftime('%Y%m%d-%H%M%S'),r)
            os.makedirs(os.path.dirname(bk),exist_ok=True); shutil.copy2(full,bk); os.remove(full)
            d=os.path.dirname(full)
            try:
                while d!=ROOT and not os.listdir(d): os.rmdir(d); d=os.path.dirname(d)
            except OSError: pass
            return self.js({'ok':True})
        if u.path=='/api/restore':
            t=q.get('ts',[''])[0]; src=os.path.join(ROOT,'_backup',t,r)
            if not os.path.isfile(src) or '..' in t: return self.js({'error':'backup não encontrado'},404)
            if os.path.isfile(full):
                pb=os.path.join(ROOT,'_backup',time.strftime('%Y%m%d-%H%M%S')+'-pre-restore',r)
                os.makedirs(os.path.dirname(pb),exist_ok=True); shutil.copy2(full,pb)
            shutil.copy2(src,full); return self.js({'ok':True})
        self.js({'error':'rota desconhecida'},404)
socketserver.TCPServer.allow_reuse_address=True
with socketserver.ThreadingTCPServer(('127.0.0.1',PORT),H) as srv:
    print(f'Jogo   : http://localhost:{PORT}/\nEditor : http://localhost:{PORT}/editor/\n(Ctrl+C para parar)')
    try: webbrowser.open(f'http://localhost:{PORT}/editor/')
    except Exception: pass
    srv.serve_forever()
