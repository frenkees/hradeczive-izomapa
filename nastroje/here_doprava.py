"""Doprava z HERE Traffic API v7 (/flow): živé zácpy a typické špičky na ulicích mapy.

python nastroje/here_doprava.py snimek     # stáhne aktuální stav celého města, přidá ho do historie (build/here/historie.jsonl)
python nastroje/here_doprava.py typicka    # z historie spočítá typickou vytíženost podle hodiny a dne (site/doprava_typicka.json)
python nastroje/here_doprava.py ids        # site/doprava_id.json (klíč úseku -> číslo), pro prohlížeč

HERE flow nedává počty aut, jen rychlost a míru zácpy (jamFactor 0–10) na úsecích silnic podle směru jízdy.
Hustotu aut proto řídí prohlížeč: základ ze sčítání ŘSD, HERE ji zvyšuje (a zpomaluje auta) tam, kde se stojí.
Typické špičky nejde z jednoho stažení poznat: sbírají se snímky (`snimek`, doporučeno každých 10–15 min, aspoň 2 týdny).

Klíč: proměnná HERE_API_KEY, jinak soubor api_here.txt (řádek key="…") v kořeni repa nebo o složku výš. Do gitu nepatří.
Úseky mají v assets/here_segmenty.json stálá čísla (klíč = první bod + délka), nové se jen přidávají.
`prirad(roads)` (volá overlay.py) přidá silnicím `h`: seznam čísel úseků HERE, které na ně sedí (číslo * 2 + 1 = úsek jede proti směru kusu).
"""
import json, math, os, re, sys, time, urllib.request, urllib.parse, statistics
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REG = os.path.join(ROOT, 'assets', 'here_segmenty.json')
HIST = os.path.join(ROOT, 'build', 'here', 'historie.jsonl')
BBOX = (15.785, 50.175, 15.885, 50.245)       # west, south, east, north: celé město (CLAUDE.md)


def klic_api():
    k = os.environ.get('HERE_API_KEY')
    if k: return k.strip()
    for d in (ROOT, os.path.dirname(ROOT)):
        f = os.path.join(d, 'api_here.txt')
        if os.path.exists(f):
            m = re.search(r'key\s*=\s*"([^"]+)"', open(f, encoding='utf-8').read())
            if m: return m.group(1)
    sys.exit('Chybí klíč HERE: nastav HERE_API_KEY nebo vytvoř api_here.txt s řádkem key="…".')


def stahni(bbox=BBOX):
    q = urllib.parse.urlencode({'in': 'bbox:%s,%s,%s,%s' % bbox, 'locationReferencing': 'shape', 'apiKey': klic_api()}, safe=':,')
    req = urllib.request.Request('https://data.traffic.hereapi.com/v7/flow?' + q, headers={'User-Agent': 'izomapa-doprava/1.0'})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())


def klic(r):
    """stálý klíč úseku: první bod a délka"""
    ls = r['location']['shape']['links']; p = ls[0]['points'][0]
    return '%.5f,%.5f,%d' % (p['lat'], p['lng'], round(r['location'].get('length', 0)))


def body(r):
    out = []
    for l in r['location']['shape']['links']:
        for p in l['points']:
            if not out or (p['lat'], p['lng']) != out[-1]: out.append((p['lat'], p['lng']))
    return out


def registr():
    return json.load(open(REG, encoding='utf-8')) if os.path.exists(REG) else {'seg': []}


def doplnit_registr(data):
    """přidá nové úseky z odpovědi HERE (do místních souřadnic mapy) a vrátí slovník klíč -> číslo"""
    sys.path.insert(0, ROOT)
    import geo
    reg = registr(); ids = {s['k']: i for i, s in enumerate(reg['seg'])}; nove = 0
    for r in data.get('results', []):
        k = klic(r)
        if k in ids: continue
        pts = body(r)
        if len(pts) < 2: continue
        xs, ys = geo.to_local([p[1] for p in pts], [p[0] for p in pts])
        ids[k] = len(reg['seg']); nove += 1
        reg['seg'].append({'k': k, 'n': r['location'].get('description', ''), 'w': [[round(float(x), 1), round(float(y), 1)] for x, y in zip(xs, ys)]})
    if nove:
        os.makedirs(os.path.dirname(REG), exist_ok=True)
        json.dump(reg, open(REG, 'w', encoding='utf-8'), separators=(',', ':'), ensure_ascii=False)
    return ids, nove


def snimek_z(data, ids):
    s = {}
    for r in data.get('results', []):
        f = r.get('currentFlow') or {}
        i = ids.get(klic(r))
        if i is None or 'jamFactor' not in f: continue
        ff = f.get('freeFlow') or 0
        s[i] = [round(f['jamFactor'] * 10), round(100 * min(1.0, (f.get('speed') or 0) / ff)) if ff else 100]
    return s


def snimek():
    data = stahni()
    ids, nove = doplnit_registr(data)
    s = snimek_z(data, ids)
    os.makedirs(os.path.dirname(HIST), exist_ok=True)
    with open(HIST, 'a', encoding='utf-8') as f:
        f.write(json.dumps({'t': data.get('sourceUpdated') or datetime.now(timezone.utc).isoformat(), 's': s}, separators=(',', ':')) + '\n')
    print(f'úseků {len(s)} (nových v registru {nove}), snímek uložen do {os.path.relpath(HIST, ROOT)}')


def typicka():
    """medián jamFactor (×10) podle hodiny v pražském čase, zvlášť pracovní den [0..23] a víkend [24..47]"""
    if not os.path.exists(HIST): sys.exit('Zatím žádná historie, spusť nejdřív snimek.')
    praha = ZoneInfo('Europe/Prague'); hod = {}; n = 0
    for ln in open(HIST, encoding='utf-8'):
        try: d = json.loads(ln)
        except ValueError: continue
        t = datetime.fromisoformat(d['t'].replace('Z', '+00:00')).astimezone(praha); n += 1
        sl = t.hour + (24 if t.weekday() >= 5 else 0)
        for i, (jam, _r) in d['s'].items(): hod.setdefault(int(i), {}).setdefault(sl, []).append(jam)
    out = {}
    for i, h in hod.items():
        v = [round(statistics.median(h[k])) if len(h.get(k, [])) >= 2 else None for k in range(48)]
        if any(x is not None for x in v): out[i] = v
    os.makedirs(os.path.join(ROOT, 'site'), exist_ok=True)
    json.dump({'n': n, 's': out}, open(os.path.join(ROOT, 'site', 'doprava_typicka.json'), 'w'), separators=(',', ':'))
    print(f'snímků {n}, úseků s typickým průběhem {len(out)} (hodina bez aspoň 2 snímků zůstává prázdná)')


def ids_json():
    reg = registr()
    os.makedirs(os.path.join(ROOT, 'site'), exist_ok=True)
    json.dump({s['k']: i for i, s in enumerate(reg['seg'])}, open(os.path.join(ROOT, 'site', 'doprava_id.json'), 'w'), separators=(',', ':'))
    print('úseků v registru', len(reg['seg']))


def prirad(roads, tol=8.0):
    """silnicím z overlay.py (r['w'] ve společných souřadnicích) přidá r['h'] podle úseků HERE a TomTom (nastroje/tomtom_doprava.py, čísla s posunem);
    vrací počet přiřazených silnic. Na jednosměrkách se bere jen úsek ve směru jízdy; počty shod a neshod směru (kontrola, že pořadí bodů úseku
    sleduje směr jízdy) vypíše do prirad.stat."""
    import shapely
    from shapely.geometry import LineString
    from shapely.strtree import STRtree
    zdroje = []
    if os.path.exists(REG) and registr()['seg']: zdroje.append(('here', registr()['seg'], 0))
    try:
        import tomtom_doprava as _tt
        if os.path.exists(_tt.REG) and _tt.registr()['seg']: zdroje.append(('tomtom', _tt.registr()['seg'], _tt.ID_POSUN))
    except ImportError: pass
    if not zdroje: return 0
    prep = [(nm, [LineString(s['w']) for s in reg], off) for nm, reg, off in zdroje]
    trees = [STRtree(ls) for _, ls, _ in prep]
    prirad.stat = {nm: [0, 0] for nm, _, _ in prep}; ok = 0
    for r in roads:
        w = r.get('w') or []
        if len(w) < 2 or r.get('c') in ('service', 'track', 'footway', 'path', 'cycleway', 'steps', 'pedestrian'): continue
        rl = LineString([(p[0], p[1]) for p in w])
        if rl.length < 3: continue
        zona = rl.buffer(tol); h = []
        for (nm, lines, off), tree in zip(prep, trees):
            for i in tree.query(zona):
                sl = lines[i]
                ov = sl.intersection(zona).length                     # kolik úseku leží na této silnici
                if ov < min(0.5 * rl.length, 0.5 * sl.length, 40): continue
                a0, a1 = rl.project(shapely.Point(sl.coords[0])), rl.project(shapely.Point(sl.coords[-1]))
                if abs(a1 - a0) < 3: continue
                proti = a1 < a0
                if r.get('o'):
                    shoda = proti == (r['o'] < 0); prirad.stat[nm][0 if shoda else 1] += 1
                    if not shoda: continue                             # jednosměrka: jen úsek ve směru jízdy
                h.append((off + int(i)) * 2 + (1 if proti else 0))
        if h: r['h'] = sorted(set(h)); ok += 1
    return ok


if __name__ == '__main__':
    {'snimek': snimek, 'typicka': typicka, 'ids': ids_json}.get(sys.argv[1] if len(sys.argv) > 1 else '', lambda: sys.exit(__doc__))()
