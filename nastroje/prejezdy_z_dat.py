# železniční přejezdy z dat segmentů (Overture, data_all/segment.parquet), když není k dispozici Overpass: úrovňové křížení silnice s tratí
# (ani jedna není na mostě ani v tunelu) -> assets/prejezdy.json [[lat, lon], ...] (stejný formát jako nastroje/prejezdy.py)
# python nastroje/prejezdy_z_dat.py   (z kořene izomapa/)
import json, sys
sys.path.insert(0, '.')
import numpy as np, pyarrow.parquet as pq, shapely
from geo import bbox_lonlat

X0, X1, Y0, Y1 = bbox_lonlat(100.0)
DRIVE = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'track', 'pedestrian', 'cycleway', 'path', 'footway'}
AUTA = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service'}
t = pq.read_table('data_all/segment.parquet').to_pandas()


def zakazano(flags, frac):          # úsek v době křížení na mostě / v tunelu / zakrytý
    if flags is None: return False
    for f in flags:
        v = set(list(f.get('values')) if f.get('values') is not None else [])
        if not v & {'is_bridge', 'is_tunnel', 'is_covered'}: continue
        b = f.get('between'); b = None if b is None else list(b)
        if b is None or (b[0] - 1e-6 <= frac <= b[1] + 1e-6): return True
    return False


rails, roads = [], []
for _, r in t.iterrows():
    g = shapely.from_wkb(r['geometry'])
    if g.is_empty or not shapely.box(X0, Y0, X1, Y1).intersects(g): continue
    if r['subtype'] == 'rail' and r['class'] in ('standard_gauge', 'unknown'): rails.append((g, r['rail_flags']))
    elif r['subtype'] == 'road' and r['class'] in AUTA: roads.append((g, r['road_flags'], r['class']))
print('kolejí', len(rails), 'silnic', len(roads))
tree = shapely.STRtree([g for g, *_ in roads])
out = []
for g, fl in rails:
    for k in tree.query(g):
        rg, rfl, rc = roads[int(k)]
        x = g.intersection(rg)
        pts = [x] if x.geom_type == 'Point' else [p for p in getattr(x, 'geoms', []) if p.geom_type == 'Point']
        for p in pts:
            if zakazano(fl, g.project(p, normalized=True)) or zakazano(rfl, rg.project(p, normalized=True)): continue
            out.append((round(p.y, 6), round(p.x, 6)))
# sloučit body blíž než ~12 m (dvě koleje vedle sebe = jeden přejezd) – prep.py si je stejně přiřadí k silnici
res = []
for la, lo in sorted(set(out)):
    if not any(abs(la - a) < 0.0001 and abs(lo - b) < 0.00016 for a, b in res): res.append((la, lo))
json.dump([list(p) for p in res], open('assets/prejezdy.json', 'w'))
print('přejezdů', len(res))
