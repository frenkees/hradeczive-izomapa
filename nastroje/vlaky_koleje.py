# Koleje HK hl.n. s čísly a pravidla obsazení kolejí podle směru -> assets/vlaky_koleje.json
#  - geometrie kolejí z dat segmentů (řez kolmo na nástupiště, E1 = nejblíž nádražní budově, čísla rostou na západ) a přiřazení čísel kolejí,
#    které potvrdil uživatel podle schématu Staničáře (1 a 2 = sousední průjezdné koleje mezi ostrovními nástupišti, 5 mezi budovou a ostrovem)
#  - pravidla obsazení z GVD 15/16 ve stanici hry Staničář (soubor STANICAR_XML, cesta níže): (směr příjezdu, směr odjezdu) -> četnosti kolejí
#    Směry: ONL Pardubice (JV), OPL Praha/Chlumec (JZ), PNL Jaroměř (S), HSP Slezské Předměstí/Choceň (V), VSE Všestary/Jičín (SZ), V = vlak vzniká / končí
# python nastroje/vlaky_koleje.py   (z kořene izomapa/)
import collections, json, os, sys
sys.path.insert(0, '.')
import numpy as np, pyarrow.parquet as pq, shapely
import xml.etree.ElementTree as ET
from shapely.geometry import LineString, Point
from shapely.ops import transform
from geo import to_local

STANICAR_XML = os.environ.get('STANICAR_XML', r'C:\Users\pavel\Desktop\stanicar-komplet\Staničář-komplet\Stanice\HK_1-01.xml')
LON, LAT = 15.8100, 50.2139
# E1..E12 (od budovy na západ) -> číslo koleje. E1 = hrana východního nástupiště (3a), E2 = 3, E3 = 5, E4 = 1, E5 = 2, E6 = 6, dál 8, 10, 12 ...
CISLA = ['3a', '3', '5', '1', '2', '6', '8', '10', '12', '14', '16', '18']

loc = lambda g: transform(lambda a, b, z=None: to_local(a, b), shapely.from_wkb(g))
cx, cy = (float(v) for v in to_local(LON, LAT))
t = pq.read_table('data_all/segment.parquet').to_pandas()
rails = [loc(r.geometry) for _, r in t.iterrows() if r['subtype'] == 'rail' and r['class'] in ('standard_gauge', 'unknown')]
rails = [g for g in rails if g.distance(Point(cx, cy)) < 260]
inf = pq.read_table('data_all/infrastructure.parquet').to_pandas()
plats = [loc(r.geometry) for _, r in inf.iterrows() if r['class'] == 'platform']
plats = [p for p in plats if p.geom_type == 'Polygon' and p.area > 300 and p.distance(Point(cx, cy)) < 300]
P = max(plats, key=lambda p: p.length)
c = np.array(P.centroid.coords[0]); ax = np.array([0.1663, 0.98607]); nr = np.array([-ax[1], ax[0]])   # osa = na sever, normála = na západ
o = c + ax * -30; L = LineString([o - nr * 70, o + nr * 70])
items = []
for g in rails:
    x = g.intersection(L)
    if x.is_empty: continue
    for p in ([x] if x.geom_type == 'Point' else list(x.geoms)):
        items.append((float(np.dot(np.array(p.coords[0]) - o, nr)), g))
items.sort(key=lambda a: a[0])
koleje = {}
for i, (off, g) in enumerate(items[:len(CISLA)]):
    pt = g.interpolate(g.project(Point(*c)))                     # místo zastavení = střed nástupiště
    koleje[CISLA[i]] = {'e': i + 1, 'coords': [[round(a, 2), round(b, 2)] for a, b in g.coords], 'stop': [round(pt.x, 2), round(pt.y, 2)], 'delka': round(g.length)}
print('kolejí', len(koleje), sorted(koleje, key=lambda k: koleje[k]['e']))

# pravidla obsazení z GVD
pravidla = collections.defaultdict(collections.Counter)
if os.path.exists(STANICAR_XML):
    r = ET.parse(STANICAR_XML).getroot()
    for tr in r.find('gvd').find('trains'):
        if tr.get('typ') not in ('Os', 'Sp', 'R', 'Ex', 'EC', 'EN', 'Ruš.Os', 'Ruš.Sp'): continue
        a = tr.get('smerprijezdu') or 'V'; b = tr.get('smer') or 'V'
        if not a.isalpha() or a not in ('ONL', 'OPL', 'PNL', 'HSP', 'VSE', 'V'): a = 'V'
        if b not in ('ONL', 'OPL', 'PNL', 'HSP', 'VSE'): b = 'V'
        for z in tr.find('zastavky'):
            if z.get('st') == 'HHN' and z.get('kol'): pravidla[a + '>' + b][z.get('kol')] += 1
else: print('Staničář XML nenalezen, pravidla se nepřepíšou')
out = {'koleje': koleje, 'pravidla': {k: dict(v.most_common()) for k, v in pravidla.items()}}
if not pravidla and os.path.exists('assets/vlaky_koleje.json'): out['pravidla'] = json.load(open('assets/vlaky_koleje.json', encoding='utf-8'))['pravidla']
json.dump(out, open('assets/vlaky_koleje.json', 'w', encoding='utf-8'), ensure_ascii=False)
print('pravidel', len(out['pravidla']), {k: v for k, v in list(out['pravidla'].items())[:6]})
