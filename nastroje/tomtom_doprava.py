"""Doprava z TomTom Traffic Flow (vektorové dlaždice, styl relative): druhý zdroj vedle HERE, hlavně na hustší pokrytí ulic.

python nastroje/tomtom_doprava.py registr   # stáhne dlaždice a doplní assets/tomtom_segmenty.json (stálá čísla úseků), vypíše kontrolu směru
python nastroje/tomtom_doprava.py ids       # přidá klíče TomTom do site/doprava_id.json (po `here_doprava.py ids`)

Úsek = jedna lomená čára z dlaždice (z TZ), klíč `t<z>/<x>/<y>/<px>,<py>,<počet bodů>` z celočíselných souřadnic dlaždice, takže ho stejně
spočítá Python (tady) i Node (skripty/doprava_sber.mjs, GitHub Actions). traffic_level (0–1) = aktuální / volná rychlost; jamFactor ×10 = (1 - level) * 100,
rychlost % = level * 100 (stejný tvar jako u HERE: [jam×10, rychlost %]). Čísla úseků TomTom mají posun ID_POSUN, ať se nepletou s HERE.
Klíč: proměnná TOMTOM_API_KEY, jinak soubor tomtomapi.txt (apikey="…") v kořeni repa nebo o složku výš. Do gitu nepatří.
Podmínky TomTom: data neukládat mimo krátkou cache, proto se z TomTom nesbírá historie (typické špičky jen z HERE).
"""
import json, math, os, re, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REG = os.path.join(ROOT, 'assets', 'tomtom_segmenty.json')
BBOX = (15.785, 50.175, 15.885, 50.245)        # west, south, east, north
TZ = 14                                        # zoom dlaždic (z13 slučuje úseky do dlouhých čar, z14 je přiměřeně podrobné)
ID_POSUN = 1_000_000


def klic_api():
    k = os.environ.get('TOMTOM_API_KEY')
    if k: return k.strip()
    for d in (ROOT, os.path.dirname(ROOT)):
        f = os.path.join(d, 'tomtomapi.txt')
        if os.path.exists(f):
            m = re.search(r'"([^"]+)"', open(f, encoding='utf-8').read())
            if m: return m.group(1)
    sys.exit('Chybí klíč TomTom: nastav TOMTOM_API_KEY nebo vytvoř tomtomapi.txt s řádkem apikey="…".')


def dlazdice(bbox=BBOX, z=TZ):
    n = 2 ** z
    tx = lambda lon: int((lon + 180) / 360 * n)
    ty = lambda lat: int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return [(z, x, y) for x in range(tx(bbox[0]), tx(bbox[2]) + 1) for y in range(ty(bbox[3]), ty(bbox[1]) + 1)]


def lonlat(z, x, y, px, py, ext=4096):
    n = 2 ** z
    lon = (x + px / ext) / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + py / ext) / n))))
    return lon, lat


def stahni_dlazdici(z, x, y, klic=None):
    u = f'https://api.tomtom.com/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.pbf?key={klic or klic_api()}'
    return urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'izomapa-doprava/1.0'}), timeout=30).read()


def useky(z, x, y, data):
    """z těla dlaždice: [(klíč, [(px, py), …], traffic_level, road_type)] pro každou lomenou čáru (MultiLineString se rozdělí)"""
    import mapbox_vector_tile as mvt
    out = []
    d = mvt.decode(data, default_options={'y_coord_down': True}).get('Traffic flow', {}).get('features', [])
    for f in d:
        p = f['properties']
        if p.get('road_closure') or 'traffic_level' not in p: continue
        g = f['geometry']
        lines = g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']] if g['type'] == 'LineString' else []
        for ln in lines:
            pts = [(int(a), int(b)) for a, b in ln]
            if len(pts) < 2: continue
            out.append((f't{z}/{x}/{y}/{pts[0][0]},{pts[0][1]},{len(pts)}', pts, float(p['traffic_level']), p.get('road_type', '')))
    return out


def stahni_vse(z=TZ):
    k = klic_api(); res = []
    for (zz, x, y) in dlazdice(z=z):
        res += useky(zz, x, y, stahni_dlazdici(zz, x, y, k))
    return res


def registr():
    return json.load(open(REG, encoding='utf-8')) if os.path.exists(REG) else {'seg': []}


def doplnit_registr(sg):
    sys.path.insert(0, ROOT)
    import geo
    reg = registr(); ids = {s['k']: i for i, s in enumerate(reg['seg'])}; nove = 0
    for k, pts, _lv, rt in sg:
        if k in ids: continue
        m = re.match(r't(\d+)/(\d+)/(\d+)/', k); z, x, y = (int(v) for v in m.groups())
        ll = [lonlat(z, x, y, a, b) for a, b in pts]
        xs, ys = geo.to_local([p[0] for p in ll], [p[1] for p in ll])
        ids[k] = len(reg['seg']); nove += 1
        reg['seg'].append({'k': k, 'n': rt, 'w': [[round(float(a), 1), round(float(b), 1)] for a, b in zip(xs, ys)]})
    if nove:
        json.dump(reg, open(REG, 'w', encoding='utf-8'), separators=(',', ':'), ensure_ascii=False)
    return ids, nove




def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'registr':
        sg = stahni_vse(); ids, nove = doplnit_registr(sg)
        print(f'úseků v dlaždicích {len(sg)}, nových v registru {nove}, celkem {len(ids)}')
    elif cmd == 'ids':
        f = os.path.join(ROOT, 'site', 'doprava_id.json'); d = json.load(open(f)) if os.path.exists(f) else {}
        for i, s in enumerate(registr()['seg']): d[s['k']] = ID_POSUN + i
        json.dump(d, open(f, 'w'), separators=(',', ':')); print('klíčů celkem', len(d))
    else: sys.exit(__doc__)


if __name__ == '__main__':
    main()
