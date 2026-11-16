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

import hashlib, math
HL_N = 'Hradec Králové hlavní nádraží'
_hk = next((st_pos[p] for p, n in st_name.items() if n == HL_N), None)
def smer_gtfs(jmeno, sid):
    if jmeno in ('Hradec Králové-Kukleny', 'Praskačka'): return 'OPL'
    lo, la = st_pos[sid]; a = math.degrees(math.atan2((lo - _hk[0]) * 71500, (la - _hk[1]) * 110574)) % 360
    return 'PNL' if a < 45 or a >= 355 else 'HSP' if a < 135 else 'ONL' if a < 215 else 'OPL' if a < 290 else 'VSE'
VYL = None; VYL_ST = {'Předměřice nad Labem', 'Smiřice', 'Jaroměř', 'Lochenice', 'Černožice', 'Semonice', 'Česká Skalice'}
if os.path.exists('assets/vyluka_odjezdy.json'):
    _p = json.load(open('assets/vyluka_odjezdy.json', encoding='utf-8'))['platnost']
    VYL = (datetime.date.fromisoformat(_p['od']), datetime.date.fromisoformat(_p['do']))
out, kj, pouzite = [], collections.Counter(), set()
for tid in sorted(dotyk, key=int):
    t = trips[tid]; r = routes[t['route_id']]; pts = sorted(seq[tid])
    body = []
    for _, sid, a, d, pu, do in pts:
        if sid not in st_pos: continue
        ta, td = sec(a), sec(d)
        body.append([st_name[sid], sid, ta, td, 0 if (pu == '1' and do == '1') else 1])
        pouzite.add(sid)
    if len(body) < 2: continue
    bm = bitmap(t['service_id'])
    # výluka HK hl.n. – Jaroměř: vlaky přes tento úsek v době výluky nejedou (nahrazuje je NAD, nastroje/vyluka_nad.py)
    if VYL and any(q[0] == 'Hradec Králové hlavní nádraží' for q in body) and any(q[0] in VYL_ST for q in body):
        bm = ''.join('0' if VYL[0] <= (dnes + datetime.timedelta(days=i)) <= VYL[1] else b_ for i, b_ in enumerate(bm))
    if '1' not in bm: continue
    dop = ag.get(r['agency_id'], '')
    # model soupravy: dopravce, druh a směr (Pardubice je elektrifikované, ostatní motorové), variabilita podle čísla vlaku
    h_ = int(hashlib.md5((r['route_short_name'] + (t.get('trip_short_name') or '') + t['trip_id']).encode()).hexdigest(), 16) % 100
    # skutečné soupravy (průzkum GVD 2025/26): R10 Praha–HK–Trutnov = lokomotiva 362 + 5 vozů, Arriva R14A = řada 845, Sp = RegioFox 847,
    # Os Pardubice–Jaroměř = RegioPanter (třídílný), Os Chlumec n. C. – Kolín = RegioPanter 650 (dvoučlánkový), východní větve = RegioFox / RegioPanter
    jm = [q[0] for q in body]
    ma = lambda ks: any(k in n for n in jm for k in ks)
    if 'ARRIVA' in dop.upper(): model = 'dmu845'
    elif druh(r['route_short_name']) in ('157', '122', '63', '69', '50'):
        model = ('rychlik4' if h_ < 80 else 'rychlik') if ma(('Praha', 'Kolín', 'Pardubice')) else 'regiofox'
    elif ma(('Chlumec nad Cidlinou', 'Velký Osek', 'Kolín')): model = 'regiopanter'
    elif ma(('Pardubice',)): model = 'regiopanter3' if h_ < 70 else 'regiofox'
    elif ma(('Týniště', 'Choceň', 'Letohrad', 'Rychnov', 'Náchod', 'Broumov', 'Meziměstí', 'Hronov', 'Častolovice')): model = 'regiofox' if h_ < 80 else 'regiopanter'
    else: model = 'regiofox' if h_ < 75 else 'regiopanter3'
    out.append({'cislo': r['route_short_name'] + ' ' + (t.get('trip_short_name') or t['trip_id']), 'druh': druh(r['route_short_name']), 'typ': '11', 'dop': dop_kod(dop),
                'model': model, 'bitmap': bm, 'od': dnes.isoformat() + 'T00:00:00', 'do': dny[-1].isoformat() + 'T00:00:00', 'body': body, 'dopravce': dop, 'headsign': t['trip_headsign']})
    kj[(druh(r['route_short_name']), dop)] += 1
# ---- kolej ve stanici HK hl.n.: pravidla z GVD (směr příjezdu a odjezdu), bez kolizí na téže koleji ve stejný čas ----
import math
HL = 'Hradec Králové hlavní nádraží'
KOL = json.load(open('assets/vlaky_koleje.json', encoding='utf-8')) if os.path.exists('assets/vlaky_koleje.json') else None
if KOL:
    hk = next((st_pos[p] for p, n in st_name.items() if n == HL), None)
    def smer(jmeno, sid):
        if jmeno in ('Hradec Králové-Kukleny', 'Praskačka'): return 'OPL'
        lo, la = st_pos[sid]; a = math.degrees(math.atan2((lo - hk[0]) * 71500, (la - hk[1]) * 110574)) % 360
        return 'PNL' if a < 45 or a >= 355 else 'HSP' if a < 135 else 'ONL' if a < 215 else 'OPL' if a < 290 else 'VSE'
    sid_of = {n: p for p, n in st_name.items()}
    prav = KOL['pravidla']; PORADI = ['1', '2', '5', '6', '8', '10', '12', '3', '3a']
    obs = collections.defaultdict(list)                         # kolej -> [(bitmap jako int, od, do)]
    def volna(k, bm, od_, do_):
        return not any(b2 & bm and od_ < d2 + 90 and o2 < do_ + 90 for b2, o2, d2 in obs[k])
    seznam = []
    for v_ in out:
        for i, q in enumerate(v_['body']):
            if q[0] == HL: seznam.append((q[2], v_, i))
    for ta, v_, i in sorted(seznam, key=lambda x: x[0]):
        b_ = v_['body']; q = b_[i]
        a_ = smer(b_[i - 1][0], b_[i - 1][1]) if i > 0 else 'V'; c_ = smer(b_[i + 1][0], b_[i + 1][1]) if i + 1 < len(b_) else 'V'
        zast = q[4] == 1
        if not zast:                                             # průjezd: hlavní koleje, na sever 2, na jih 1
            kand = ['2', '1'] if a_ in ('ONL', 'OPL') else ['1', '2']
        else:
            kand = list(prav.get(a_ + '>' + c_, {}))
            if len(kand) < 2:                                      # pravidlo chybí/je málo: sečíst pravidla se stejným příjezdem nebo odjezdem
                cn = collections.Counter()
                for kk, vv in prav.items():
                    x, y = kk.split('>')
                    if (x == a_ and a_ != 'V') or (y == c_ and c_ != 'V'):
                        for k_, n_ in vv.items(): cn[k_] += n_
                kand += [k_ for k_, _ in cn.most_common() if k_ not in kand]
            kand += [k_ for k_ in PORADI if k_ not in kand]
        kand = [k_ for k_ in kand if k_ in KOL['koleje']]
        bm = int(v_['bitmap'][::-1], 2); od_, do_ = q[2], q[3] if q[3] >= q[2] else q[2]
        if i == 0: od_ -= 300                                    # vlak vzniká v HK: stojí na koleji ~5 min před odjezdem
        if i + 1 == len(b_): do_ += 420                           # vlak v HK končí: zůstane stát ~7 min
        kol = next((k_ for k_ in kand if volna(k_, bm, od_, do_)), kand[0])
        obs[kol].append((bm, od_, do_)); q.append(kol)
        v_.setdefault('kolej', {})[HL] = kol; v_['smery'] = a_ + '>' + c_
    print('koleje v HK hl.n.:', collections.Counter(v_['kolej'][HL] for v_ in out if 'kolej' in v_).most_common())
json.dump(out, open('build/vlaky/vlaky.json', 'w', encoding='utf-8'), ensure_ascii=False)
# stanice (jméno -> [lon, lat]) – ze všech zastávek vlaků, pro vlaky.py (nahrazuje dotaz na Overture)
json.dump({st_name[p]: list(st_pos[p]) for p in pouzite}, open('build/vlaky/stanice.json', 'w', encoding='utf-8'), ensure_ascii=False)
print(len(out), 'vlaků,', len(pouzite), 'stanic'); print(kj.most_common(12))
