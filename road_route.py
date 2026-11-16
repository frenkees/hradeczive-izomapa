"""Trasa autobusu mezi zastávkami po silnicích z dat mapy (pro GTFS bez shapes.txt, např. IDS JMK).

Graf = vrcholy segmentů Overture (subtype road, jen sjízdné třídy), zhuštěné po 20 m; uzly se slévají podle souřadnic
zaokrouhlených na 0,5 m. Jednosměrky (access_restrictions, bez výjimky pro autobusy) jsou orientované hrany, takže
na rozdělené silnici (dva pásy) jede autobus po pásu ve svém směru. Zastávka má několik kandidátních uzlů do 80 m
(oba pásy, obě strany křižovatky); vybere se ta posloupnost, která dá nejkratší jízdu (Viterbi přes zastávky).
Zastávka mimo mapu: po silnici k uzlu nejblíž k ní (okraj mapy), dál rovně (to už prohlížeč nekreslí).
Když po jednosměrkách cesta není (chyba v datech), zkusí se bez nich; bez cesty vede úsek rovně.
Koridory (volitelně, path(..., cor=[(uzly, násobek ceny)])): hrany, jejichž oba konce leží v koridoru (např. podél
trasy linky z OSM nebo z mapy dopravce), jsou levnější, takže trasa vede skutečnými ulicemi linky, ne nejkratší cestou.
"""
import heapq
import numpy as np
import pyarrow.parquet as pq
import shapely
import shapely.ops
from shapely.ops import transform
from geo import to_local

COST = {'motorway': 1.0, 'trunk': 1.0, 'primary': 1.0, 'secondary': 1.0, 'tertiary': 1.0,
        'unclassified': 1.2, 'residential': 1.2, 'living_street': 1.5, 'service': 2.0, 'unknown': 1.5}
SNAP = 80.0
CAND = 30.0          # kandidáti zastávky: uzly nejvýš o tolik dál než nejbližší
SNAP_W = 3.0         # cena za metr od zastávky k uzlu (ať se nevybere vzdálená silnice jen kvůli kratší trase)
BUS = {'bus', 'psv', 'trolleybus', 'hgv', 'motor_vehicle', 'vehicle'}


def _none(v):
    return v is None or (not isinstance(v, str) and hasattr(v, '__len__') and len(v) == 0)


def oneway(acc):
    """+1 = jen ve směru geometrie, -1 = jen proti, 0 = obousměrná (pro autobus: výjimka pro bus/psv ruší jednosměrku)"""
    if _none(acc): return 0
    if any(a.get('access_type') == 'allowed' and set((a.get('when') or {}).get('mode') or []) & {'bus', 'psv', 'trolleybus'} for a in acc):
        return 0
    for a in acc:
        w = a.get('when') or {}
        if a.get('access_type') == 'denied' and _none(a.get('between')) and _none(w.get('mode')) and _none(w.get('using')) and _none(w.get('recognized')):
            if w.get('heading') == 'backward': return 1
            if w.get('heading') == 'forward': return -1
    return 0


class Graph:
    def __init__(self, parquet):
        t = pq.read_table(parquet, columns=['subtype', 'class', 'geometry', 'access_restrictions']).to_pylist()
        self.xy, self.idx, self.adj, self.adj_u = [], {}, [], []
        rows = []
        for r in t:
            c = COST.get(r['class'])
            # pěší zóna s povoleným vjezdem autobusů/trolejbusů (např. náměstí před nádražím) patří do grafu MHD
            if r['class'] == 'pedestrian' and any(a.get('access_type') in ('allowed', 'designated') and set((a.get('when') or {}).get('mode') or []) & {'bus', 'psv', 'trolleybus'}
                                                  for a in (r['access_restrictions'] or [])): c = 1.2
            if r['subtype'] != 'road' or c is None: continue
            g = transform(lambda x, y, z=None: to_local(x, y), shapely.from_wkb(r['geometry']))
            for ls in getattr(g, 'geoms', [g]): rows.append((ls, c, oneway(r['access_restrictions']), r['class']))
        # kruhové objezdy data často jednosměrné nemají (stejné pravidlo jako v prep.py): malý kruhový prstenec krátkých
        # úseků, doprava proti směru hodinových ručiček
        short = [ls for ls, _c, _o, k in rows if ls.length < 60 and k != 'service']
        rings = [shapely.geometry.polygon.orient(q, 1.0).exterior for q in shapely.ops.polygonize(shapely.ops.unary_union(short) if short else [])
                 if q.length < 250 and 4 * np.pi * q.area / q.length ** 2 > 0.85 and len(q.exterior.coords) >= 8]
        for k, (ls, c, o, cl) in enumerate(rows):
            if o or ls.length >= 60 or cl == 'service': continue
            for ring in rings:
                if all(ring.distance(shapely.Point(q)) < 0.5 for q in (ls.coords[0], ls.interpolate(0.5, normalized=True).coords[0], ls.coords[-1])):
                    a_, b_ = ring.project(ls.interpolate(0.25, normalized=True)), ring.project(ls.interpolate(0.75, normalized=True))
                    rows[k] = (ls, c, 1 if b_ >= a_ else -1, cl); break
        for ls, c, o, _cl in rows:
            ls = ls.segmentize(20.0)
            ids = [self.node(p) for p in ls.coords]
            for a, b in zip(ids, ids[1:]):
                if a == b: continue
                w = c * float(np.hypot(*np.subtract(self.xy[a], self.xy[b])))
                if o >= 0: self.adj[a].append((b, w))
                if o <= 0: self.adj[b].append((a, w))
                self.adj_u[a].append((b, w)); self.adj_u[b].append((a, w))
        self.arr = np.array(self.xy) if self.xy else np.zeros((0, 2))
        self.fails = self.undirected = 0
        self._cor = []
        self.n_rings = len(rings)

    def node(self, p):
        k = (round(p[0] * 2), round(p[1] * 2))
        if k not in self.idx:
            self.idx[k] = len(self.xy); self.xy.append((float(p[0]), float(p[1]))); self.adj.append([]); self.adj_u.append([])
        return self.idx[k]

    def koridor(self, lines, r=10.0):
        """množina uzlů grafu do r m od čar [[(x, y), …], …]"""
        if not hasattr(self, '_ntree'): self._ntree = shapely.STRtree(shapely.points(self.arr))
        ls = [shapely.LineString(q) for q in lines if len(q) >= 2]
        if not ls: return set()
        return set(int(i) for i in self._ntree.query(shapely.union_all([l.buffer(r, quad_segs=2) for l in ls]), predicate='intersects'))

    def cands(self, p, far=False):
        """{uzel: vzdálenost} kandidátů zastávky do SNAP m (far=True: aspoň nejbližší uzel, i když je dál)"""
        if not len(self.arr): return {}
        d = np.hypot(self.arr[:, 0] - p[0], self.arr[:, 1] - p[1]); i = int(d.argmin())
        if d[i] > SNAP: return {i: float(d[i])} if far else {}
        ok = np.flatnonzero(d <= min(SNAP, d[i] + CAND))
        ok = ok[np.argsort(d[ok])][:60]
        return {int(k): float(d[k]) for k in ok}

    def _leg(self, src, dst, adj):
        """Dijkstra z více zdrojů {uzel: počáteční cena} do kandidátů dst; vrátí (ceny dst, předchůdci)"""
        dist, prev, q = dict(src), {}, [(c, u) for u, c in src.items()]
        heapq.heapify(q)
        a0 = np.mean([self.xy[u] for u in src], axis=0); b0 = np.mean([self.xy[u] for u in dst], axis=0)
        lim = min(src.values()) + 4 * float(np.hypot(*(a0 - b0))) + 500   # objížďka nejvýš ~4×
        left = set(dst)
        cor = self._cor
        while q and left:
            d, u = heapq.heappop(q)
            if d > dist.get(u, 1e18): continue
            if d > lim: break
            left.discard(u)
            for v, w in adj[u]:
                for S, fa in cor:
                    if u in S and v in S: w *= fa; break
                if d + w < dist.get(v, 1e18): dist[v] = d + w; prev[v] = u; heapq.heappush(q, (d + w, v))
        return {u: dist[u] for u in dst if u not in left}, prev

    def path(self, stops, cor=(), exact=None, smer=None):
        """lomená čára přes zastávky [(x, y)] a vzdálenost každé zastávky po ní; self.legs = uzly úseků (None = rovně)"""
        self._cor = list(cor)
        near = [self.cands(p) for p in stops]
        # s koridorem trasy linky: kandidáti zastávky jen na koridoru (do 150 m), ať trasa nedělá výběžky do vedlejších
        # ulic kvůli nepřesné poloze zastávky v jízdním řádu
        S = set().union(*[c for c, fa in self._cor if fa <= 0.3]) if self._cor else set()
        if S:
            for i, p in enumerate(stops):
                if exact and exact[i]: continue             # přesná poloha zastávky (OSM): nejbližší uzly na jejím pásu; relace OSM často vede jen jedním pásem rozdělené silnice
                d = np.hypot(self.arr[:, 0] - p[0], self.arr[:, 1] - p[1])   # (linka 24 u Lipek: zastávky se přichytily k pásu opačného směru a trasa objížděla křižovatku)
                ok = [int(k) for k in np.flatnonzero(d <= 150) if int(k) in S]
                if ok:
                    dm = min(d[k] for k in ok)
                    near[i] = {k: float(d[k]) for k in sorted(ok, key=lambda k: d[k])[:60] if d[k] <= dm + CAND}
        cand = [c if c or not any(q for q in near[max(i - 1, 0):i + 2]) else self.cands(stops[i], True)
                for i, c in enumerate(near)]
        if smer:                                            # zastávka na rozdělené silnici: kandidáti jen z pásu, kde se smí jet ve směru spoje (jinak objížďka a otočka).
            for i, c in enumerate(cand):                    # K uzlům koridoru se přidají uzly do 40 m od zastávky: relace OSM často vede jen jedním pásem
                if not smer[i] or not c: continue
                n = float(np.hypot(*smer[i])); ok = {}
                pool = dict(c)
                if not (exact and exact[i]):
                    d_ = np.hypot(self.arr[:, 0] - stops[i][0], self.arr[:, 1] - stops[i][1])
                    for k in np.flatnonzero(d_ <= 40): pool.setdefault(int(k), float(d_[k]))
                sc = {}
                for u, dd in pool.items():
                    best = -1.0
                    for v, _w in self.adj[u]:
                        e = (self.xy[v][0] - self.xy[u][0], self.xy[v][1] - self.xy[u][1]); le = float(np.hypot(*e))
                        if le > 0.5: best = max(best, (e[0] * smer[i][0] + e[1] * smer[i][1]) / (le * n))
                    sc[u] = best
                if min(sc.values()) >= -0.3: continue         # žádný jednosměrný pás opačného směru poblíž (obyčejná silnice, zatáčka): nic se nemění
                ok = {u: pool[u] for u, b_ in sc.items() if b_ > 0.3}
                if ok: cand[i] = ok
        # Viterbi: pro každou zastávku ceny dosažených kandidátů a zpětné ukazatele (předchůdci z Dijkstry daného úseku)
        legs = []                                           # [(best {uzel: cena}, prev, src)] pro úseky 1..n-1
        best = {u: SNAP_W * d for u, d in cand[0].items()}
        bests = [best]
        for i in range(1, len(stops)):
            dst = cand[i]
            if not best or not dst:
                legs.append(None); best = {u: SNAP_W * d for u, d in dst.items()}; bests.append(best)
                if best and near[i - 1] and near[i]: self.fails += 1
                continue
            got, prev = self._leg(best, dst, self.adj)
            if not got:
                got, prev = self._leg(best, dst, self.adj_u)
                if got: self.undirected += 1
            if not got:
                if near[i - 1] and near[i]: self.fails += 1
                legs.append(None); best = {u: SNAP_W * d for u, d in dst.items()}; bests.append(best)
                continue
            legs.append((prev, set(best)))
            best = {u: c + SNAP_W * dst[u] for u, c in got.items()}; bests.append(best)
        # zpětný průchod: zvolené uzly zastávek a body úseků
        chosen = [None] * len(stops); pts = [None] * len(stops)
        u = min(best, key=best.get) if best else None
        for i in range(len(stops) - 1, 0, -1):
            chosen[i] = u
            lg = legs[i - 1]
            if lg is None or u is None:
                b_ = bests[i - 1]                          # úsek bez cesty: předchozí zastávka podle svého nejlepšího kandidáta
                u = min(b_, key=b_.get) if b_ else None
                continue
            prev, src = lg; seq = [u]
            while seq[-1] not in src: seq.append(prev[seq[-1]])
            seq.reverse(); pts[i] = seq; u = seq[0]
        chosen[0] = u
        line, dists, L = [tuple(stops[0])], [0.0], 0.0

        def add(p):
            nonlocal L
            L += float(np.hypot(p[0] - line[-1][0], p[1] - line[-1][1])); line.append(tuple(p))
        for i in range(1, len(stops)):
            if pts[i] is None:
                add(stops[i])
            else:
                for k in pts[i]:
                    if line[-1] != self.xy[k]: add(self.xy[k])
                if not near[i]: add(stops[i])               # dál mimo mapu rovně
            dists.append(L)
        if len(line) < 2: line.append((line[0][0] + 0.1, line[0][1]))
        self.legs = pts[1:]
        return line, dists
