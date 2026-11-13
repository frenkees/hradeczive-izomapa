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

        _MM_POV = [(p, r) for r in _MMHK['povrchy'] if (p := _mm_poly(r)) is not None]
        _MM_ZEL = [(p, r) for r in _MMHK['zelen'] if (p := _mm_poly(r)) is not None]
        _MM_PZ = [p for r in _MMHK['parky'] if (p := _mm_poly(r)) is not None]
        _MM_PARK = [p for r in _MMHK['parkoviste'] if (p := _mm_poly(r)) is not None]
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
            S[rb:rb + GX.shape[0]][hit] = C['marking']
        # 5b) pod mostovkou (výš než 1 m nad terénem) povrch z doby před pasportem: plocha vozovky a chodníku na mostě
        #     se jinak namaluje i na zem, vodu nebo koleje pod ním (silnice z OSM se pod mosty nekreslí už v prep.py)
        _under_d = []
        for D in DECKS:
            _xy = np.array(D[0].coords)[:, :2]; _hi = (np.asarray(D[2]) - np.asarray(D[3])) > 1.0
            if len(_xy) != len(_hi): continue
            _run = []
            for q_, h_ in zip(_xy, _hi):
                if h_: _run.append(tuple(q_))
                elif _run:
                    if len(_run) > 1: _under_d.append(LineString(_run).buffer(D[4] / 2 + 0.3, cap_style='flat'))
                    _run = []
            if len(_run) > 1: _under_d.append(LineString(_run).buffer(D[4] / 2 + 0.3, cap_style='flat'))
        if _under_d:
            _um = _mask(shapely.unary_union(_under_d).intersection(_MM_PIL))
            S[_um] = ORIG[_um]
            print('MMHK: pod mostovkami vrácen původní povrch px', int(_um.sum()))
        cls.paste(Image.fromarray(_A))
        # 6) lampy veřejného osvětlení místo odhadnutých po 34 m
        _n0 = len(props['lamp'])
        props['lamp'] = [l_ for l_ in props['lamp'] if not _MM_PILP.contains(Point(l_[0], l_[1]))]
        _nr = _n0 - len(props['lamp']); _nl = 0
        for l_ in _MMHK['lampy']:
            if l_['typ'] == 'reflektor': continue
            x, y = (float(v) for v in to_local(l_['lon'], l_['lat']))
            q = Point(x, y)
            if not (AREA.contains(q) and _MM_PILP.contains(q)): continue
            nd_ = nearest_dir(q, all_tree, all_lines, 15)
            props['lamp'].append([x, y, float(ground(x, y)), nd_[0] if nd_ else 0.0]); _nl += 1
        # 7) zaparkovaná auta na skutečných stáních (řady stání ze značení); odhadnutá auta u ulic v oblasti pryč
        _stn = [s for s in _MMHK['stani'] if _mm_inbb([[s[0], s[1]]])]
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
        # 8) zábradlí (DTMM), ne na mostech a nad vodou; na nábřežní zdi o římsu výš
        _decks = shapely.STRtree([D[0] for D in DECKS]) if DECKS else None
        _rw = shapely.prepared.prep(shapely.unary_union([w.buffer(2.5) for w, _s in _MM_RIVW])) if _MM_RIVW else None
        _nz = 0
        for q in _MMHK['zabradli']:
            if len(q) < 2 or not _mm_inbb(q): continue
            for l in lines(LineString(_mm_xy(q)).intersection(AREA)):
                if l.length < 1.5: continue
                m_ = l.interpolate(0.5, normalized=True)
                if _MM_WP.contains(m_) or (_decks is not None and len(_decks.query(m_, predicate='dwithin', distance=4.0))): continue
                l = l.segmentize(2.5); P_ = np.array(l.coords)[:, :2]
                d_ = np.gradient(P_, axis=0); n_ = np.stack([-d_[:, 1], d_[:, 0]], 1); n_ /= np.linalg.norm(n_, axis=1, keepdims=True) + 1e-9
                z_ = np.maximum(ground(*(P_ + n_ * 1.2).T), ground(*(P_ - n_ * 1.2).T))
                if _rw is not None and _rw.contains(m_): z_ = z_ + 0.6
                lines_out['fence'].append([[round(float(x), 2), round(float(y), 2), round(float(zz), 2)] for (x, y), zz in zip(P_, z_)]); _nz += 1
        print('MMHK: povrchů', len(_MM_POV), 'zeleně', len(_MM_ZEL), 'značení px', int((S == C['marking']).sum()),
              'lamp', _nl, 'místo', _nr, '| aut na stáních', _nca, 'odebráno', _ncr, '| zábradlí', _nz)
