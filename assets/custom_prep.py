# Místní úpravy Hradce Králové (spouští prep.py v jednotlivých fázích HOOK).

if HOOK == 'terrain':
    # Jez Hučák: laser DMR 5G nemá body na vodě, doplněná hladina proto u jezu plynule klesá z horní vody (229,9 m)
    # na dolní (226,3 m, rozdíl podle DMR nad a pod jezem). Tady se hladina srovná: nad osou jezu horní voda, pod ní dolní,
    # stupeň je přesně na jezu (zakryje ho model jez_hucak). Břehy (nad 230,4 m) zůstanou beze změny.
    _a = np.array(to_local(15.825386 - 25.0 / geo.KX, 50.207213 + 19.0 / 110574))     # západní konec osy jezu
    _b = np.array(to_local(15.825386 + 21.0 / geo.KX, 50.207213 - 15.7 / 110574))     # východní konec
    _c = (_a + _b) / 2; _u = (_b - _a) / np.linalg.norm(_b - _a)
    _side = (gx - _c[0]) * -_u[1] + (gy - _c[1]) * _u[0]          # > 0 proti proudu (severovýchod), < 0 po proudu
    _near = np.hypot(gx - _c[0], gy - _c[1]) < 110
    HX[_near & (_side > 0) & (HX < 229.9)] = 229.9
    HX[_near & (_side < 0) & (HX < 228.6)] = 226.3

# ---------------- data Magistrátu města HK (geoportal.mmhk.cz) ----------------
# assets/mmhk.json + assets/mmhk_znaceni/ vyrobí ../skripty/mmhk_pasport.py. V jeho oblasti nahradí odhady z OSM:
#   cliffs:   nábřežní opěrné zdi (DTMM) u řek jako svislé kamenné stěny se zalomeným terénem (hladina dole, ulice nahoře)
#   cemetery: stromy a keře z pasportu zeleně (poloha, druh, výška z DMP), náhodné stromy na městských plochách skryje
#   props:    povrchy z pasportu komunikací a zeleně, obrubníky, vodorovné značení (městská WMS), lampy veřejného osvětlení,
#             auta na skutečných parkovacích stáních, zábradlí (DTMM)
# Vypnout: IZO_MMHK=0
if HOOK in ('cliffs', 'cemetery', 'props') and os.environ.get('IZO_MMHK', '1') != '0' and os.path.exists('assets/mmhk.json'):
    if '_MMHK' not in globals():
        _MMHK = json.load(open('assets/mmhk.json', encoding='utf-8'))
        _la0, _lo0, _la1, _lo1 = _MMHK['oblast']

        def _mm_xy(q):
            _q = np.asarray(q, float); _x, _y = to_local(_q[:, 1], _q[:, 0]); return np.column_stack([_x, _y])

        _MM_DB = box(-HE, -HE, HE, HE).buffer(50)
        _MM_PIL = Polygon(_mm_xy([[_la0, _lo0], [_la0, _lo1], [_la1, _lo1], [_la1, _lo0]])).intersection(_MM_DB)
        _MM_PILP = shapely.prepared.prep(_MM_PIL)
        _MM_BB = _MM_PIL.bounds

        def _mm_inbb(q):                               # rychlý test obálky v lat/lon
            a = np.asarray(q, float); x, y = to_local(a[:, 1], a[:, 0])
            return x.max() >= _MM_BB[0] and x.min() <= _MM_BB[2] and y.max() >= _MM_BB[1] and y.min() <= _MM_BB[3]

        def _mm_poly(r):
            if not _mm_inbb(r['o']): return None
            try:
                _g = Polygon(_mm_xy(r['o']), [_mm_xy(h) for h in r['h'] if len(h) >= 4]).buffer(0)
            except Exception:
                return None
            _g = _g.intersection(_MM_PIL)
            return None if _g.is_empty or _g.area < 0.3 else _g

        # přestavby, které pasport ještě nemá (assets/prestavby.json, OSM z ../skripty/prestavby_osm.py): v zóně se pasport
        # komunikací, zeleně, značení, stání a zábradlí nepoužije a vozovky, chodníky a přechody se nakreslí podle OSM
        _PRE = json.load(open('assets/prestavby.json', encoding='utf-8')) if os.path.exists('assets/prestavby.json') else []
        _PRE_Z = shapely.unary_union([Polygon(_mm_xy(p['zona'])) for p in _PRE]).buffer(0) if _PRE else Polygon()
        _PRE_ZP = shapely.prepared.prep(_PRE_Z)

        def _mm_cut(g):
            if g is None or _PRE_Z.is_empty or not g.intersects(_PRE_Z): return g
            g = g.difference(_PRE_Z)
            return None if g.is_empty or g.area < 0.3 else g

        _MM_POV = [(p, r) for r in _MMHK['povrchy'] if (p := _mm_cut(_mm_poly(r))) is not None]
        _MM_ZEL = [(p, r) for r in _MMHK['zelen'] if (p := _mm_cut(_mm_poly(r))) is not None]
        _MM_PZ = [p for r in _MMHK['parky'] if (p := _mm_cut(_mm_poly(r))) is not None]
        _MM_PARK = [p for r in _MMHK['parkoviste'] if (p := _mm_cut(_mm_poly(r))) is not None]

        # cesty z OSM v zónách přestaveb: (geometrie, druh plochy, šířka, tagy); podchody a stavby se nekreslí
        _PRE_CAR = {'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'trunk', 'trunk_link',
                    'residential', 'unclassified', 'living_street', 'service'}
        _PRE_W = []
        for _p in _PRE:
            for _w in _p.get('osm', {}).get('ways', []):
                _t = _w['t']; _h = _t.get('highway')
                if 'area:highway' in _t or not _h: continue
                # silnice ve výstavbě (nové ulice u malé Milety): pasport magistrátu je už má, za hranicí zóny se kreslí
                # z pasportu -> v zóně kreslit taky, jinak by přes silnici na hranici zóny vedl pruh trávy
                if _h == 'construction' and _t.get('construction') in _PRE_CAR: _h = _t['construction']
                if _t.get('tunnel') or _t.get('covered') == 'yes' or _t.get('layer', '0').startswith('-'): continue
                if _h in ('proposed', 'construction', 'platform', 'corridor', 'elevator'): continue
                _l = LineString(_mm_xy(_w['q']))
                if not _l.intersects(_PRE_Z.buffer(30)): continue
                _ow = _t.get('oneway') == 'yes' or _t.get('junction') == 'roundabout'
                _ln = _t.get('lanes', ''); _n = int(_ln) if _ln.isdigit() else 0
                try: _wd = float(_t.get('width', '').replace(',', '.').split()[0])
                except (ValueError, IndexError): _wd = 0.0
                if _h in _PRE_CAR:
                    if _h == 'service':
                        _n = _n or 1; _wd = _wd or (3.0 if _t.get('service') in ('driveway', 'parking_aisle') else 3.6)
                    elif _h.endswith('_link'):
                        _n = _n or 1; _wd = _wd or _n * 3.5 + 0.8
                    elif _h in ('residential', 'unclassified', 'living_street'):
                        _n = _n or (1 if _ow else 2); _wd = _wd or (_n * 3.0 + 0.5 if _ow else max(6.0, _n * 3.0))
                    else:
                        _n = _n or (1 if _ow else 2); _wd = _wd or _n * 3.3 + 0.6
                    _PRE_W.append((_l, 'road', _wd, _t, _n, _ow))
                else:
                    _wd = _wd or {'cycleway': 3.0, 'footway': 2.2, 'path': 2.0, 'steps': 2.5, 'pedestrian': 4.0, 'track': 3.0}.get(_h, 2.0)
                    _PRE_W.append((_l, 'paved' if _h == 'steps' else 'dirt' if _h == 'track' else 'footway', min(_wd, 5.0), _t, 0, False))
        _PRE_ROADS = shapely.unary_union([l.buffer(w / 2, cap_style='flat') for l, k, w, *_ in _PRE_W if k == 'road']) if _PRE_W else Polygon()
        _PRE_ALL = shapely.prepared.prep(shapely.unary_union([l.buffer(w / 2 + 1.0) for l, k, w, *_ in _PRE_W]).intersection(_PRE_Z)) if _PRE_W else None
        _PRE_ISL = [Polygon(_mm_xy(_w['q'])).buffer(0) for _p in _PRE for _w in _p.get('osm', {}).get('ways', [])
                    if _w['t'].get('area:highway') and len(_w['q']) >= 4]
        _KERE = ('Zapojené skupiny keřů', 'Pokryvné výsadby keřů', 'Rozvolněné skupiny keřů', 'Živé ploty', 'Skupiny keřů')
        _wat = load('water')
        _MM_W = shapely.unary_union([g for c, g in zip(_wat['class'], _wat.geom) if c in ('river', 'water', 'canal', 'moat')
                                     and g.geom_type in ('Polygon', 'MultiPolygon')]).buffer(0)
        _MM_WP = shapely.prepared.prep(_MM_W)
        _MM_RIVW = []                                 # nábřežní zdi (lokální čáry), pro zábradlí

    # ---- nábřežní zdi: DTMM opěrná zeď do 12 m od řeky, rozdíl ulice – voda aspoň 1 m ----
    if HOOK == 'cliffs' and not _MM_PIL.is_empty:
        _f = float(geo.MESTO.get('teren_prevyseni', 1.0)); _ext2 = box(-RE, -RE, RE, RE)
        _vl = [LineString(_mm_xy(z['q'])) for z in _MMHK['zdi'] if z['k'] == 'v' and len(z['q']) >= 2 and _mm_inbb(z['q'])]
        _vu = shapely.unary_union([l.buffer(1.5) for l in _vl]) if _vl else None
        _walls = []
        for z in _MMHK['zdi']:
            if len(z['q']) < 2 or not _mm_inbb(z['q']): continue
            l = LineString(_mm_xy(z['q']))
            if l.length < 4 or not l.intersects(_ext2) or l.distance(_MM_W) > 12: continue
            if z['k'] == 'h' and _vu is not None and l.intersection(_vu).length > 0.7 * l.length: continue   # druhá hrana téže zdi
            _walls.append(l)
        _nw = 0
        for l in _walls:
            l = l.segmentize(2.0); P_ = np.array(l.coords)[:, :2]
            d_ = np.gradient(P_, axis=0); n_ = np.stack([-d_[:, 1], d_[:, 0]], 1); n_ /= np.linalg.norm(n_, axis=1, keepdims=True) + 1e-9
            wa = sum(_MM_WP.contains(Point(*q)) for q in P_ + n_ * 7); wb = sum(_MM_WP.contains(Point(*q)) for q in P_ - n_ * 7)
            if wa == wb: continue
            s = 1 if wa > wb else -1                                         # +n_*s = strana k vodě
            zl = (dem(*(P_ + n_ * s * 7).T) - HMIN) * _f; zh = (dem(*(P_ - n_ * s * 4).T) - HMIN) * _f
            zl = np.minimum(zl, np.median(zl) + 0.5); zh = np.maximum(zh, np.median(zh) - 0.5)
            diff = float(np.median(zh - zl))
            if diff < 1.0: continue
            st = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(P_, axis=0).T))])
            near = np.where(shapely.dwithin(_gpts, l, 7.0))[0]
            if len(near):
                pp = shapely.get_coordinates(_gpts[near]); t_ = shapely.line_locate_point(l, _gpts[near])
                a_ = shapely.get_coordinates(shapely.line_interpolate_point(l, np.maximum(t_ - 0.5, 0)))
                b_ = shapely.get_coordinates(shapely.line_interpolate_point(l, np.minimum(t_ + 0.5, l.length)))
                cross = (b_[:, 0] - a_[:, 0]) * (pp[:, 1] - a_[:, 1]) - (b_[:, 1] - a_[:, 1]) * (pp[:, 0] - a_[:, 0])
                on_w = (cross > 0) == (s > 0)                                # levá strana (cross > 0) = +n_
                HX.flat[near] = np.where(on_w, np.interp(t_, st, zl), np.interp(t_, st, zh))
            CLIFFS.append((l, False, diff)); _MM_RIVW.append((l, s)); _nw += 1
        if _MM_RIVW:                                  # opěrné zdi z OSM na stejném místě by se zdvojily
            _ru = shapely.prepared.prep(shapely.unary_union([w.buffer(3.0) for w, _s in _MM_RIVW]))
            CLIFFS[:] = [c for c in CLIFFS if any(c[0] is w for w, _s in _MM_RIVW) or not _ru.contains(c[0].interpolate(0.5, normalized=True))]
        print('MMHK: nábřežních zdí', _nw)

    if HOOK == 'cemetery' and not _MM_PIL.is_empty:
        _new = []
        _st = [t for t in _MMHK['stromy'] if _mm_inbb([[t['lat'], t['lon']]])]
        _xy = _mm_xy([[t['lat'], t['lon']] for t in _st]) if _st else np.zeros((0, 2))
        for t, (x, y) in zip(_st, _xy):
            if not _MM_PILP.contains(Point(x, y)): continue
            if _PRE_ALL is not None and _PRE_ALL.contains(Point(x, y)): continue     # strom z pasportu na nové silnici/chodníku
            _ker = 'keře' in t['druh']; _con = 1 if 'jehli' in t['druh'] else 0; _h = t.get('h')
            if _ker:
                _h = _h if _h and _h <= 4.5 else 1.6 + h01('k' + wkey(x, y)) * 1.4
            else:
                if not _h: _h = min(22.0, 6 + 0.8 * t['kor']) if t.get('kor') else 10.0
                _h = max(4.0, min(32.0, _h))
            _new.append((float(x), float(y), float(_h), _con, 1 if _ker else 0))
        # keře v plochách (skupiny, pokryvné výsadby, živé ploty): pravidelně s náhodným posunem
        for p, r in _MM_ZEL:
            d = r['druh']
            if not (d.startswith(_KERE) or 'podrostem keřů' in d): continue
            _sp = 1.4 if 'Živé ploty' in d else 3.0 if 'Rozvolněné' in d else 2.1
            _h0, _h1 = (1.1, 1.8) if 'tvarované' in d else (1.3, 2.8)
            _con = 1 if 'jehl' in d and 'list' not in d else 0
            minx, miny, maxx, maxy = p.bounds
            for gx_ in np.arange(math.floor(minx / _sp) * _sp, maxx, _sp):
                for gy_ in np.arange(math.floor(miny / _sp) * _sp, maxy, _sp):
                    k = wkey(gx_, gy_)
                    x, y = gx_ + (h01('a' + k) - 0.5) * 0.6 * _sp, gy_ + (h01('b' + k) - 0.5) * 0.6 * _sp
                    if p.contains(Point(x, y)): _new.append((float(x), float(y), _h0 + h01('c' + k) * (_h1 - _h0), _con, 1))
        # náhodné stromy na městských plochách a u zaměřených stromů pryč (kind 2 = skrytý, pořadí ostatních zůstane)
        _mesto = shapely.prepared.prep(shapely.unary_union(_MM_PZ + [p for p, _ in _MM_ZEL] + [p for p, _ in _MM_POV]).buffer(0))
        _nt = shapely.STRtree([Point(t[0], t[1]) for t in _new]) if _new else None
        _n0 = 0
        for t in trees:
            if t[5] == 2: continue
            q = Point(t[0], t[1])
            if not _MM_PILP.contains(q): continue
            if _mesto.contains(q) or (_nt is not None and len(_nt.query(q, predicate='dwithin', distance=3.5))):
                t[5] = 2; _n0 += 1
        _tz = ground(np.array([t[0] for t in _new]), np.array([t[1] for t in _new])) if _new else []
        trees += [[round(t[0], 2), round(t[1], 2), round(float(z), 2), round(t[2], 1), t[3], t[4]] for t, z in zip(_new, _tz)]
        print('MMHK: stromů a keřů', len(_new), 'skryto odhadnutých', _n0)

    if HOOK == 'props' and not _MM_PIL.is_empty:
        _A = np.array(cls)
        bx0, by0, bx1, by1 = _MM_PIL.bounds
        c0, c1 = max(0, int((bx0 + HE) / TEX_RES)), min(TWE, int(math.ceil((bx1 + HE) / TEX_RES)))
        r0, r1 = max(0, int((HE - by1) / TEX_RES)), min(TWE, int(math.ceil((HE - by0) / TEX_RES)))
        S = _A[r0:r1, c0:c1]; ORIG = S.copy()

        def _pp(coords):
            return [((x + HE) / TEX_RES - c0, (HE - y) / TEX_RES - r0) for x, y in coords]

        def _mask(g):                                  # bool maska celé výseče pro polygon s dírami
            m = Image.new('L', (S.shape[1], S.shape[0]), 0); dr = ImageDraw.Draw(m)
            for p in polys(g):
                dr.polygon(_pp(p.exterior.coords), fill=1)
                for h in p.interiors: dr.polygon(_pp(h.coords), fill=0)
            return np.asarray(m, bool)

        def _pmask(p):                                 # maska jednoho polygonu ve výřezu jeho obálky
            minx, miny, maxx, maxy = p.bounds
            a0, a1 = max(0, int((minx + HE) / TEX_RES) - c0), min(S.shape[1], int(math.ceil((maxx + HE) / TEX_RES)) - c0 + 1)
            b0, b1 = max(0, int((HE - maxy) / TEX_RES) - r0), min(S.shape[0], int(math.ceil((HE - miny) / TEX_RES)) - r0 + 1)
            if a1 <= a0 or b1 <= b0: return None
            m = Image.new('L', (a1 - a0, b1 - b0), 0); dr = ImageDraw.Draw(m)
            q = lambda cs: [(u - a0, v - b0) for u, v in _pp(cs)]
            dr.polygon(q(p.exterior.coords), fill=1)
            for h in p.interiors: dr.polygon(q(h.coords), fill=0)
            return np.asarray(m, bool), (a0, a1, b0, b1)

        def _paint(g, k):
            for p in polys(g):
                res = _pmask(p)
                if res is None: continue
                mm, (a0, a1, b0, b1) = res
                S[b0:b1, a0:a1][mm] = C[k]

        ROADISH = [C[k] for k in ('road', 'footway', 'curb', 'marking', 'cobble', 'plaza', 'plaza2', 'paved', 'manhole', 'parking')]
        U = shapely.unary_union([p for p, _ in _MM_POV]).buffer(0)
        # 1) přesahy silnic a chodníků z OSM (pevná šířka) kolem skutečných ploch -> tráva, přes ni pak zeleň a povrchy
        if not U.is_empty:
            S[_mask(U.buffer(3.0).difference(U).intersection(_MM_PIL)) & np.isin(S, ROADISH)] = C['grass']
        # 2) zeleň
        ZK = {'Parkový trávník': 'park', 'Parterový trávník': 'park', 'Sportovní trávník': 'pitch', 'Luční trávník': 'meadow',
              'Bylinný pokryv': 'meadow', 'Ruderalní porost': 'meadow', 'Mokřad': 'wetland', 'Předzahrádky': 'garden',
              'Plocha bez vegetačního krytu': 'paved'}
        for p, r in _MM_ZEL:
            d = r['druh']
            k = ZK.get(d) or ('garden' if d.startswith('Záhon') else 'scrub' if (d.startswith(_KERE) or 'podrostem keřů' in d)
                              else 'park' if d.startswith(('Skupiny stromů', 'Zapojené skupiny stromů', 'Stromořadí')) else None)
            if k: _paint(p, k)
        # 2b) voda až k patě nábřežní zdi (břeh vody v datech bývá o pár metrů dál od zdi)
        _wn = _MM_W.buffer(6.0)
        for w, s_ in _MM_RIVW:
            try: _paint(w.buffer(5.0 * s_, single_sided=True).intersection(_wn), 'water')
            except Exception: pass
        # 3) povrchy komunikací (materiál chodníků z pasportu; vozovka dlažba/asfalt podle povrchu silnic v Overture)
        MK = {'žul.kostka': 'cobble', 'žul.dlažba': 'plaza2', 'žula': 'plaza2', 'mramor. dlažba': 'plaza2', 'mozaika': 'plaza2',
              'Historická mozaika': 'plaza2', 'mozaika/LA': 'plaza2', 'štěrk': 'paved', 'nezpevněno': 'dirt'}
        CBL = [C['cobble'], C['plaza'], C['plaza2']]
        _sg = load('segment'); _cob, _asf = [], []
        for _s, _g in zip(_sg['road_surface'], _sg.geom):
            _v = str(_s)
            if 'paving_stones' in _v or "'sett'" in _v or 'cobblestone' in _v: _cob += lines(_g)
            elif "'paved'" in _v or 'asphalt' in _v: _asf += lines(_g)
        _ct = shapely.STRtree(_cob) if _cob else None; _at = shapely.STRtree(_asf) if _asf else None

        def _len_in(tr, ls, p):
            return sum(ls[i].intersection(p).length for i in tr.query(p)) if tr is not None else 0.0

        road_u = []
        for p, r in _MM_POV:
            if r['typ'] == 'komunikace':
                lc, la = _len_in(_ct, _cob, p), _len_in(_at, _asf, p)
                for pp in polys(p):
                    res = _pmask(pp)
                    if res is None: continue
                    mm, (a0, a1, b0, b1) = res
                    if lc + la > 0: k = 'cobble' if lc > la else 'road'
                    else:
                        o = ORIG[b0:b1, a0:a1][mm]; k = 'cobble' if o.size and np.isin(o, CBL).mean() > 0.5 else 'road'
                    S[b0:b1, a0:a1][mm] = C[k]
                road_u.append(p)
            else:
                _paint(p, MK.get(r['mat'].strip(), 'footway'))
        for p in _MM_PARK: _paint(p, 'parking')
        # 4) obrubníky po obvodu vozovek a parkovišť
        cm = Image.new('L', (S.shape[1], S.shape[0]), 0); dr = ImageDraw.Draw(cm)
        for p in polys(shapely.unary_union(road_u + _MM_PARK).buffer(0)):
            for ring in [p.exterior, *p.interiors]: dr.line(_pp(ring.coords), fill=1, width=1)
        S[np.asarray(cm, bool) & _mask(_MM_PIL.buffer(-1.0))] = C['curb']
        # 5) vodorovné značení z městské WMS (dlaždice 0,1 m/px, max 3×3 -> 0,3 m), jen na zpevněných plochách
        _ZON = _mask(_PRE_Z.intersection(_MM_PIL)) if not _PRE_Z.is_empty else None
        import scipy.ndimage as _ndi
        from pyproj import Transformer as _Tr
        _zi = json.load(open('assets/mmhk_znaceni/index.json')); _ZR, _ZT = _zi['res'], _zi['tile']; _ZM = _ZR * _ZT
        _zset = {tuple(t) for t in _zi['tiles']}; _ztc = {}
        _tr = _Tr.from_crs(4326, 5514, always_xy=True)
        PAVED = np.isin(S, [C[k] for k in ('road', 'parking', 'cobble', 'plaza', 'plaza2', 'footway', 'paved', 'curb')])
        xs_ = (np.arange(c0, c1) + 0.5) * TEX_RES - HE
        for rb in range(0, S.shape[0], 400):
            ys_ = HE - (np.arange(r0 + rb, min(r1, r0 + rb + 400)) + 0.5) * TEX_RES
            GX, GY = np.meshgrid(xs_, ys_)
            lo_, la_ = to_lonlat(GX.ravel(), GY.ravel())
            KX_, KY_ = _tr.transform(lo_, la_)
            ti, tj = np.floor(KX_ / _ZM).astype(np.int64), np.floor(KY_ / _ZM).astype(np.int64)
            hit = np.zeros(KX_.shape, bool)
            for key in set(zip(ti.tolist(), tj.tolist())):
                if key not in _zset: continue
                if key not in _ztc:
                    _ztc[key] = _ndi.maximum_filter(np.asarray(Image.open(f'assets/mmhk_znaceni/{key[0]}_{key[1]}.png')) > 0, size=3)
                s_ = (ti == key[0]) & (tj == key[1])
                cc = np.clip(((KX_[s_] - key[0] * _ZM) / _ZR).astype(np.int64), 0, _ZT - 1)
                rr = np.clip(((key[1] + 1) * _ZM - KY_[s_]) / _ZR, 0, _ZT - 1).astype(np.int64)
                hit[s_] = _ztc[key][rr, cc]
            hit = hit.reshape(GX.shape) & PAVED[rb:rb + GX.shape[0]]
            if not _PRE_Z.is_empty: hit &= ~_ZON[rb:rb + GX.shape[0]]
            S[rb:rb + GX.shape[0]][hit] = C['marking']
        # 5a) zóny přestaveb: povrchy podle OSM (pasport je tu ze stavu před přestavbou)
        if _ZON is not None and _ZON.any():
            _ROADISH = np.isin(S, ROADISH + [C['construction'], C['dirt']])
            S[_ZON & _ROADISH] = C['grass']                      # cesty z Overture (odhad šířky) a staré plochy pryč

            def _plines(geoms, k, wpx=1):                       # tenké čáry (značení) přímo do rastru
                m_ = Image.new('L', (S.shape[1], S.shape[0]), 0); d_ = ImageDraw.Draw(m_)
                for g_ in geoms:
                    for l_ in lines(g_): d_.line(_pp(l_.coords), fill=1, width=wpx)
                S[np.asarray(m_, bool) & _ZON] = C[k]

            def _zpaint(g_, k):
                g_ = g_.intersection(_PRE_Z)
                if g_.is_empty: return
                m_ = _mask(g_); S[m_ & _ZON] = C[k]
            for k_ in ('dirt', 'footway', 'paved'):
                _g = [l.buffer(w / 2, cap_style='round') for l, kk, w, *_ in _PRE_W if kk == k_]
                if _g: _zpaint(shapely.unary_union(_g), k_)
            _rd = [l.buffer(w / 2, cap_style='flat', join_style='round') for l, kk, w, *_ in _PRE_W if kk == 'road']
            # spoje: kruh na koncích, aby se navazující kusy a ramena křižovatek plynule spojily
            _rd += [Point(q).buffer(w / 2) for l, kk, w, *_ in _PRE_W if kk == 'road' for q in (l.coords[0], l.coords[-1])]
            _RU = shapely.unary_union(_rd).buffer(0.4).buffer(-0.4)
            _zpaint(_RU.buffer(0.35), 'curb'); _zpaint(_RU, 'road')
            for _i in _PRE_ISL:                                   # dělicí ostrůvky s obrubou: velké travnaté, malé dlážděné
                _zpaint(_i.buffer(0.3), 'curb'); _zpaint(_i, 'grass' if _i.area > 40 else 'paved')
            # značení: dělicí čáry pruhů (přerušované 3 m / 6 m), na obousměrné silnici střední čára
            _mk = []
            for l, kk, w, t_, n_, ow in _PRE_W:
                if kk != 'road' or t_.get('highway') == 'service': continue
                if ow and n_ >= 2:
                    offs = [(-w / 2 + 0.3) + (w - 0.6) * i / n_ for i in range(1, n_)]
                elif not ow and t_.get('highway') not in ('residential', 'unclassified', 'living_street'):
                    offs = [0.0]
                else: continue
                for o in offs:
                    try: ol = l.offset_curve(o) if o else l
                    except Exception: continue
                    for q in lines(ol):
                        d = 2.0
                        while d < q.length - 2:
                            _mk.append(shapely.ops.substring(q, d, min(d + 3.0, q.length))); d += 9.0
            _plines(_mk, 'marking')
            # přechody pro chodce: pruhy zebry podél silnice přes celou šířku vozovky
            _zb = []
            _rt = [(l, w) for l, kk, w, *_ in _PRE_W if kk == 'road']
            for _p in _PRE:
                for nd_ in _p.get('osm', {}).get('nodes', []):
                    t_ = nd_['t']
                    if t_.get('highway') != 'crossing' or t_.get('crossing') in ('unmarked', 'no', 'informal'): continue
                    q = Point(*_mm_xy([nd_['q']])[0])
                    if not _PRE_ZP.contains(q) or not _rt: continue
                    l, w = min(_rt, key=lambda r_: r_[0].distance(q))
                    if l.distance(q) > 1.5: continue
                    s_ = l.project(q); a_ = l.interpolate(max(0, s_ - 1)); b_ = l.interpolate(min(l.length, s_ + 1))
                    ux, uy = b_.x - a_.x, b_.y - a_.y; nn = math.hypot(ux, uy) or 1; ux, uy = ux / nn, uy / nn
                    c_ = l.interpolate(s_)
                    for k in range(int(w / 1.0)):
                        o = -w / 2 + 0.5 + k * 1.0
                        cx_, cy_ = c_.x - uy * o, c_.y + ux * o
                        _zb.append(LineString([(cx_ - ux * 1.6, cy_ - uy * 1.6), (cx_ + ux * 1.6, cy_ + uy * 1.6)]).buffer(0.25, cap_style='flat'))
            if _zb: _zpaint(shapely.unary_union(_zb), 'marking')
            print('MMHK: přestavby', [p['nazev'] for p in _PRE], 'cest z OSM', len(_PRE_W), 'přechodů', len(_zb) // 6)
        # 5a2) chodník a cyklostezka silničního mostu jsou součást mostní konstrukce: v pasportu je to plocha nad vodou těsně
        #      vedle mostovky (v OSM bývá chodník zvlášť a mostovka z dat má jen šířku vozovky). Mostovka se o ni rozšíří
        #      a osa se posune k chodníku, ať pás chodníku nezůstane namalovaný na hladině. Stejně lávka: v datech má šířku
        #      pěšiny, v pasportu je to širší plocha (okraje by zůstaly namalované pod lávkou jako dvě čáry do vody).
        _wsh = _MM_W.buffer(-0.5)
        _foot_rd = [D[0].buffer(D[4] / 2, cap_style='flat') for D in DECKS if D[5] == 'road']
        _Usw = U.intersection(_wsh).difference(shapely.unary_union(_foot_rd)) if _foot_rd and not U.is_empty else Polygon()
        _Uswp = shapely.prepared.prep(_Usw)
        _nwid = 0
        for _di, D in enumerate(DECKS):
            if D[5] == 'rail' or _Usw.is_empty or not (len(D) > 8 and D[8]): continue
            _xy = np.array(D[0].coords)[:, :2]; _z = np.asarray(D[2]); _g = np.asarray(D[3])
            if len(_xy) != len(_z) or len(_xy) < 3: continue
            _nrm = np.zeros_like(_xy)
            for k in range(len(_xy)):
                t_ = _xy[min(k + 1, len(_xy) - 1)] - _xy[max(k - 1, 0)]; t_ = t_ / (np.hypot(*t_) or 1)
                _nrm[k] = (-t_[1], t_[0])                         # levá normála
            _ext = {1: [], -1: []}
            for k in range(1, len(_xy) - 1):
                if _z[k] - _g[k] < 1.0 or not _MM_WP.contains(Point(*_xy[k])): continue
                for sd in (1, -1):
                    last, o = None, D[4] / 2
                    while o < D[4] / 2 + 8.0:
                        if _Uswp.contains(Point(*(_xy[k] + _nrm[k] * sd * o))): last = o
                        elif (last is None and o > D[4] / 2 + 1.0) or (last is not None and o - last > 0.75): break
                        o += 0.25
                    _ext[sd].append(0.0 if last is None else last - D[4] / 2 + 0.25)
            if len(_ext[1]) < 2: continue
            eL, eR = float(np.median(_ext[1])), float(np.median(_ext[-1]))
            eL, eR = (eL if eL > 0.8 else 0.0), (eR if eR > 0.8 else 0.0)
            if not (eL or eR): continue
            _sh = (eL - eR) / 2
            DECKS[_di] = (LineString(_xy + _nrm * _sh), D[1], D[2], D[3], round(D[4] + eL + eR, 2), *D[5:]); _nwid += 1
        if _nwid: print('MMHK: mostů a lávek rozšířených o chodník z pasportu', _nwid)
        # 5b) pod mostovkou (výš než 1 m nad terénem) povrch z doby před pasportem: plocha vozovky a chodníku na mostě
        #     se jinak namaluje i na zem, vodu nebo koleje pod ním (silnice z OSM se pod mosty nekreslí už v prep.py)
        _under_d = []
        for D in DECKS + list(globals().get('DECKS_SKRYTE', [])):       # i pod vlastním modelem mostu (mostovka z dat je skrytá)
            _xy = np.array(D[0].coords)[:, :2]; _hi = (np.asarray(D[2]) - np.asarray(D[3])) > 1.0
            if len(_xy) != len(_hi): continue
            _run = []
            for q_, h_ in zip(_xy, _hi):
                if h_: _run.append(tuple(q_))
                elif _run:
                    if len(_run) > 1: _under_d.append(LineString(_run).buffer(D[4] / 2 + 0.8, cap_style='flat'))
                    _run = []
            if len(_run) > 1: _under_d.append(LineString(_run).buffer(D[4] / 2 + 0.8, cap_style='flat'))
        if _under_d:
            _um = _mask(shapely.unary_union(_under_d).intersection(_MM_PIL))
            S[_um] = ORIG[_um]
            print('MMHK: pod mostovkami vrácen původní povrch px', int(_um.sum()))
        # 5c) cesty a plochy na hladině: most je 3D mostovka nebo vlastní model (jez Hučák, lávka u Aldisu), takže vozovka,
        #     chodník nebo dlažba namalovaná do vody je vždy plocha mostu na hladině -> voda (1,5 m od břehu nech, břeh v datech nesedí přesně)
        _wm = _mask(_MM_W.buffer(-1.5).intersection(_MM_PIL)) & np.isin(S, ROADISH)
        if _wm.any():
            S[_wm] = C['water']
            print('MMHK: cesty na hladině vráceny na vodu px', int(_wm.sum()))
        cls.paste(Image.fromarray(_A))
        # 6) lampy veřejného osvětlení místo odhadnutých po 34 m
        _n0 = len(props['lamp'])
        props['lamp'] = [l_ for l_ in props['lamp'] if not _MM_PILP.contains(Point(l_[0], l_[1])) or _PRE_ZP.contains(Point(l_[0], l_[1]))]
        _nr = _n0 - len(props['lamp']); _nl = 0
        # lampy mostu stojí v pasportu na okraji mostu, tedy nad vodou nebo nad břehem pod mostem -> postavit na mostovku (její výška,
        # nejdál k jejímu okraji). Jisté jsou lampy nad vodou; lampa nad břehem patří k mostu, když stojí ve stejné řadě (stejný odstup
        # od osy) jako některá jistá – jinak je to lampa cesty pod mostem. Lampa nad vodou mimo mostovky se nekreslí.
        _dkl = []
        for D in DECKS:
            _c = np.array(D[0].coords)[:, :2]
            if len(_c) == len(D[2]) and len(D) > 8 and D[8]:
                _dkl.append((D, np.concatenate([[0], np.cumsum(np.hypot(*np.diff(_c, axis=0).T))])))
        _dkt = shapely.STRtree([D[0] for D, _c in _dkl]) if _dkl else None
        _w05, _w20 = shapely.prepared.prep(_MM_W.buffer(-0.5)), shapely.prepared.prep(_MM_W.buffer(-2.0))

        def _on_deck(q, lim):                          # (vzdálenost, mostovka, odstup od osy se znaménkem, x, y, výška) nebo None
            best = None
            for k in (_dkt.query(q, predicate='dwithin', distance=12.0) if _dkt is not None else []):
                D, cum = _dkl[int(k)]; hw = D[4] / 2
                dist = D[0].distance(q)
                if dist > hw + lim or (best is not None and dist >= best[0]): continue
                s_ = D[0].project(q); zd = float(np.interp(s_, cum, D[2]))
                if zd - float(np.interp(s_, cum, D[3])) < 1.0: continue          # jen nad terénem (ne nájezd na zemi)
                f = D[0].interpolate(s_); f2 = D[0].interpolate(min(s_ + 1.0, D[0].length)); f1 = D[0].interpolate(max(s_ - 1.0, 0.0))
                sg = 1.0 if (f2.x - f1.x) * (q.y - f.y) - (f2.y - f1.y) * (q.x - f.x) >= 0 else -1.0
                k_ = min(1.0, max(hw - 0.4, 0.0) / dist) if dist > 1e-6 else 1.0
                best = (dist, int(k), sg * dist, f.x + (q.x - f.x) * k_, f.y + (q.y - f.y) * k_, zd)
            return best
        _rows, _wait, _nm, _nw = [], [], 0, 0
        for l_ in _MMHK['lampy']:
            if l_['typ'] == 'reflektor': continue
            x, y = (float(v) for v in to_local(l_['lon'], l_['lat']))
            q = Point(x, y)
            if not (AREA.contains(q) and _MM_PILP.contains(q)) or _PRE_ZP.contains(q): continue
            nd_ = nearest_dir(q, all_tree, all_lines, 15); a_ = nd_[0] if nd_ else 0.0
            inw = _w05.contains(q); r_ = _on_deck(q, 4.0 if inw else 3.0)
            if inw and r_ is not None:
                _rows.append((r_[1], r_[2])); props['lamp'].append([r_[3], r_[4], r_[5], a_]); _nl += 1; _nm += 1
            elif r_ is not None: _wait.append((x, y, a_, r_))
            elif _w20.contains(q): _nw += 1
            else: props['lamp'].append([x, y, float(ground(x, y)), a_]); _nl += 1
        for x, y, a_, r_ in _wait:
            if any(di == r_[1] and abs(o - r_[2]) < 1.2 for di, o in _rows): props['lamp'].append([r_[3], r_[4], r_[5], a_]); _nm += 1
            else: props['lamp'].append([x, y, float(ground(x, y)), a_])
            _nl += 1
        if _nm or _nw: print('MMHK: lamp postavených na mostovku', _nm, 'nad vodou mimo most vynecháno', _nw)
        # 7) zaparkovaná auta na skutečných stáních (řady stání ze značení); odhadnutá auta u ulic v oblasti pryč
        _stn = [s for s in _MMHK['stani'] if _mm_inbb([[s[0], s[1]]]) and not _PRE_ZP.contains(Point(*_mm_xy([[s[0], s[1]]])[0]))]
        _sxy = _mm_xy([[s[0], s[1]] for s in _stn]) if _stn else np.zeros((0, 2))
        _sxy2 = _mm_xy([[s[2], s[3]] for s in _stn]) if _stn else np.zeros((0, 2))
        _sp_t = shapely.STRtree([Point(*q) for q in _sxy]) if len(_sxy) else None
        _nc0 = len(cars)
        _GREEN = np.isin(_A, [C[k] for k in ('grass', 'garden', 'park', 'meadow', 'scrub', 'wetland', 'water', 'stream', 'pitch', 'forest')])

        def _keep(c_):                                 # odhadnuté auto pryč jen na skutečném stání nebo když podle pasportu stojí v zeleni/vodě
            q = Point(c_[0], c_[1])
            if not _MM_PILP.contains(q): return True
            if _sp_t is not None and len(_sp_t.query(q, predicate='dwithin', distance=4.0)): return False
            px_, py_ = pix(c_[0], c_[1])
            return not (0 <= px_ < TWE and 0 <= py_ < TWE and _GREEN[py_, px_])
        cars[:] = [c_ for c_ in cars if _keep(c_)]
        _ncr = _nc0 - len(cars); _nca = 0
        for (x, y), (x2, y2) in zip(_sxy, _sxy2):
            if not AREA.contains(Point(x, y)): continue
            cars.append([round(float(x), 2), round(float(y), 2), round(float(ground(x, y)), 2), round(math.atan2(y2 - y, x2 - x), 3),
                         int(h01('car' + wkey(x, y)) * 8) % 8]); _nca += 1
        # 8) zábradlí (DTMM), ne na mostech a nad vodou; na nábřežní zdi o římsu výš. Zábradlí mostu vede v pasportu i nad břehem
        #    pod mostem (na terénu by sbíhalo po svahu do vody): část v pásu mostovky nad terénem a část nad vodou se vynechá,
        #    mostovka má vlastní zábradlí
        _decks = shapely.STRtree([D[0] for D in DECKS]) if DECKS else None
        _dk8 = []
        for D in DECKS + list(globals().get('DECKS_SKRYTE', [])):
            _c = np.array(D[0].coords)[:, :2]
            if len(_c) == len(D[2]): _dk8.append((D, np.concatenate([[0], np.cumsum(np.hypot(*np.diff(_c, axis=0).T))])))
        _dk8t = shapely.STRtree([D[0] for D, _c in _dk8]) if _dk8 else None
        _w15 = shapely.prepared.prep(_MM_W.buffer(-1.5))

        def _na_moste(x, y, zg):                       # bod zábradlí patří mostu: v pásu mostovky, která je tam aspoň 1,5 m nad terénem bodu
            q = Point(x, y)
            for k in (_dk8t.query(q, predicate='dwithin', distance=14.0) if _dk8t is not None else []):
                D, cum = _dk8[int(k)]
                if D[0].distance(q) <= D[4] / 2 + 4.0 and float(np.interp(D[0].project(q), cum, D[2])) - zg > 1.5: return True
            return False
        _rw = shapely.prepared.prep(shapely.unary_union([w.buffer(2.5) for w, _s in _MM_RIVW])) if _MM_RIVW else None
        _nz = 0
        for q in _MMHK['zabradli']:
            if len(q) < 2 or not _mm_inbb(q): continue
            for l in lines(LineString(_mm_xy(q)).intersection(AREA).difference(_PRE_Z)):
                if l.length < 1.5: continue
                m_ = l.interpolate(0.5, normalized=True)
                if _MM_WP.contains(m_) or (_decks is not None and len(_decks.query(m_, predicate='dwithin', distance=4.0))): continue
                l = l.segmentize(2.5); P_ = np.array(l.coords)[:, :2]
                d_ = np.gradient(P_, axis=0); n_ = np.stack([-d_[:, 1], d_[:, 0]], 1); n_ /= np.linalg.norm(n_, axis=1, keepdims=True) + 1e-9
                z_ = np.maximum(ground(*(P_ + n_ * 1.2).T), ground(*(P_ - n_ * 1.2).T))
                _wall = _rw is not None and _rw.contains(m_)
                if _wall: z_ = z_ + 0.6
                _zg = ground(P_[:, 0], P_[:, 1])
                _ok = [not ((not _wall and _w15.contains(Point(x, y))) or _na_moste(x, y, float(g_))) for (x, y), g_ in zip(P_, _zg)]
                _run = []
                for (x, y), zz, ok in list(zip(P_, z_, _ok)) + [((0, 0), 0, False)]:
                    if ok: _run.append([round(float(x), 2), round(float(y), 2), round(float(zz), 2)])
                    else:
                        if len(_run) > 1: lines_out['fence'].append(_run); _nz += 1
                        _run = []
        print('MMHK: povrchů', len(_MM_POV), 'zeleně', len(_MM_ZEL), 'značení px', int((S == C['marking']).sum()),
              'lamp', _nl, 'místo', _nr, '| aut na stáních', _nca, 'odebráno', _ncr, '| zábradlí', _nz)

# ---- vlastní modely mostů a lávek: stromy v jejich pásu pryč (koruna by prorůstala mostovkou) ----
# dominanty.json "spec": {"bez_stromu": [{"q": [[lat, lon], ...], "w": šířka pásu v m}]}; strom se skryje (kind 2, pořadí barev zůstane),
# když je kmen blíž než půl šířky + poloměr koruny (listnatý ~0,33 h)
if HOOK == 'cemetery':
    _bz = [(LineString([to_local(lo, la) for la, lo in q['q']]), q.get('w', 6.0)) for d in DOMS for q in d['spec'].get('bez_stromu', [])]
    if _bz:
        _nb = 0
        for t in trees:
            if t[5] == 2: continue
            P_ = Point(t[0], t[1])
            if any(l.distance(P_) < w / 2 + t[3] * (0.2 if t[4] else 0.33) for l, w in _bz): t[5] = 2; _nb += 1
        print('stromů v pásu vlastních mostů skryto', _nb)
