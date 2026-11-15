#!/usr/bin/env python3
"""Converte tools/pedgrp/pedgrp.dat (grupos de pedestres do GTA SA) em data/pedgrp.json.
   python3 tools/build_pedgrp.py [pedgrp.dat] [saida.json]
   Cada linha = um grupo: modelos separados por vírgula + comentário '# POPCYCLE_GROUP_NOME (SF|VEGAS)'. Sem etiqueta = LA."""
import re, json, sys, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'tools/pedgrp/pedgrp.dat')
dst = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'data/pedgrp.json')
groups = []
for l in open(src, encoding='latin1'):
    if l.strip().startswith('#') or '#' not in l: continue
    body, com = l.split('#', 1)
    models = [m.strip().lower() for m in body.split(',') if m.strip()]
    m = re.search(r'POPCYCLE_GROUP_(\w+)\s*(?:\((\w+)\))?', com)
    if not models or not m: continue
    groups.append({'name': m.group(1), 'region': (m.group(2) or 'LA').upper(), 'models': models})
json.dump({'groups': groups}, open(dst, 'w'), indent=1)
print('ok:', len(groups), 'grupos ->', dst)
