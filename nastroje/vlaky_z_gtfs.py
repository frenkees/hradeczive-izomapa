# Vlaky z celostátního GTFS (CIS JŘ, build/gtfs.zip) -> build/vlaky/vlaky.json (stejný formát jako nastroje/vlaky_vyber.py) + build/vlaky/stanice.json
# Pak: python nastroje/vlaky.py (trasy po kolejích) a python mhd.py (přidá vlaky k MHD).
# Vybere osobní vlaky (route_type 2), které mají zastávku ve stanici na mapě (části názvů v mesto.json "vlaky_stanice", jinak oblast mapy),
# s celou posloupností zastávek (kvůli směru příjezdu a odjezdu) a kalendářem na DNY dní dopředu.
import collections, csv, datetime, io, json, os, re, sys, zipfile
sys.path.insert(0, '.')
from geo import MESTO, bbox_lonlat

DNY = 75
Z = 'build/gtfs.zip'
os.makedirs('build/vlaky', exist_ok=True)
zf = zipfile.ZipFile(Z)
T = lambda n: csv.DictReader(io.TextIOWrapper(zf.open(n + '.txt'), encoding='utf-8-sig'))
sec = lambda t: (lambda h, m, s: h * 3600 + m * 60 + s)(*map(int, t.split(':')))
X0, X1, Y0, Y1 = bbox_lonlat(150.0)

# druh vlaku podle zkratky linky (kódy jako ve vlaky.py DRUH): Os 84, Sp 122, R 157, Ex 69, IC 63, EC 50, rj 209, Rx 9000, LE 9003
def druh(short):
    s = (short or '').strip()
    m = re.match(r'^(EC|IC|EN|Ex|SC|Rx|rj|RJ|LE|Sp|R|Os|S|U|RB|REX|TL|TLX)', s)
    k = m.group(1) if m else 'Os'
    return {'EC': '50', 'IC': '63', 'EN': '70', 'Ex': '69', 'SC': '94', 'Sp': '122', 'R': '157', 'rj': '209', 'Rx': '9000', 'LE': '9003',
            'RJ': '9004', 'TL': '9002', 'TLX': '9001'}.get(k, '84')


ag = {a['agency_id']: a['agency_name'] for a in T('agency')}
dop_kod = lambda n: '1154' if 'České dráhy' in n else '3246' if 'RegioJet' in n else '3990' if 'Leo' in n else '1251' if 'Arriva' in n else '1156'

routes = {r['route_id']: r for r in T('routes') if r['route_type'] == '2'}
# stanice na mapě: zastávky (nadřazené) s polohou v oblasti
st_pos, st_name = {}, {}
for s in T('stops'):
    if s['location_type'] == '1' or not s['parent_station']:
        p = s['stop_id']
        st_name[p] = s['stop_name']
        if s['stop_lat']: st_pos[p] = (float(s['stop_lon']), float(s['stop_lat']))
par = lambda sid: sid.split('.')[0]
na_mape = {p for p, (lo, la) in st_pos.items() if X0 <= lo <= X1 and Y0 <= la <= Y1}
# jen skutečné železniční stanice: mají aspoň jeden vlak (zjistí se níž); autobusové zastávky v HK vlaky nemají
trips = {t['trip_id']: t for t in T('trips') if t['route_id'] in routes}
print('vlakových spojů v řádu', len(trips))
dotyk = set()
for r in T('stop_times'):
    if r['trip_id'] in trips and par(r['stop_id']) in na_mape: dotyk.add(r['trip_id'])
print('spojů přes oblast mapy', len(dotyk))
seq = collections.defaultdict(list)
for r in T('stop_times'):
    if r['trip_id'] in dotyk:
        seq[r['trip_id']].append((int(r['stop_sequence']), par(r['stop_id']), r['arrival_time'], r['departure_time'], r['pickup_type'], r['drop_off_type']))

# kalendář -> bitmapa dní od dneška
dnes = datetime.date.today()
dny = [dnes + datetime.timedelta(days=i) for i in range(DNY)]
cal = {c['service_id']: c for c in T('calendar')}
exc = collections.defaultdict(dict)
for e in T('calendar_dates'): exc[e['service_id']][e['date']] = e['exception_type']
def bitmap(sid):
    c = cal.get(sid); out = ''
    for d in dny:
        k = d.strftime('%Y%m%d'); on = False
        if c and c['start_date'] <= k <= c['end_date'] and c[['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'][d.weekday()]] == '1': on = True
        e = exc.get(sid, {}).get(k)
        if e == '1': on = True
        elif e == '2': on = False
        out += '1' if on else '0'
    return out

out, kj, pouzite = [], collections.Counter(), set()
for tid in dotyk:
    t = trips[tid]; r = routes[t['route_id']]; pts = sorted(seq[tid])
    body = []
    for _, sid, a, d, pu, do in pts:
        if sid not in st_pos: continue
        ta, td = sec(a), sec(d)
        body.append([st_name[sid], sid, ta, td, 0 if (pu == '1' and do == '1') else 1])
        pouzite.add(sid)
    if len(body) < 2: continue
    bm = bitmap(t['service_id'])
    if '1' not in bm: continue
    dop = ag.get(r['agency_id'], '')
    out.append({'cislo': r['route_short_name'] + ' ' + (t.get('trip_short_name') or t['trip_id']), 'druh': druh(r['route_short_name']), 'typ': '11', 'dop': dop_kod(dop),
                'bitmap': bm, 'od': dnes.isoformat() + 'T00:00:00', 'do': dny[-1].isoformat() + 'T00:00:00', 'body': body, 'dopravce': dop, 'headsign': t['trip_headsign']})
    kj[(druh(r['route_short_name']), dop)] += 1
json.dump(out, open('build/vlaky/vlaky.json', 'w', encoding='utf-8'), ensure_ascii=False)
# stanice (jméno -> [lon, lat]) – ze všech zastávek vlaků, pro vlaky.py (nahrazuje dotaz na Overture)
json.dump({st_name[p]: list(st_pos[p]) for p in pouzite}, open('build/vlaky/stanice.json', 'w', encoding='utf-8'), ensure_ascii=False)
print(len(out), 'vlaků,', len(pouzite), 'stanic'); print(kj.most_common(12))
