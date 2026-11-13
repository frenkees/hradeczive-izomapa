# počet jízdních pruhů z OpenStreetMap (Overpass, ODbL, bez registrace) -> assets/pruhy.json
# Overture počet pruhů nemá. prep.py je přiřadí kusům silnic (r['n'] = [pruhů po směru kusu, proti směru]) a web/app.html
# pak na jednosměrném pásu se dvěma pruhy (městský okruh, rozdělená silnice) pustí auta vedle sebe, ne v jedné řadě uprostřed.
# Formát: [{"g": [[lat, lon], …], "f": pruhů po směru cesty v OSM, "b": proti směru}] jen pro cesty, kde je některý směr víc než 1.
# spouštět z kořene repa: python nastroje/pruhy.py
import json, math, re, subprocess, sys; sys.path.insert(0, '.')

TRIDY = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential'


def _n(v):
    m = re.match(r'\s*(\d+)', str(v or ''))
    return int(m.group(1)) if m else None


def pruhy(tags):
    """(po směru cesty, proti směru) pro auta z OSM tagů, nebo None, když lanes chybí"""
    n = _n(tags.get('lanes'))
    if not n: return None
    ow = tags.get('oneway')
    if tags.get('junction') in ('roundabout', 'circular') and ow is None: ow = 'yes'
    bus = (_n(tags.get('lanes:bus')) or 0) + (_n(tags.get('lanes:psv')) or 0)
    if ow in ('yes', 'true', '1'):
        return max(1, n - bus), 0
    if ow == '-1':
        return 0, max(1, n - bus)
    f, b = _n(tags.get('lanes:forward')), _n(tags.get('lanes:backward'))
    if f is None and b is None: f = b = max(1, n // 2)
    elif f is None: f = max(1, n - b)
    elif b is None: b = max(1, n - f)
    f -= min(f - 1, _n(tags.get('lanes:bus:forward')) or _n(tags.get('lanes:psv:forward')) or 0)
    b -= min(b - 1, _n(tags.get('lanes:bus:backward')) or _n(tags.get('lanes:psv:backward')) or 0)
    return f, b


if __name__ == '__main__':
    import geo
    x0, y0, x1, y1 = geo.extent(geo.MARGIN + 20)
    lo0, la0 = geo.to_lonlat(x0, y0); lo1, la1 = geo.to_lonlat(x1, y1); bb = f'{la0},{lo0},{la1},{lo1}'
    q = f'[out:json][timeout:120];way["highway"~"^({TRIDY})(_link)?$"]["lanes"]({bb});out tags geom;'
    for url in ('https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'):
        r = subprocess.run(['curl', '-s', '-f', '-m', '180', '-A', 'izomapa-tools/1.0', '--data-urlencode', f'data={q}', url], capture_output=True, text=True)
        if r.returncode == 0: t = r.stdout; break
        print('Overpass', url, 'chyba', r.returncode)
    else: sys.exit('Overpass nedostupný, zkus později')
    out, n_all = [], 0
    for e in json.loads(t)['elements']:
        n_all += 1
        p = pruhy(e.get('tags', {}))
        if not p or max(p) < 2 or len(e.get('geometry', [])) < 2: continue
        out.append({'g': [[round(g['lat'], 6), round(g['lon'], 6)] for g in e['geometry']], 'f': p[0], 'b': p[1]})
    json.dump(out, open('assets/pruhy.json', 'w'), separators=(',', ':'))
    km = sum(sum(math.dist(*(geo.to_local(lo, la) for la, lo in (a, b))) for a, b in zip(o['g'], o['g'][1:])) for o in out) / 1000
    print('cest s počtem pruhů', n_all, 'víceproudých', len(out), f'({km:.1f} km)')
