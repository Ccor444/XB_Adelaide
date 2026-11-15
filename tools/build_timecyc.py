#!/usr/bin/env python3
"""Converte o timecycp.dat (ou timecyc.dat) do GTA SA (tools/timecyc/timecycp.dat) em data/timecyc.json, usado pela névoa/clima do jogo.
   python3 tools/build_timecyc.py [timecycp.dat] [saida.json]
   Colunas lidas (por clima, 8 horários: 0h 5h 6h 7h 12h 19h 20h 22h):
     SkyTop(9-11) SkyBot(12-14) = cor da névoa/horizonte · FarClp(27) = distância onde a névoa chega a 100%
     FogSt(28) = distância onde a névoa começa (gravado como inteiro de 16 bits SEM sinal: 65514 = -22 → névoa já no carro)"""
import re, json, sys, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'tools/timecyc/timecycp.dat')
dst = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'data/timecyc.json')
HOURS = [0, 5, 6, 7, 12, 19, 20, 22]
W, order, cur = {}, [], None
for l in open(src, encoding='latin1'):
    l = l.strip()
    m = re.match(r'^////+\s*(\S+)', l)
    if m: cur = m.group(1); W[cur] = []; order.append(cur); continue
    if not l or l.startswith('//'): continue
    W[cur].append([float(x) for x in l.split()])
sg = lambda v: int(v - 65536 if v > 32767 else v)
out = {'hours': HOURS, 'order': order, 'weathers': {}}
for k in order:
    r = W[k]
    assert len(r) == 8, (k, len(r))
    out['weathers'][k] = {
        'skyTop': [[int(x) for x in row[9:12]] for row in r],
        'skyBot': [[int(x) for x in row[12:15]] for row in r],
        'farClp': [int(row[27]) for row in r],
        'fogSt': [sg(row[28]) for row in r]}
json.dump(out, open(dst, 'w'), separators=(',', ':'))
print('ok:', len(order), 'climas ->', dst)
