// Vlastní 3D modely dominant Hradce Králové (napárované přes assets/dominanty.json, "spec": {"lm": "..."}).
// Předlohy: volně licencované fotky z Wikimedia Commons v landmarks_ref/<dominanta>/ (zdroje v ZDROJE.md).
// Souřadnice: frameAt(x, y, 0, úhel) -> f(s, t, výška), s podél osy, t napříč, výška absolutně (b.g = terén).
// Buffery: W = zdi (okna podle stylu), R = střechy, X = plné díly; aw = [svítí v noci, nebarvit, sníh nahoře, 0].

const C = (r, g, b) => [r / 255, g / 255, b / 255];

// hlavní osa půdorysu: střed a úhel nejdelší strany
function axis(ring) {
  let cx = 0, cy = 0;
  for (const [x, y] of ring) { cx += x; cy += y; }
  cx /= ring.length; cy /= ring.length;
  let best = 0, ang = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i], [x1, y1] = ring[(i + 1) % ring.length], l = Math.hypot(x1 - x0, y1 - y0);
    if (l > best) { best = l; ang = Math.atan2(y1 - y0, x1 - x0); }
  }
  return { cx, cy, ang };
}

// zeď s okny podle stylu st (shader zdí): stejné atributy jako zdi budov v render.html
function wall(W, pushQuad, tv, g, x0, y0, x1, y1, z0, z1, col, st) {
  const len = Math.hypot(x1 - x0, y1 - y0), lo = z0 - g, hi = z1 - g;
  pushQuad(W, tv(x0, y0, z0), tv(x1, y1, z0), tv(x1, y1, z1), tv(x0, y0, z1), col, [[0, lo, len, st], [len, lo, len, st], [len, hi, len, st]]);
  W.a.splice(W.a.length - 12, 12, 0, lo, len, st, len, hi, len, st, 0, hi, len, st);
}

// hranol nad mnohoúhelníkem (body proti směru hodin): zdi s okny a plochá střecha
function prism(W, R, pushQuad, pushTri, tv, g, pts, z0, z1, cols, st, roof) {
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    wall(W, pushQuad, tv, g, x0, y0, x1, y1, z0, z1, typeof cols === 'function' ? cols(i) : cols, st);
  }
  for (let i = 1; i < pts.length - 1; i++) pushTri(R, tv(...pts[0], z1), tv(...pts[i], z1), tv(...pts[i + 1], z1), roof, [0, 0, 0, 0]);
}

// Malšovická aréna: zaoblený obdélník v osách arény (s podél, t napříč), rohy po m úsecích, rovné strany po K dílech.
// Stejný počet bodů pro všechny obrysy -> body jdou spárovat (střecha, hlediště). Body proti směru hodin.
function arenaRing(hs, ht, r, K = 10, m = 5) {
  const C4 = [[hs - r, ht - r], [-hs + r, ht - r], [-hs + r, -ht + r], [hs - r, -ht + r]], pts = [];
  for (let q = 0; q < 4; q++) {
    const [cs, ct] = C4[q];
    for (let i = 0; i <= m; i++) { const a = (q + i / m) * Math.PI / 2; pts.push([cs + r * Math.cos(a), ct + r * Math.sin(a)]); }
    const a1 = ((q + 1) % 4) * Math.PI / 2, [ns, nt] = C4[(q + 1) % 4], e = [ns + r * Math.cos(a1), nt + r * Math.sin(a1)], s0 = pts[pts.length - 1];
    for (let k = 1; k < K; k++) pts.push([s0[0] + (e[0] - s0[0]) * k / K, s0[1] + (e[1] - s0[1]) * k / K]);
  }
  return pts;
}
// paty lízátek vůči středu hřiště (východ, sever) v metrech, z OSM
const ARENA_MASTS = [[-11.4, -88.9], [69.9, -61.1], [15.5, 73.3], [-62.1, 47.9]];

// půdorys v osách: střed, jednotkové vektory delší (u) a kratší (v) osy a rozsahy průmětů
function frame2(ring) {
  const { cx, cy, ang } = axis(ring), u = [Math.cos(ang), Math.sin(ang)], v = [-u[1], u[0]];
  let s0 = 1e9, s1 = -1e9, t0 = 1e9, t1 = -1e9;
  for (const [x, y] of ring) { const s = (x - cx) * u[0] + (y - cy) * u[1], t = (x - cx) * v[0] + (y - cy) * v[1]; s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
  if (s1 - s0 < t1 - t0) return frame2swap(ring, cx, cy, ang);
  return { cx, cy, ang, u, v, s0, s1, t0, t1 };
}
function frame2swap(ring, cx, cy, ang) {
  const a = ang + Math.PI / 2, u = [Math.cos(a), Math.sin(a)], v = [-u[1], u[0]];
  let s0 = 1e9, s1 = -1e9, t0 = 1e9, t1 = -1e9;
  for (const [x, y] of ring) { const s = (x - cx) * u[0] + (y - cy) * u[1], t = (x - cx) * v[0] + (y - cy) * v[1]; s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
  return { cx, cy, ang: a, u, v, s0, s1, t0, t1 };
}

// klenba nad půdorysem: body se po patrech stahují k podélné ose (valená klenba s konci podle obrysu)
function vault(R, pushQuad, tv, ring, F, z0, rise, col, steps = 7) {
  const tm = (F.t0 + F.t1) / 2;
  const lvl = (k) => {
    const a = (k / steps) * Math.PI / 2, kk = Math.cos(a), z = z0 + rise * Math.sin(a);
    return ring.map(([x, y]) => {
      const s = (x - F.cx) * F.u[0] + (y - F.cy) * F.u[1], t = (x - F.cx) * F.v[0] + (y - F.cy) * F.v[1], t2 = tm + (t - tm) * Math.max(kk, 0.04);
      return tv(F.cx + F.u[0] * s + F.v[0] * t2, F.cy + F.u[1] * s + F.v[1] * t2, z);
    });
  };
  let prev = lvl(0);
  for (let k = 1; k <= steps; k++) {
    const cur = lvl(k), sh = 0.86 + 0.14 * Math.sin(k / steps * Math.PI / 2);
    for (let i = 0; i < ring.length; i++) { const j = (i + 1) % ring.length; pushQuad(R, prev[i], prev[j], cur[j], cur[i], col.map((q) => q * sh), [0, 0, 0, 0]); }
    prev = cur;
  }
}

// vodorovné bílé pásy (římsy) po obvodu půdorysu ve výškách zs, mírně vystouplé ze zdi
function bands(X, pushQuad, tv, b, zs, col) {
  for (const z of zs) for (let i = 0; i < b.p.length; i++) {
    const [x0, y0] = b.p[i], [x1, y1] = b.p[(i + 1) % b.p.length], len = Math.hypot(x1 - x0, y1 - y0); if (len < 0.05) continue;
    const nx = (y1 - y0) / len * 0.18, ny = -(x1 - x0) / len * 0.18;
    pushQuad(X, tv(x0 + nx, y0 + ny, z - 0.35), tv(x1 + nx, y1 + ny, z - 0.35), tv(x1 + nx, y1 + ny, z + 0.35), tv(x0 + nx, y0 + ny, z + 0.35), col, [0.1, 1, 0, 0]);
  }
}
const GOLD_HK = [0.85, 0.72, 0.30];

const SEASON =(typeof location !== 'undefined' && new URLSearchParams(location.search).get('season')) || 'autumn';

export const landmarks = {
  // Zimní stadion (Komenského 1214): horní část fasády je mozaika modrého skla (obdélníky v pěti odstínech), pod ní
  // tmavá markýza a ustoupený prosklený parter, nízká klenutá šedá střecha (ortofoto). Běžný kód kreslí jen nízký sokl (h).
  zimni_stadion(b, { X, R, pushBox, pushQuad, tv }) {
    const F = frame2(b.p), g = b.g, P = (s, t, z) => tv(F.cx + F.u[0] * s + F.v[0] * t, F.cy + F.u[1] * s + F.v[1] * t, z);
    const z1 = g + 4.4, z2 = g + 5.1, z3 = g + 15.2, GLASS = C(52, 66, 84), CANOPY = C(66, 68, 74);
    const BLUES = [C(18, 52, 128), C(28, 84, 168), C(58, 118, 198), C(14, 36, 92), C(88, 150, 214), C(40, 100, 186)];
    const rect = [[F.s0, F.t0], [F.s1, F.t0], [F.s1, F.t1], [F.s0, F.t1]];
    const IN = 2.6;                                                      // parter ustoupený pod markýzou
    const inner = [[F.s0 + IN, F.t0 + IN], [F.s1 - IN, F.t0 + IN], [F.s1 - IN, F.t1 - IN], [F.s0 + IN, F.t1 - IN]];
    for (let i = 0; i < 4; i++) {
      const [a0, b0] = rect[i], [a1, b1] = rect[(i + 1) % 4], [c0, d0] = inner[i], [c1, d1] = inner[(i + 1) % 4];
      pushQuad(X, P(c0, d0, b.b), P(c1, d1, b.b), P(c1, d1, z1), P(c0, d0, z1), GLASS, [0.55, 1, 0, 0]);             // prosklený parter
      pushQuad(X, P(a0, b0, z1), P(a1, b1, z1), P(a1, b1, z2), P(a0, b0, z2), CANOPY, [0, 1, 0, 0]);                   // čelo markýzy
      pushQuad(X, P(a0, b0, z1), P(c0, d0, z1), P(c1, d1, z1), P(a1, b1, z1), CANOPY.map((q) => q * 0.7), [0, 1, 0, 0]); // podhled
      // skleněná mozaika: buňky 2,4 × 1,7 m, odstín podle polohy (stejný ve všech čtvercích)
      const len = Math.hypot(a1 - a0, b1 - b0), nc = Math.max(1, Math.round(len / 2.4)), nr = Math.round((z3 - z2) / 1.7);
      for (let c = 0; c < nc; c++) for (let r = 0; r < nr; r++) {
        const h = Math.abs(Math.sin((c + 1) * 12.9898 + (r + 1) * 78.233 + i * 37.719) * 43758.5453) % 1;
        const fa = c / nc, fb = (c + 1) / nc, za = z2 + (z3 - z2) * r / nr, zb = z2 + (z3 - z2) * (r + 1) / nr;
        const A = [a0 + (a1 - a0) * fa, b0 + (b1 - b0) * fa], B = [a0 + (a1 - a0) * fb, b0 + (b1 - b0) * fb];
        pushQuad(X, P(A[0], A[1], za), P(B[0], B[1], za), P(B[0], B[1], zb), P(A[0], A[1], zb), BLUES[Math.floor(h * BLUES.length)], [h > 0.9 ? 0.25 : 0, 1, 0, 0]);
      }
    }
    // střecha: římsa a nízká klenba přes kratší rozměr
    pushQuad(R, P(F.s0, F.t0, z3), P(F.s1, F.t0, z3), P(F.s1, F.t1, z3), P(F.s0, F.t1, z3), C(140, 142, 146), [0, 0, 0, 0]);
    vault(R, pushQuad, tv, rect.map(([s, t]) => [F.cx + F.u[0] * s + F.v[0] * t, F.cy + F.u[1] * s + F.v[1] * t]), F, z3 + 0.05, 3.2, C(150, 152, 156));
    return true;
  },
  // Hala II zimního stadionu: oválný půdorys, nízké stěny a bílá klenutá střecha (ortofoto, fotka z Commons)
  zimni_hala2(b, { R, pushQuad, tv }) {
    const F = frame2(b.p);
    vault(R, pushQuad, tv, b.p, F, b.e, 5.5, C(236, 236, 232), 8);
    return true;
  },
  // Terminál HD (P. Kotas, 2008): pole bílých membránových střech (3 bloky × 3 řady oblouků), mezi bloky dvě prosklené „lodě“
  // ve tvaru čočky s ocelovými žebry, nad jejich konci bílé stožáry do V s lany. Půdorys střechy z dat (142 × 78 m),
  // rozmístění lodí a polí z ortofota ČÚZK, tvar z fotek na Commons. Prosklené haly pod střechou kreslí běžný kód (nízké).
  terminal_hd(b, { X, R, ring, pushBox, pushQuad, pushTri, tv, frameAt }) {
    // samostatná stavba ('only') na středu střechy: rozměry a natočení z dat (střecha má díry, prep by ji rozřezal na kusy)
    let cx = 0, cy = 0; for (const [x, y] of b.p) { cx += x / b.p.length; cy += y / b.p.length; }
    const A = -5 * Math.PI / 180, u = [Math.cos(A), Math.sin(A)], v = [-u[1], u[0]];
    const F = { cx, cy, ang: A, u, v, s0: -71, s1: 71, t0: -39, t1: 39 };
    const g = b.g, Ls = F.s1 - F.s0, sm = 0, tm = 0;
    const P = (s, t, z) => tv(F.cx + F.u[0] * s + F.v[0] * t, F.cy + F.u[1] * s + F.v[1] * t, z);
    const WHITE = C(240, 240, 236), WHITE_D = C(214, 216, 214), GLASS = C(128, 160, 184), RIB = C(70, 84, 96), STEEL = C(228, 230, 232);
    const spine = [sm - 0.255 * Ls, sm + 0.255 * Ls], SW = 7.0;          // lodě: osa a poloviční šířka v nejširším místě
    const blocks = [[F.s0, spine[0] - SW - 0.5], [spine[0] + SW + 0.5, spine[1] - SW - 0.5], [spine[1] + SW + 0.5, F.s1]];
    const rows = 3, E = 7.6, TOP = 11.2;                                  // výška okraje a vrcholu membrány
    for (const [a, c] of blocks) for (let r = 0; r < rows; r++) {
      const t0 = F.t0 + (F.t1 - F.t0) * r / rows, t1 = F.t0 + (F.t1 - F.t0) * (r + 1) / rows, n = 8;
      for (let k = 0; k < n; k++) {                                        // oblouk napříč (t), rovně podél (s)
        const ta = t0 + (t1 - t0) * k / n, tb = t0 + (t1 - t0) * (k + 1) / n;
        const za = g + E + (TOP - E) * Math.sin(Math.PI * k / n), zb = g + E + (TOP - E) * Math.sin(Math.PI * (k + 1) / n);
        pushQuad(R, P(a, ta, za), P(c, ta, za), P(c, tb, zb), P(a, tb, zb), k < n / 2 ? WHITE : WHITE_D, [0, 0, 1, 0]);
      }
      for (const s of [a, c]) for (const t of [t0, t1]) pushBox(X, frameAt(...[F.cx + F.u[0] * s + F.v[0] * t, F.cy + F.u[1] * s + F.v[1] * t], 0, F.ang), -0.25, 0.25, -0.25, 0.25, g, g + E, STEEL, [0, 1, 0, 0]);
    }
    // prosklené lodě: čočka v půdorysu (šířka ~ sin podél t), klenutá do 14 m, žebra po 4 m
    for (const sc of spine) {
      const n = 12, hw = (k) => SW * Math.sin(Math.PI * k / n) + 0.6;
      for (let k = 0; k < n; k++) {
        const ta = F.t0 + (F.t1 - F.t0) * k / n, tb = F.t0 + (F.t1 - F.t0) * (k + 1) / n, wa = hw(k), wb = hw(k + 1);
        for (const sd of [-1, 1]) {
          pushQuad(R, P(sc + sd * wa, ta, g + E + 1), P(sc + sd * wb, tb, g + E + 1), P(sc + sd * wb * 0.35, tb, g + 14), P(sc + sd * wa * 0.35, ta, g + 14), GLASS, [0, 0, 0, 0]);
          pushQuad(R, P(sc + sd * wa * 0.35, ta, g + 14), P(sc + sd * wb * 0.35, tb, g + 14), P(sc, tb, g + 14.6), P(sc, ta, g + 14.6), GLASS.map((q) => q * 1.08), [0, 0, 0, 0]);
        }
        pushBox(X, frameAt(...[F.cx + F.u[0] * sc + F.v[0] * ta, F.cy + F.u[1] * sc + F.v[1] * ta], 0, F.ang), -wa * 0.9, wa * 0.9, -0.12, 0.12, g + E + 1, g + E + 1.5, RIB, [0, 1, 0, 0]);
      }
      // stožáry do V na obou koncích lodi s lany k hřebeni
      for (const te of [F.t0 - 2, F.t1 + 2]) for (const sd of [-1, 1]) {
        const bx = sc + sd * 1.2, tx = sc + sd * 6.5, H = 27;
        const base = [F.cx + F.u[0] * bx + F.v[0] * te, F.cy + F.u[1] * bx + F.v[1] * te], top = [F.cx + F.u[0] * tx + F.v[0] * te, F.cy + F.u[1] * tx + F.v[1] * te];
        const N = 6;
        for (let k = 0; k < N; k++) {
          const f0 = k / N, f1 = (k + 1) / N, p0 = [base[0] + (top[0] - base[0]) * f0, base[1] + (top[1] - base[1]) * f0], p1 = [base[0] + (top[0] - base[0]) * f1, base[1] + (top[1] - base[1]) * f1];
          ring(X, (s, t, h) => (h < g + H * f1 - 0.01 ? frameAt(p0[0], p0[1], 0, 0)(s, t, h) : frameAt(p1[0], p1[1], 0, 0)(s, t, h)), 0.32, 0.28, g + H * f0, g + H * f1, 6, STEEL, [0, 1, 0, 0]);
        }
        const tin = te + (te < tm ? 18 : -18);                              // lano od vrcholu stožáru k hřebeni lodi
        const a = tv(top[0], top[1], g + H), c = P(sc, tin, g + 14.6), d = 0.08;
        pushQuad(X, a, c, [c[0], c[1] + d, c[2]], [a[0], a[1] + d, a[2]], C(200, 202, 206), [0, 1, 0, 0]);
      }
    }
    return true;
  },
  // Fontána uprostřed okružní křižovatky Koruna: kruhová nádrž, osm bílých oblouků prohnutých ven jako koruna
  // (konce v noci svítí), uprostřed svislé hroty a modrý prstenec. Střed z ortofota ČÚZK, tvar z fotek na Commons.
  koruna(b, { X, R, ring, pushBox, frameAt, pushTri, tv }) {
    let cx = 0, cy = 0; for (const [x, y] of b.p) { cx += x / b.p.length; cy += y / b.p.length; }
    const g = b.g, f = frameAt(cx, cy, 0, 0), WHITE = C(242, 242, 240), WATER = SEASON === 'winter' ? C(186, 210, 228) : C(110, 186, 220);
    ring(X, f, 6.6, 6.6, g - 0.2, g + 0.45, 24, C(200, 200, 196), [0, 1, 1, 0]);               // obruba nádrže
    for (let k = 0; k < 24; k++) {                                                            // hladina
      const a0 = k / 24 * Math.PI * 2, a1 = (k + 1) / 24 * Math.PI * 2;
      pushTri(R, f(0, 0, g + 0.4), f(Math.cos(a0) * 6.3, Math.sin(a0) * 6.3, g + 0.4), f(Math.cos(a1) * 6.3, Math.sin(a1) * 6.3, g + 0.4), WATER, [0, 0, 0, 0]);
    }
    ring(X, f, 4.2, 4.2, g + 0.42, g + 0.55, 24, C(60, 120, 230), [0.9, 1, 0, 0]);             // modrý světelný prstenec
    for (let k = 0; k < 8; k++) {                                                             // oblouky koruny
      const a = (k + 0.5) / 8 * Math.PI * 2, N = 10, pt = (q) => [8 + 12.5 * q ** 1.8, 17 * (1 - (1 - q) ** 2)];
      for (let i = 0; i < N; i++) {
        const [r0, z0] = pt(i / N), [r1, z1] = pt((i + 1) / N), w0 = 0.55 - 0.3 * i / N, w1 = 0.55 - 0.3 * (i + 1) / N;
        const p0 = frameAt(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, 0, 0), p1 = frameAt(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, 0, 0);
        ring(X, (s, t, h) => (h < g + z1 - 0.001 ? p0(s, t, h) : p1(s, t, h)), w0, w1, g + z0, g + z1, 6, WHITE, [0, 1, 0, 0]);
      }
      const [rt, zt] = pt(1);
      pushBox(X, frameAt(cx + Math.cos(a) * rt, cy + Math.sin(a) * rt, 0, a), -0.45, 0.45, -0.45, 0.45, g + zt, g + zt + 0.8, C(255, 246, 220), [1, 1, 0, 0]);   // světlo
    }
    for (let k = 0; k < 5; k++) {                                                             // svislé hroty uprostřed
      const a = k / 5 * Math.PI * 2, ff = frameAt(cx + Math.cos(a) * 1.4, cy + Math.sin(a) * 1.4, 0, 0);
      ring(X, ff, 0.3, 0.05, g + 0.4, g + 9 + (k % 2) * 2.5, 6, WHITE, [0, 1, 0, 0]);
    }
    return true;
  },
  // Hotel Černigov (J. Zídka, 70. léta, ~55 m, nejvyšší budova města): bílá desková věž s vodorovnými pásy oken
  // na jižní části půdorysu, na severu nízká podnož. Půdorys z dat (v datech jen nízký), tvar z ortofota a fotek (archiweb.cz).
  cernigov(b, { X, R, W, pushBox, pushQuad, pushTri, tv }) {
    const F = frame2(b.p), g = b.g, P = (s, t, z) => tv(F.cx + F.u[0] * s + F.v[0] * t, F.cy + F.u[1] * s + F.v[1] * t, z);
    const sS = F.u[1] > 0 ? F.s0 : F.s1, sN = sS + (F.u[1] > 0 ? 62 : -62);   // jižní konec půdorysu a 62 m k severu
    const a = Math.min(sS, sN), s1 = Math.max(sS, sN), tm = (F.t0 + F.t1) / 2, hd = 8.2;
    const top = g + 55, WH = C(236, 236, 232), BAND = C(84, 96, 112), RED = C(196, 40, 52);
    const pts = [[a, tm - hd], [s1, tm - hd], [s1, tm + hd], [a, tm + hd]];
    for (let i = 0; i < 4; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % 4], side = i % 2 === 0;
      pushQuad(X, P(x0, y0, b.e), P(x1, y1, b.e), P(x1, y1, top), P(x0, y0, top), WH, [0, 1, 0, 0]);
      if (side) for (let z = b.e + 1.4; z < top - 2; z += 3.0) {           // pásy oken a lodžií na dlouhých stranách
        const o = (i === 0 ? -1 : 1) * 0.06;
        pushQuad(X, P(x0, y0 + o, z), P(x1, y1 + o, z), P(x1, y1 + o, z + 1.5), P(x0, y0 + o, z + 1.5), BAND, [0.45, 1, 0, 0]);
      } else for (let z = b.e + 1.4; z < top - 2; z += 3.0) {               // čela: úzký svislý pás oken uprostřed
        const o = (i === 1 ? 1 : -1) * 0.06, xm = (x0 + x1) / 2 + o;
        pushQuad(X, P(xm, tm - 1.6, z), P(xm, tm + 1.6, z), P(xm, tm + 1.6, z + 1.5), P(xm, tm - 1.6, z + 1.5), BAND, [0.45, 1, 0, 0]);
      }
    }
    pushQuad(R, P(a, tm - hd, top), P(s1, tm - hd, top), P(s1, tm + hd, top), P(a, tm + hd, top), C(160, 162, 164), [0, 0, 0, 0]);
    pushBox(X, (s, t, h) => P(a + 6 + s, tm + t, h), -3, 3, -hd - 0.8, hd + 0.8, top, top + 3.2, C(222, 222, 218), [0, 1, 1, 0]);   // strojovna
    pushBox(X, (s, t, h) => P(a + 30 + s, tm - hd - 0.1 + t, h), -9, 9, -0.12, 0, top - 4.2, top - 1.6, RED, [0.8, 1, 0, 0]);          // nápis na fasádě
    return true;
  },
  // Studijní a vědecká knihovna (Projektil, 2008): pohledový beton, tvar X, nepravidelně rozházená kruhová okna,
  // zlatavé svislé lamely nad vstupem. Hmotu kreslí běžný kód (zdi bez oken), tady se přidají okna a lamely.
  knihovna(b, { X, pushBox, frameAt }) {
    const DARK = C(52, 58, 66), GOLD = C(176, 132, 60);
    let longest = 0, li = 0;
    for (let i = 0; i < b.p.length; i++) {
      const [x0, y0] = b.p[i], [x1, y1] = b.p[(i + 1) % b.p.length], len = Math.hypot(x1 - x0, y1 - y0);
      if (len > longest) { longest = len; li = i; }
      if (len < 4) continue;
      const ang = Math.atan2(y1 - y0, x1 - x0), nx = (y1 - y0) / len, ny = -(x1 - x0) / len;   // normála ven (obrys proti směru hodin)
      for (let z = b.g + 2.2; z < b.e - 1.2; z += 2.6) for (let d = 1.5; d < len - 1.5; d += 2.2) {
        const h = Math.abs(Math.sin(d * 12.9898 + z * 78.233 + i * 3.17) * 43758.5453) % 1;
        if (h > 0.42) continue;                                                // rozházená okna, ne mřížka
        const x = x0 + (x1 - x0) * d / len + nx * 0.05, y = y0 + (y1 - y0) * d / len + ny * 0.05;
        pushBox(X, frameAt(x, y, 0, ang), -0.45, 0.45, -0.04, 0.04, z, z + 0.9, DARK, [0.5, 1, 0, 0]);
      }
    }
    const [x0, y0] = b.p[li], [x1, y1] = b.p[(li + 1) % b.p.length], len = longest, ang = Math.atan2(y1 - y0, x1 - x0);
    const nx = (y1 - y0) / len, ny = -(x1 - x0) / len, xm = (x0 + x1) / 2 + nx * 0.12, ym = (y0 + y1) / 2 + ny * 0.12;
    for (let k = -8; k <= 8; k++) pushBox(X, frameAt(xm + Math.cos(ang) * k * 0.55, ym + Math.sin(ang) * k * 0.55, 0, ang), -0.12, 0.12, -0.12, 0.12, b.g + 3.5, b.e - 0.3, GOLD, [0, 1, 0, 0]);
    return true;
  },
  // Regionální centrála ČSOB (Projektil + R. Brychta, 2021): zaoblená hmota, tmavé sklo mezi bílými vodorovnými pásy desek,
  // zelená střecha s atrii. Hmotu kreslí běžný kód (tmavé zdi, pásová okna), tady bílé pásy na každém podlaží.
  csob(b, { X, pushQuad, tv }) {
    const WH = C(234, 234, 230);
    for (let z = b.g + 3.9; z <= b.e + 0.01; z += 3.8) {
      const zz = Math.min(z, b.e);
      for (let i = 0; i < b.p.length; i++) {
        const [x0, y0] = b.p[i], [x1, y1] = b.p[(i + 1) % b.p.length], len = Math.hypot(x1 - x0, y1 - y0); if (len < 0.05) continue;
        const nx = (y1 - y0) / len * 0.35, ny = -(x1 - x0) / len * 0.35;
        pushQuad(X, tv(x0 + nx, y0 + ny, zz - 0.55), tv(x1 + nx, y1 + ny, zz - 0.55), tv(x1 + nx, y1 + ny, zz), tv(x0 + nx, y0 + ny, zz), WH, [0, 1, 0, 0]);
        pushQuad(X, tv(x0, y0, zz), tv(x1, y1, zz), tv(x1 + nx, y1 + ny, zz), tv(x0 + nx, y0 + ny, zz), WH, [0, 1, 0, 0]);
      }
    }
    return true;
  },
  // ---- Hučák (F. Sander, 1909–12), podle volně licencovaných fotek z jihu, ze zadu a v noci (podklady/hučák) ----
  // Jez s mostem: dvě jezová pole s přepadem a pěnou, nad nimi světlý most se segmentovými oblouky a balustrádou,
  // na pilíři mezi poli domek obsluhy s mansardou. Výšky z terénu (probe): horní voda, dolní voda a břehy na koncích mostu.
  jez_hucak(b, { X, R, frameAt, pushBox, pushQuad }) {
    let cx = 0, cy = 0; for (const [x, y] of b.p) { cx += x / b.p.length; cy += y / b.p.length; }
    const pr = b.probe || {}, up = pr.hore ?? b.g + 1.4, dn = pr.dole ?? b.g, deck = Math.max(pr.breh_z ?? up + 3, pr.breh_v ?? up + 3, up + 3.2);
    const A = [-31.0, 23.9], B = [27.0, -20.2];                          // konce mostu vůči středu (na březích)
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]), ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L;
    const ang = Math.atan2(uy, ux), mx = cx + (A[0] + B[0]) / 2, my = cy + (A[1] + B[1]) / 2;
    const f = frameAt(mx, my, 0, ang), hl = L / 2;                       // s podél mostu (západ -> východ), t napříč (+ proti proudu)
    const STONE = C(206, 204, 196), STONE_D = C(170, 168, 160), CONC = C(150, 148, 140), WHITE = C(236, 234, 226);
    const WATER = SEASON === 'winter' ? C(186, 210, 228) : C(64, 124, 190), FOAM = C(236, 242, 246), FOAM2 = C(184, 212, 230);
    // pilíře: pole 1 a 2 jsou jezová, třetí oblouk u budovy je odpad z turbín; krajní body jsou opěry na březích
    const piers = [-hl, -hl * 0.32, hl * 0.22, hl];
    for (const ps of piers.slice(1, -1)) {
      pushBox(X, f, ps - 2.2, ps + 2.2, -5.5, 4.5, dn - 0.5, deck, STONE_D, [0, 1, 1, 0], STONE);
      pushBox(X, f, ps - 2.6, ps + 2.6, -6.4, -5.2, dn - 0.5, dn + 1.2, CONC, [0, 1, 0, 0]);
    }
    for (let k = 0; k < piers.length - 1; k++) {
      const s0 = piers[k] + (k === 0 ? 0 : 2.2), s1 = piers[k + 1] - (k === piers.length - 2 ? 0 : 2.2), sp = s1 - s0;
      if (k < 2) {                                                       // jezové pole: horní voda, koruna, přepad, pěna
        pushQuad(R, f(s0, 0.6, up), f(s1, 0.6, up), f(s1, 14, up), f(s0, 14, up), WATER, [0, 0, 0, 0]);
        pushBox(X, f, s0, s1, -0.6, 0.6, dn - 0.4, up + 0.2, CONC, [0, 1, 1, 0]);
        const n = Math.max(3, Math.round(sp / 1.6));
        for (let i = 0; i < n; i++) {
          const a = s0 + sp * i / n, c = s0 + sp * (i + 1) / n;
          pushQuad(R, f(a, -0.6, up + 0.1), f(c, -0.6, up + 0.1), f(c, -3.8, dn + 0.08), f(a, -3.8, dn + 0.08), i % 2 ? FOAM : FOAM2, [0, 0, 0, 0]);
          const d = 3 + 3 * ((i * 7) % 5) / 5;
          pushQuad(R, f(a, -3.8, dn + 0.09), f(c, -3.8, dn + 0.09), f(c, -3.8 - d, dn + 0.09), f(a, -3.8 - d, dn + 0.09), i % 3 ? FOAM : FOAM2, [0, 0, 0, 0]);
        }
      }
      const rise = Math.min(4.5, deck - dn - 0.8), N = 10;                // segmentový oblouk: čela a podhled
      for (const tt of [-2.4, 2.4]) for (let i = 0; i < N; i++) {
        const a = s0 + sp * i / N, c = s0 + sp * (i + 1) / N;
        const za = deck - 1.0 - rise * (1 - Math.sin(Math.PI * i / N)), zc = deck - 1.0 - rise * (1 - Math.sin(Math.PI * (i + 1) / N));
        pushQuad(X, f(a, tt, za), f(c, tt, zc), f(c, tt, deck), f(a, tt, deck), tt < 0 ? STONE : STONE_D, [0, 1, 0, 0]);
        pushQuad(X, f(a, -2.4, za), f(c, -2.4, zc), f(c, 2.4, zc), f(a, 2.4, za), STONE_D.map((q) => q * 0.8), [0, 1, 0, 0]);
      }
    }
    pushQuad(R, f(-hl, -2.4, deck), f(hl, -2.4, deck), f(hl, 2.4, deck), f(-hl, 2.4, deck), C(178, 172, 164), [0, 0, 1, 0]);   // mostovka
    for (const tt of [-2.3, 2.3]) {                                       // balustráda: sloupky po 0,9 m a madlo
      for (let s = -hl + 0.5; s < hl; s += 0.9) pushBox(X, f, s - 0.12, s + 0.12, tt - 0.12, tt + 0.12, deck, deck + 0.95, WHITE, [0, 1, 0, 0]);
      pushBox(X, f, -hl, hl, tt - 0.2, tt + 0.2, deck + 0.95, deck + 1.15, WHITE, [0, 1, 1, 0]);
    }
    for (const ps of piers.slice(1, -1)) for (const tt of [-2.6, 2.6]) {  // lampy na pilířích (v noci svítí)
      pushBox(X, f, ps - 0.1, ps + 0.1, tt - 0.1, tt + 0.1, deck, deck + 3.4, C(60, 62, 66), [0, 1, 0, 0]);
      pushBox(X, f, ps - 0.3, ps + 0.3, tt - 0.3, tt + 0.3, deck + 3.4, deck + 4.0, C(255, 236, 190), [1, 1, 0, 0]);
    }
    // domek obsluhy jezu na prostředním pilíři: bílé zdi, tmavá mansarda, hrot
    const ks = piers[1], kf = (s, t, h) => f(ks + s, t - 1.0, h), M = C(72, 76, 84);
    pushBox(X, kf, -2.1, 2.1, -3.0, 3.0, deck, deck + 4.2, WHITE, [0.4, 1, 0, 0]);
    for (const [s0, s1] of [[-1.6, -0.5], [0.5, 1.6]]) pushBox(X, kf, s0, s1, -3.05, -2.98, deck + 1.6, deck + 3.4, C(60, 70, 84), [0.6, 1, 0, 0]);
    const z0 = deck + 4.2, z1 = deck + 6.4;
    pushQuad(R, kf(-2.4, -3.3, z0), kf(2.4, -3.3, z0), kf(1.6, -2.0, z1), kf(-1.6, -2.0, z1), M, [0, 0, 1, 0]);
    pushQuad(R, kf(2.4, 3.3, z0), kf(-2.4, 3.3, z0), kf(-1.6, 2.0, z1), kf(1.6, 2.0, z1), M, [0, 0, 1, 0]);
    pushQuad(R, kf(-2.4, 3.3, z0), kf(-2.4, -3.3, z0), kf(-1.6, -2.0, z1), kf(-1.6, 2.0, z1), M.map((q) => q * 0.9), [0, 0, 1, 0]);
    pushQuad(R, kf(2.4, -3.3, z0), kf(2.4, 3.3, z0), kf(1.6, 2.0, z1), kf(1.6, -2.0, z1), M.map((q) => q * 0.9), [0, 0, 1, 0]);
    pushQuad(R, kf(-1.6, -2.0, z1), kf(1.6, -2.0, z1), kf(1.6, 2.0, z1), kf(-1.6, 2.0, z1), M.map((q) => q * 1.1), [0, 0, 1, 0]);
    pushBox(X, kf, -0.06, 0.06, -0.06, 0.06, z1, z1 + 1.2, GOLD_HK, [0, 1, 0, 0]);
    return true;
  },
  // Hlavní budova Hučáku: červené cihly s bílými omítanými pásy, tmavá mansarda (kreslí běžný kód podle dominanty),
  // tady bílé římsy a hodinová věž na nároží u jezu: cihlový dřík s bílými lizénami, bílé patro s ciferníky (v noci svítí žlutě),
  // bílý zaoblený štít do řeky, strmá tmavá mansardová báň s hrotem.
  hucak_budova(b, { X, R, frameAt, pushBox, pushQuad, ring, tv }) {
    const WHITE = C(238, 234, 222), BRICK = C(178, 78, 52), SLATE = C(66, 70, 78), DIAL = C(250, 222, 120);
    bands(X, pushQuad, tv, b, [b.g + 0.9, b.g + 4.6, b.e - 0.5], WHITE);
    if (!b.tw || !b.tw.length) return true;
    const t = b.tw[0], f = frameAt(t.x, t.y, 0, t.a), T = 3.6, z1 = b.g + 14.0, z2 = b.g + 23.5, z3 = b.g + 30.5;
    pushBox(X, f, -T, T, -T, T, b.b, z1, BRICK, [0, 1, 0, 0]);
    for (const s of [-T, T]) for (const tt of [-T, T]) pushBox(X, f, s - 0.45, s + 0.45, tt - 0.45, tt + 0.45, b.b, z1, WHITE, [0, 1, 0, 0]);
    const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let z = b.g + 6; z < z1 - 1; z += 4.2) for (const [nx, ny] of SIDES)
      pushBox(X, f, nx ? nx * T - 0.05 : -0.7, nx ? nx * T + 0.05 : 0.7, ny ? ny * T - 0.05 : -0.7, ny ? ny * T + 0.05 : 0.7, z, z + 2.0, C(56, 62, 72), [0.5, 1, 0, 0]);
    pushBox(X, f, -T - 0.3, T + 0.3, -T - 0.3, T + 0.3, z1, z2, WHITE, [0, 1, 0, 0], WHITE);
    for (const [nx, ny] of SIDES) {
      const d = T + 0.36, r = 1.5, zc = (z1 + z2) / 2;
      for (let k = 0; k < 6; k++) {
        const v0 = -r + 2 * r * k / 6, v1 = -r + 2 * r * (k + 1) / 6, w = r * Math.sqrt(1 - (((v0 + v1) / 2) / r) ** 2);
        pushBox(X, f, nx ? nx * d - 0.05 : -w, nx ? nx * d + 0.05 : w, ny ? ny * d - 0.05 : -w, ny ? ny * d + 0.05 : w, zc + v0, zc + v1, DIAL, [0.95, 1, 0, 0]);
      }
    }
    const q = [[T + 0.4, z2], [T * 0.92, z2 + 4.6], [T * 0.45, z2 + 6.0], [0.25, z3]];   // mansardová báň
    for (let k = 0; k < q.length - 1; k++) ring(R, f, q[k][0] * Math.SQRT2, q[k + 1][0] * Math.SQRT2, q[k][1], q[k + 1][1], 4, SLATE.map((v) => v * (k === 1 ? 1.1 : 1)), [0, 0, 1, 0], Math.PI / 4);
    const N = 8, R0 = T + 0.1;                                            // bílý zaoblený štít na jižní straně (k jezu)
    for (let k = 0; k < N; k++) {
      const a0 = Math.PI * k / N, a1 = Math.PI * (k + 1) / N;
      pushQuad(X, f(-R0 * Math.cos(a0), -T - 0.42, z2), f(-R0 * Math.cos(a1), -T - 0.42, z2), f(-R0 * Math.cos(a1), -T - 0.42, z2 + 5.2 * Math.sin(a1)), f(-R0 * Math.cos(a0), -T - 0.42, z2 + 5.2 * Math.sin(a0)), WHITE, [0.15, 1, 0, 0]);
    }
    pushBox(X, f, -0.07, 0.07, -0.07, 0.07, z3, z3 + 2.4, GOLD_HK, [0, 1, 0, 0]);
    ring(X, f, 0.35, 0.35, z3 + 1.2, z3 + 1.7, 6, GOLD_HK, [0, 1, 0, 0]);
    return true;
  },
  // Strojovna Hučáku: dlouhá hala podél řeky, na straně do řeky velká půlkruhová okna v bílých rámech (po ~22 m),
  // bílé římsy a na hřebeni jehlanové lucerny. Hmota, střecha a cihlové zdi z běžného kódu.
  hucak_hala(b, { X, R, frameAt, pushBox, pushQuad, ring, tv }) {
    const WHITE = C(238, 234, 222), GLASS = C(60, 70, 82), SLATE = C(84, 88, 96);
    bands(X, pushQuad, tv, b, [b.g + 0.9, b.e - 0.4], WHITE);
    let best = null;                                                      // dlouhá stěna do řeky (normála nejvíc k západu)
    for (let i = 0; i < b.p.length; i++) {
      const [x0, y0] = b.p[i], [x1, y1] = b.p[(i + 1) % b.p.length], len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 15) continue;
      const nx = (y1 - y0) / len, ny = -(x1 - x0) / len;
      if (!best || nx < best.nx) best = { x0, y0, x1, y1, len, nx, ny };
    }
    if (best) {
      const { x0, y0, x1, y1, len, nx, ny } = best, ang = Math.atan2(y1 - y0, x1 - x0), n = Math.max(1, Math.round(len / 22));
      for (let k = 0; k < n; k++) {
        const d = len * (k + 0.5) / n, x = x0 + (x1 - x0) * d / len + nx * 0.06, y = y0 + (y1 - y0) * d / len + ny * 0.06;
        const fw = frameAt(x, y, 0, ang), r = Math.min(5.5, (b.e - b.g) * 0.42), zc = b.e - 1.2 - r, NS = 8;
        pushBox(X, fw, -r - 0.6, r + 0.6, -0.05, 0.05, b.g + 1.2, zc, WHITE, [0, 1, 0, 0]);
        pushBox(X, fw, -r, r, -0.09, 0.09, b.g + 1.6, zc, GLASS, [0.6, 1, 0, 0]);
        for (let i = 0; i < NS; i++) {
          const v0 = r * i / NS, v1 = r * (i + 1) / NS, w = Math.sqrt(Math.max(0, r * r - v1 * v1)), wo = Math.sqrt(Math.max(0, (r + 0.6) ** 2 - v0 * v0));
          pushBox(X, fw, -wo, wo, -0.05, 0.05, zc + v0, zc + v1, WHITE, [0, 1, 0, 0]);
          pushBox(X, fw, -w, w, -0.09, 0.09, zc + v0, zc + v1, GLASS, [0.6, 1, 0, 0]);
        }
        for (let s = -r + 1.2; s < r; s += 1.2) pushBox(X, fw, s - 0.06, s + 0.06, -0.11, 0.11, b.g + 1.6, zc + Math.sqrt(Math.max(0, r * r - s * s)), WHITE, [0, 1, 0, 0]);
      }
    }
    if (b.parts && b.parts.length) {                                      // lucerny na hřebeni
      const [pcx, pcy, pa, PL, PW] = b.parts.reduce((a, q) => (q[3] * q[4] > a[3] * a[4] ? q : a));
      const top = b.e + Math.min(PW / 2 * Math.tan(40 * Math.PI / 180), b.rh || 7);
      for (const t of [-0.25, 0.25]) {
        const fl = frameAt(pcx + Math.cos(pa) * PL * t, pcy + Math.sin(pa) * PL * t, 0, pa);
        pushBox(X, fl, -1.6, 1.6, -1.6, 1.6, top - 1.2, top + 1.4, WHITE, [0.3, 1, 0, 0]);
        ring(R, fl, 2.6, 0, top + 1.4, top + 4.4, 4, SLATE, [0, 0, 1, 0], Math.PI / 4);
        pushBox(X, fl, -0.06, 0.06, -0.06, 0.06, top + 4.4, top + 5.4, GOLD_HK, [0, 1, 0, 0]);
      }
    }
    return true;
  },

  // Křižovatka Mileta po přestavbě (2024–2026): čtyři podchody pro chodce a cyklisty pod rameny křižovatky.
  // Geometrie z OSM (assets/prestavby.json, popisky „Podchod 1–4“): tunel = osa pod vozovkou, r = rampy od portálů ven (26 m po cestě).
  // Souřadnice v metrech vůči bodu dominanty (50.20125, 15.83250). Terén mapy má krok 5 m, rampa se do něj zahloubit nedá:
  // zářez naznačí betonové zídky se zábradlím, tmavnoucí podlaha rampy a portál s osvětlením.
  mileta_podchody(b, { X, frameAt, pushBox }) {
    let cx = 0, cy = 0; for (const [x, y] of b.p) { cx += x / b.p.length; cy += y / b.p.length; }
    const g = b.g, CONC = C(196, 194, 188), CONC_D = C(150, 148, 144), RAIL = C(70, 76, 84), LAMP = C(255, 236, 190);
    const PODCHODY = [
      { w: 4, L: [[-7.47, -59.85], [14.57, -60.44]], r: [[[-7.47, -59.85], [-13.72, -59.62], [-15.48, -54.07], [-16.25, -52.57], [-17.54, -50.06], [-21.8, -45.07], [-23.66, -42.9]], [[14.57, -60.44], [22.81, -60.74], [23.68, -52.11], [25.62, -47.82], [28.47, -44.5]]] },
      { w: 4, L: [[47.67, -2.39], [41.77, -34.2]], r: [[[47.67, -2.39], [50.18, 8.55], [51.24, 11.26], [56.51, 21.89]], [[41.77, -34.2], [41.73, -35.17], [41.54, -40.34], [36.47, -40.71], [32.5, -41.79], [29.35, -43.47], [25.62, -47.82], [25.06, -49.06]]] },
      { w: 4, L: [[-20.9, 28.95], [4.52, 24.57]], r: [[[-20.9, 28.95], [-24.16, 29.46], [-27.48, 29.61], [-30.79, 30.92], [-33.92, 32.72], [-36.48, 34.75], [-38.75, 37.77], [-40.47, 41.12], [-40.69, 42.5]], [[4.52, 24.57], [14.77, 22.58], [25.5, 20.48], [30.02, 19.51]]] },
      { w: 4, L: [[-55.34, 15.35], [-60.92, -13.55]], r: [[[-55.34, 15.35], [-54.3, 19.2], [-53.36, 21.44], [-52.3, 23.6], [-50.8, 26.28], [-48.39, 30.65], [-45.39, 38.04], [-45.01, 39.11]], [[-60.92, -13.55], [-61.92, -17.39], [-52.46, -20.36], [-46.31, -23.46], [-42.81, -25.81], [-41.97, -26.38]]] },
    ];
    const RAMP = 20;                                                       // délka zářezu rampy od portálu
    for (const pd of PODCHODY) {
      const hw = pd.w / 2 + 0.25;
      for (const r of pd.r) {
        // portál: čelní zeď nad tunelem (kolmo na směr rampy), tmavý otvor, světelný pás nad otvorem
        const [p0, p1] = [r[0], r[1]], a0 = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
        const fp = frameAt(cx + p0[0], cy + p0[1], 0, a0);
        pushBox(X, fp, -0.7, 0.0, -hw - 0.9, hw + 0.9, g - 0.3, g + 1.15, CONC, [0, 1, 0, 0]);
        pushBox(X, fp, 0.0, 0.04, -pd.w / 2, pd.w / 2, g - 0.3, g + 0.55, C(22, 22, 26), [0, 1, 0, 0]);        // otvor
        pushBox(X, fp, 0.04, 0.1, -pd.w / 2 + 0.3, pd.w / 2 - 0.3, g + 0.6, g + 0.72, LAMP, [0.9, 1, 0, 0]); // osvětlení
        pushBox(X, fp, -0.75, 0.05, -hw - 0.95, hw + 0.95, g + 1.15, g + 1.25, CONC_D, [0, 1, 0, 0]);         // římsa
        // zářez rampy: zídky s madlem po obou stranách, podlaha od portálu tmavá (hloubka), ke konci světlá
        let run = 0;
        for (let i = 0; i < r.length - 1 && run < RAMP; i++) {
          const [x0, y0] = r[i], [x1, y1] = r[i + 1];
          const len = Math.min(Math.hypot(x1 - x0, y1 - y0), RAMP - run); if (len < 0.2) continue;
          const a = Math.atan2(y1 - y0, x1 - x0), f = frameAt(cx + x0, cy + y0, 0, a);
          const k0 = run / RAMP, k1 = (run + len) / RAMP;
          const zw0 = g + 1.0 - 0.8 * k0, zw1 = g + 1.0 - 0.8 * k1;                  // zídka u portálu vyšší, ke konci rampy klesá
          const N = Math.max(1, Math.ceil(len / 2));
          for (let k = 0; k < N; k++) {
            const s0 = len * k / N, s1 = len * (k + 1) / N + 0.25, t = (run + (s0 + s1) / 2) / RAMP;
            const zt = zw0 + (zw1 - zw0) * (k + 0.5) / N, sh = Math.round(46 + 90 * Math.min(1, t * 1.25));
            pushBox(X, f, s0, s1, -pd.w / 2, pd.w / 2, g, g + 0.05, C(sh, sh, sh + 4), [0, 1, 0, 0]);       // podlaha
            for (const sd of [-1, 1]) {
              pushBox(X, f, s0, s1, sd * hw - 0.15, sd * hw + 0.15, g - 0.3, zt, CONC, [0, 1, 0, 0]);         // zídka
              pushBox(X, f, s0, s1, sd * hw - 0.04, sd * hw + 0.04, zt + 0.85, zt + 0.92, RAIL, [0, 1, 0, 0]); // madlo
              if (k % 1 === 0) pushBox(X, f, s0, s0 + 0.06, sd * hw - 0.03, sd * hw + 0.03, zt, zt + 0.9, RAIL, [0, 1, 0, 0]);
            }
          }
          run += len;
        }
      }
    }
    return true;
  },

  // Malšovická aréna / FINEP Arena (2023, Tomáš Vymetálek Architects) podle ortofota ČÚZK a fotek z Wikimedia Commons:
  // zaoblený obdélník tribun 140 × 100 m (osa 110,4°), fasáda ze svislých stříbrných perforovaných lamel nad tmavým parterem
  // se zlatou linkou, bílá membránová střecha na ocelových příhradovinách s otvorem nad hřištěm, na západě hlavní tribuna
  // s budovou a nápisem STADION HRADEC KRÁLOVÉ, u severní tribuny velkoplošná obrazovka. Čtyři „lízátka“ (stožáry osvětlení
  // Všesportovního stadionu z roku 1975, 55 m, terč přes 10 m) stojí na bodech z OSM, dřík je nakloněný ke hřišti a podepřený vzpěrou.
  // Barevné LED fasády, rozsvícená lízátka a obsah obrazovky kreslí animovaná vrstva (assets/custom_web.js), ne dlaždice.
  // Rozměry sdílí s custom_web.js (ARENA) – při změně upravit obojí.
  malsovicka_arena(b, { X, W, R, frameAt, ring, pushBox, pushQuad, pushTri, tv }) {
    let cx = 0, cy = 0; for (const [x, y] of b.p) { cx += x / b.p.length; cy += y / b.p.length; }
    const g = b.g, A = 110.4 * Math.PI / 180, f = frameAt(cx, cy, 0, A);
    const FAS = C(206, 209, 213), LAM = C(168, 173, 180), PLINTH = C(48, 52, 58), GOLD = C(196, 160, 82), GLASS = C(72, 84, 98);
    const ROOF = C(236, 238, 236), TRUSS = C(150, 156, 164), SEAT = C(74, 78, 86), SEAT_L = C(104, 108, 116), BOARD = C(36, 40, 48);
    const solid = [0, 1, 0, 0];
    const OUT = arenaRing(70, 50, 15), IN = arenaRing(56.5, 36.5, 7), ST0 = arenaRing(54, 35, 4), ST1 = arenaRing(67, 47.5, 12.5);
    const H0 = 17.0, H1 = 19.2, n = OUT.length;
    const lerp = (p0, p1, t) => [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
    // fasáda jednoho úseku: tmavý parter s prosklením, zlatá linka, stříbrné lamely (tmavší vystouplé pásky po 1,6 m)
    const facade = (a0, b0, a1, b1, top) => {
      pushQuad(X, f(a0, b0, g - 0.6), f(a1, b1, g - 0.6), f(a1, b1, g + 3.2), f(a0, b0, g + 3.2), PLINTH, solid);
      pushQuad(X, f(a0, b0, g + 1.0), f(a1, b1, g + 1.0), f(a1, b1, g + 2.8), f(a0, b0, g + 2.8), GLASS, [0.4, 1, 0, 0]);
      pushQuad(X, f(a0, b0, g + 3.2), f(a1, b1, g + 3.2), f(a1, b1, g + 3.55), f(a0, b0, g + 3.55), GOLD, solid);
      pushQuad(X, f(a0, b0, g + 3.55), f(a1, b1, g + 3.55), f(a1, b1, g + top), f(a0, b0, g + top), FAS, solid);
      const len = Math.hypot(a1 - a0, b1 - b0), nx = (b1 - b0) / len, ny = -(a1 - a0) / len, cnt = Math.max(1, Math.round(len / 1.6));
      for (let k = 0; k < cnt; k++) {
        const p = (t) => [a0 + (a1 - a0) * t + nx * 0.12, b0 + (b1 - b0) * t + ny * 0.12];
        const [u0, v0] = p((k + 0.15) / cnt), [u1, v1] = p((k + 0.45) / cnt);
        pushQuad(X, f(u0, v0, g + 3.7), f(u1, v1, g + 3.7), f(u1, v1, g + top - 0.3), f(u0, v0, g + top - 0.3), LAM, solid);
      }
    };
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, [a0, b0] = OUT[i], [a1, b1] = OUT[j];
      const west = (b0 + b1) / 2 > 46 && Math.abs((a0 + a1) / 2) < 36;                        // úsek zakrytý budovou hlavní tribuny
      if (!west) facade(a0, b0, a1, b1, H0);
      // střecha: od vnější hrany (H0) k okraji otvoru (H1), bílá membrána
      const [c0, d0] = IN[i], [c1, d1] = IN[j];
      pushQuad(R, f(a0, b0, g + H0), f(a1, b1, g + H0), f(c1, d1, g + H1), f(c0, d0, g + H1), ROOF, [0, 0, 1, 0]);
      // příhradový vazník nad střechou v každém druhém bodě a obvodový nosník u otvoru
      if (i % 2 === 0) {
        const q = [a0 - c0, b0 - d0], L = Math.hypot(...q), ux = -q[1] / L * 0.14, uy = q[0] / L * 0.14;
        for (const [z0, z1] of [[0.05, 0.25], [1.2, 1.5]])
          pushQuad(X, f(a0 - ux, b0 - uy, g + H0 + z0), f(a0 + ux, b0 + uy, g + H0 + z0), f(c0 + ux, d0 + uy, g + H1 + z1), f(c0 - ux, d0 - uy, g + H1 + z1), TRUSS, solid);
        pushQuad(X, f(a0, b0, g + H0), f(a0, b0, g + H0 + 0.6), f(c0, d0, g + H1 + 1.5), f(c0, d0, g + H1), TRUSS, solid);
      }
      pushQuad(X, f(c0, d0, g + H1 - 1.0), f(c1, d1, g + H1 - 1.0), f(c1, d1, g + H1 + 0.3), f(c0, d0, g + H1 + 0.3), TRUSS, solid);
      // hlediště pod střechou (vidět otvorem): šest pásů od mantinelu nahoru, světlejší řady
      for (let r_ = 0; r_ < 6; r_++) {
        const t0 = r_ / 6, t1 = (r_ + 1) / 6;
        const A0 = lerp(ST0[i], ST1[i], t0), A1 = lerp(ST0[j], ST1[j], t0), B0 = lerp(ST0[i], ST1[i], t1), B1 = lerp(ST0[j], ST1[j], t1);
        pushQuad(X, f(...A0, g + 1.2 + 13 * t0), f(...A1, g + 1.2 + 13 * t0), f(...B1, g + 1.2 + 13 * t1), f(...B0, g + 1.2 + 13 * t1), r_ % 2 ? SEAT_L : SEAT, solid);
      }
      pushQuad(X, f(...ST0[i], g), f(...ST0[j], g), f(...ST0[j], g + 1.2), f(...ST0[i], g + 1.2), BOARD, [0.25, 1, 0, 0]);   // reklamní mantinel
    }
    // budova hlavní tribuny na západě (t 47 … 73, s −36 … 40): lamelová fasáda, technika na střeše, nápis a znak klubu
    const BW = [[-36, 47], [40, 47], [40, 73], [-36, 73]];
    for (let i = 1; i < 4; i++) facade(...BW[i], ...BW[(i + 1) % 4], H0 + 0.5);
    pushQuad(R, f(-36, 47, g + H0 + 0.5), f(40, 47, g + H0 + 0.5), f(40, 73, g + H0 + 0.5), f(-36, 73, g + H0 + 0.5), C(176, 178, 178), [0, 0, 1, 0]);
    for (const [s0, t0, w_, d_, h_] of [[-20, 52, 9, 6, 2.2], [-6, 58, 6, 5, 1.6], [10, 54, 12, 7, 2.6], [26, 60, 6, 6, 1.8]])
      pushBox(X, f, s0, s0 + w_, t0, t0 + d_, g + H0 + 0.5, g + H0 + 0.5 + h_, C(150, 152, 154), [0, 1, 1, 0]);
    // nápis STADION / HRADEC KRÁLOVÉ a kulatý znak klubu na západní fasádě (t = 73), tmavé litery
    const sign = (s0, s1, z0, z1, letters) => {
      const w_ = (s1 - s0) / letters;
      for (let k = 0; k < letters; k++) pushBox(X, f, s0 + k * w_ + w_ * 0.15, s0 + (k + 1) * w_ - w_ * 0.15, 73.05, 73.25, g + z0, g + z1, C(40, 44, 54), solid);
    };
    sign(-4, 14, 10.6, 13.4, 7); sign(-8, 18, 7.6, 9.6, 14);
    pushBox(X, f, -15, -10, 73.05, 73.3, g + 7.4, g + 12.4, C(236, 236, 232), solid);
    pushBox(X, f, -14.2, -10.8, 73.3, 73.4, g + 8.2, g + 11.6, C(30, 30, 34), solid);
    // velkoplošná obrazovka u severní tribuny (s ≈ 60, t = 0), obrazem k hřišti; obsah kreslí animovaná vrstva
    for (const t_ of [-5.5, 5.5]) pushBox(X, f, 60.6, 61.2, t_ - 0.3, t_ + 0.3, g + H0, g + 27.2, TRUSS, solid);
    pushBox(X, f, 60.0, 60.6, -7.4, 7.4, g + 19.3, g + 26.9, C(58, 62, 70), solid);              // skříň
    pushBox(X, f, 59.85, 60.0, -6.9, 6.9, g + 19.7, g + 26.5, C(14, 16, 22), [0.2, 1, 0, 0]);     // stínítko
    // lízátka: pata stožáru vůči středu hřiště (východ, sever) z OSM; dřík nakloněný ke hřišti, vzpěra, terč 11 m skloněný ke hřišti
    const MAST = C(54, 58, 64), RIM = C(214, 218, 222), LAMPC = C(186, 192, 198), GRID = C(96, 102, 110);
    for (const [dx, dy] of ARENA_MASTS) {
      const x0 = cx + dx, y0 = cy + dy, d = Math.hypot(dx, dy), ux = -dx / d, uy = -dy / d;     // směr ke středu
      const top = 53, lean = 10, N = 8;
      for (let k = 0; k < N; k++) {                                                            // zužující se nakloněný dřík
        const t0 = k / N, t1 = (k + 1) / N, r0 = 0.95 - 0.5 * t0, r1 = 0.95 - 0.5 * t1;
        const p0 = frameAt(x0 + ux * lean * t0, y0 + uy * lean * t0, 0, 0), p1x = x0 + ux * lean * t1, p1y = y0 + uy * lean * t1;
        ring(X, (s, t, h) => (h < g + top * t1 - 0.01 ? p0(s, t, h) : frameAt(p1x, p1y, 0, 0)(s, t, h)), r0, r1, g + top * t0, g + top * t1, 6, MAST, solid);
      }
      // vzpěra: od paty 9 m dál od hřiště k dříku ve 45 % výšky
      const bx = x0 - ux * 9, by = y0 - uy * 9, jx = x0 + ux * lean * 0.45, jy = y0 + uy * lean * 0.45, jz = g + top * 0.45;
      const sx_ = -uy * 0.25, sy_ = ux * 0.25;
      pushQuad(X, tv(bx - sx_, by - sy_, g), tv(bx + sx_, by + sy_, g), tv(jx + sx_, jy + sy_, jz), tv(jx - sx_, jy - sy_, jz), MAST, solid);
      pushQuad(X, tv(bx, by, g), tv(bx - ux * 0.5, by - uy * 0.5, g), tv(jx - ux * 0.4, jy - uy * 0.4, jz), tv(jx, jy, jz), MAST, solid);
      // terč: rovina kolmá na směr ke hřišti, skloněná o 18° dolů; obvodový prstenec, řady reflektorů, zezadu tmavá mřížka
      const fx = x0 + ux * lean, fy = y0 + uy * lean, tl = 18 * Math.PI / 180, R0 = 5.6, rx = -uy, ry = ux;
      const P = (a, v, o = 0) => tv(fx + rx * a + ux * (o - v * Math.sin(tl)), fy + ry * a + uy * (o - v * Math.sin(tl)), g + top + v * Math.cos(tl));
      const M = 20, cs = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
      for (let k = 0; k < M; k++) {
        const a0 = 2 * Math.PI * k / M, a1 = 2 * Math.PI * (k + 1) / M;
        for (const o of [0.25, -0.25]) pushQuad(X, P(...cs(R0, a0), o), P(...cs(R0, a1), o), P(...cs(R0 - 0.7, a1), o), P(...cs(R0 - 0.7, a0), o), RIM, solid);
        pushQuad(X, P(...cs(R0, a0), 0.25), P(...cs(R0, a1), 0.25), P(...cs(R0, a1), -0.25), P(...cs(R0, a0), -0.25), RIM, solid);
      }
      for (let r_ = -4; r_ <= 4; r_++) {
        const v = r_ * 1.15, w_ = Math.sqrt(Math.max(0, (R0 - 0.7) ** 2 - v * v));
        if (w_ < 0.5) continue;
        pushQuad(X, P(-w_, v - 0.4, 0.05), P(w_, v - 0.4, 0.05), P(w_, v + 0.4, 0.05), P(-w_, v + 0.4, 0.05), LAMPC, solid);
        pushQuad(X, P(-w_, v - 0.55, -0.2), P(w_, v - 0.55, -0.2), P(w_, v + 0.55, -0.2), P(-w_, v + 0.55, -0.2), GRID, solid);
      }
    }
    return true;
  },

  // Gymnázium J. K. Tyla (Josef Gočár, 1925–27): cihlová křídla s plochými střechami (kreslí je běžný kód podle dominanty),
  // uprostřed lomeného průčelí vyšší blok se světlou omítnutou fasádou a mřížkou oken, po stranách dva vysoké cihlové pylony,
  // v předprostoru bílý sloup se sochou. Poloha: věž 'pt' = vrchol lomeného průčelí (ověřeno na ortofotu ČÚZK).
  gymnazium_tyl(b, { X, W, R, frameAt, ring, pushBox, pushQuad, pushTri, tv }) {
    if (!b.tw || !b.tw.length) return false;
    const ax = b.tw[0].x, ay = b.tw[0].y, g = b.g;
    const P = ([x, y]) => [ax + x, ay + y];                          // body vůči vrcholu průčelí (východ, sever)
    const BRICK = C(184, 90, 58), CREAM = C(214, 206, 184), ROOF = C(92, 92, 94);
    // vyšší střední blok: přední lomená čára průčelí a zadní hrana o 11 m dál
    const front = [[-16, -11], [-4, -3], [6, -5], [14, -17]], back = [[14, -6], [6, 6], [-4, 8], [-16, 0]];
    const pts = [...front, ...back].map(P);                          // průčelí na východ, zadní hrana zpět: proti směru hodin
    const nf = front.length - 1;                                     // stěny 0..nf-1 jsou průčelí (světlá omítka), ostatní cihla
    prism(W, R, pushQuad, pushTri, tv, g, pts, b.b, g + 22.5, (i) => (i < nf ? CREAM : BRICK), 1, ROOF);
    // cihlová atika s řadou oken nad světlou fasádou
    for (let k = 0; k < nf; k++) {
      const [x0, y0] = P(front[k]), [x1, y1] = P(front[k + 1]);
      wall(W, pushQuad, tv, g, x0, y0, x1, y1, g + 19.6, g + 22.5, BRICK, 1);
    }
    // pylony na koncích světlé fasády
    for (const [x, y] of [front[0], front[nf]].map(P)) pushBox(X, frameAt(x, y, 0, 0), -2.8, 2.8, -2.8, 2.8, b.b, g + 25.0, BRICK, [0, 1, 1, 0], ROOF);
    // sokl a schodiště před vchodem
    const [sx, sy] = P([1, -9]);
    pushBox(X, frameAt(sx, sy, 0, -0.35), -9, 9, -3.5, 3.5, b.b, g + 0.9, C(176, 172, 164), [0, 1, 1, 0]);
    // bílý sloup se sochou v předprostoru
    const [cx, cy] = P([0, -19]), f = frameAt(cx, cy, 0, 0);
    pushBox(X, f, -1.2, 1.2, -1.2, 1.2, g - 0.2, g + 1.2, C(200, 198, 192), [0, 1, 1, 0]);
    ring(X, f, 0.45, 0.4, g + 1.2, g + 10.5, 8, C(236, 234, 228), [0, 1, 0, 0]);
    pushBox(X, f, -0.6, 0.6, -0.6, 0.6, g + 10.5, g + 11.0, C(236, 234, 228), [0, 1, 1, 0]);
    ring(X, f, 0.35, 0.25, g + 11.0, g + 12.8, 6, C(70, 74, 68), [0, 1, 0, 0]);       // socha (tmavý bronz)
    pushBox(X, f, -0.08, 0.08, -0.7, 0.7, g + 12.2, g + 12.5, C(70, 74, 68), [0, 1, 0, 0]);
    return true;
  },

  // Bílá věž (1574–1589, renesanční zvonice z pískovce, 68,5 m): odstupňovaný hranolový dřík s římsami,
  // pár obloukových oken na patro, velké černé ciferníky se zlatými číslicemi, ochoz s balustrádou,
  // nízký osmiboký nástavec, tmavá zvonovitá báně – lucerna – cibulka – jehla se zlatou makovicí.
  bila_vez(b, { X, R, frameAt, ring, pushBox, GOLDC }) {
    const { cx, cy, ang } = axis(b.p), g = b.g, f = frameAt(cx, cy, 0, ang);
    const STONE = C(150, 140, 124), STONE_D = C(126, 118, 106), CORN = C(170, 160, 140);   // zvětralý šedohnědý pískovec
    const HELM = C(56, 60, 62), WIN = C(44, 46, 52), DIAL = C(28, 28, 30);
    const solid = [0, 1, 1, 0];
    // dřík po stupních: [polovina šířky, od, do]; mezi stupni vystupující římsa
    const stages = [[5.1, -0.8, 19.0], [4.75, 19.0, 37.5], [4.5, 37.5, 46.0]];
    stages.forEach(([T, z0, z1], k) => {
      pushBox(X, f, -T, T, -T, T, g + z0, g + z1, k === 0 ? STONE_D : STONE, solid);
      pushBox(X, f, -T - 0.35, T + 0.35, -T - 0.35, T + 0.35, g + z1 - 0.7, g + z1, CORN, solid);   // římsa
    });
    // okna: pár úzkých obloukových oken na každé straně ve vyšších patrech, jedno v přízemí
    const face = (T, fn) => { for (const [nx, ny] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) fn(nx, ny, T + 0.04); };
    const win = (T, z0, z1, offs, w = 0.55) => face(T, (nx, ny, d) => {
      for (const o of offs) {
        const s = nx ? nx * d : o, t = ny ? ny * d : o;
        pushBox(X, f, s - (nx ? 0.06 : w), s + (nx ? 0.06 : w), t - (ny ? 0.06 : w), t + (ny ? 0.06 : w), g + z0, g + z1, WIN, [0.35, 1, 0, 0]);
      }
    });
    win(5.1, 9.0, 12.5, [0]);
    win(4.75, 23.0, 27.0, [-1.6, 1.6]);
    win(4.75, 30.5, 34.5, [-1.6, 1.6]);
    // ciferníky (průměr 2,9 m) ve stupni pod ochozem: zlatý kruh a v něm černý, poskládané z vodorovných pásků; v noci svítí
    const disc = (nx, ny, d, r, zc, col, aw) => {
      const n = 7;
      for (let k = 0; k < n; k++) {
        const v0 = -r + 2 * r * k / n, v1 = -r + 2 * r * (k + 1) / n, vm = (v0 + v1) / 2, w = r * Math.sqrt(1 - (vm / r) ** 2);
        const s = nx * d, t = ny * d;
        pushBox(X, f, nx ? s - 0.05 : s - w, nx ? s + 0.05 : s + w, ny ? t - 0.05 : t - w, ny ? t + 0.05 : t + w, zc + v0, zc + v1, col, aw);
      }
    };
    face(4.5, (nx, ny, d) => {
      disc(nx, ny, d + 0.02, 1.45, g + 41.7, GOLDC, [0.6, 1, 0, 0]);
      disc(nx, ny, d + 0.08, 1.2, g + 41.7, DIAL, [0.45, 1, 0, 0]);
    });
    // ochoz: deska s přesahem a balustráda
    const G = 5.3, z = g + 46.0;
    pushBox(X, f, -G, G, -G, G, z, z + 0.45, CORN, solid);
    for (const [s0, s1, t0, t1] of [[-G, G, -G, -G + 0.25], [-G, G, G - 0.25, G], [-G, -G + 0.25, -G, G], [G - 0.25, G, -G, G]])
      pushBox(X, f, s0, s1, t0, t1, z + 0.45, z + 1.5, STONE, solid);
    // čtvercová zvonice nad ochozem: na každé straně tři obloukové otvory (tmavé, v noci prosvítá teplé světlo)
    const B = 3.9;
    pushBox(X, f, -B, B, -B, B, z + 0.45, z + 4.6, STONE, solid);
    face(B, (nx, ny, d) => {
      for (const o of [-2.2, 0, 2.2]) {
        const s = nx ? nx * d : o, t = ny ? ny * d : o;
        pushBox(X, f, s - (nx ? 0.06 : 0.7), s + (nx ? 0.06 : 0.7), t - (ny ? 0.06 : 0.7), t + (ny ? 0.06 : 0.7), z + 1.2, z + 3.9, C(92, 52, 40), [0.5, 1, 0, 0]);
      }
    });
    pushBox(X, f, -B - 0.3, B + 0.3, -B - 0.3, B + 0.3, z + 4.6, z + 5.0, CORN, solid);
    // zvonovitá báně (prohnutý profil), lucerna, cibulka, jehla
    const bell = [[4.1, 0.0], [3.5, 1.6], [2.4, 3.2], [1.5, 4.4], [1.15, 5.4]];
    for (let k = 0; k < bell.length - 1; k++)
      ring(R, f, bell[k][0], bell[k + 1][0], z + 5.0 + bell[k][1], z + 5.0 + bell[k + 1][1], 8, HELM, [0, 0, 0, 0], Math.PI / 8);
    const zl = z + 10.4;
    ring(X, f, 1.05, 1.05, zl, zl + 2.6, 8, HELM, solid, Math.PI / 8);                    // lucerna
    for (let k = 0; k < 8; k += 2) {
      const a = Math.PI / 4 + k * Math.PI / 4, r = 1.05 * Math.cos(Math.PI / 8) + 0.03;
      const ff = frameAt(cx + Math.cos(ang + a) * r, cy + Math.sin(ang + a) * r, 0, ang + a);
      pushBox(X, ff, -0.06, 0.06, -0.2, 0.2, zl + 0.6, zl + 2.0, C(210, 196, 150), [0.5, 1, 0, 0]);
    }
    const onion = [[1.25, 0.0], [1.5, 0.6], [1.25, 1.3], [0.5, 2.0], [0.18, 2.6]];
    for (let k = 0; k < onion.length - 1; k++)
      ring(R, f, onion[k][0], onion[k + 1][0], zl + 2.6 + onion[k][1], zl + 2.6 + onion[k + 1][1], 8, HELM, [0, 0, 0, 0], Math.PI / 8);
    const zs = zl + 5.2;
    ring(R, f, 0.22, 0, zs, g + 68.5, 8, HELM, [0, 0, 0, 0]);                              // jehla
    ring(X, f, 0.35, 0.35, g + 66.2, g + 66.9, 8, GOLDC, [0, 1, 0, 0]);                    // makovice
    pushBox(X, f, -0.07, 0.07, -0.07, 0.07, g + 68.5, g + 71.0, GOLDC, [0, 1, 0, 0]);        // kříž
    pushBox(X, f, -0.07, 0.07, -0.55, 0.55, g + 70.0, g + 70.2, GOLDC, [0, 1, 0, 0]);
    return true;
  },
  // Lávka u Aldisu (2023, UHPC): bílá štíhlá mostovka 102 m, hlavní pole ~66 m přes Labe bez pilíře v řece, za ním pilíř do V
  // na východním břehu. Ocelová žebra po 2,5 m sledují spodní pás ze dvou předpjatých lan a nad mostovkou pokračují jako
  // sloupky zábradlí (1,3 m) prohnuté ven, v madle LED. Na západním konci široké schodiště do předpolí, na východě končí
  // v úrovni plochy u ČSOB. Pod lávkou na východním břehu náplavka: dřevěné sedací schody k vodě a malé molo (fotka 2024).
  // Půdorys z OSM (obrys mostu, molo), výšky z DMR přes "probe", tvar z volně licencovaných fotek (landmarks_ref/lavka_aldis).
  lavka_aldis(b, { X, frameAt, pushBox, pushQuad }) {
    let cx = 0, cy = 0; for (const [x, y] of b.p) { cx += x / b.p.length; cy += y / b.p.length; }
    const pr = b.probe || {}, g = b.g;
    const Zw = (pr.zapad ?? g + 3.4) + 1.05, Ze = (pr.vychod ?? g + 5.9) + 0.06, Zc = (pr.voda ?? g) + 7.2;
    const A0 = [-45.66, -2.7], A1 = [66.26, 10.3], L = Math.hypot(A1[0] - A0[0], A1[1] - A0[1]);
    const ang = Math.atan2(A1[1] - A0[1], A1[0] - A0[0]), f = frameAt(cx + A0[0], cy + A0[1], 0, ang);
    const SC = 38, SP = 70;                                                 // vrchol nivelety, pilíř do V
    const zd = (s) => s <= SC ? Zw + (Zc - Zw) * (1 - Math.cos(Math.PI * Math.max(0, s) / SC)) / 2
                              : Ze + (Zc - Ze) * (1 + Math.cos(Math.PI * Math.min(L, s - SC) / (L - SC))) / 2;
    const dep = (s) => s < SP ? 0.45 + 1.75 * Math.sin(Math.PI * Math.max(0, s - 3) / (SP - 3)) : 0.4 + 0.85 * Math.sin(Math.PI * Math.min(1, (s - SP) / (L - SP - 2)));
    const WHITE = C(246, 246, 244), DECK = C(222, 222, 218), EDGE = C(240, 240, 238), CABLE = C(86, 90, 96), CONC = C(168, 166, 160);
    const LED = C(255, 246, 222), HW = 2.5, TH = 0.32;
    const solid = [0, 1, 0, 0];
    // mostovka: horní plocha s plynulou niveletou, bílé čelo, podhled
    for (let s = 0; s < L - 0.01; s += 1.25) {
      const s1 = Math.min(L, s + 1.25), z0 = zd(s), z1 = zd(s1);
      pushQuad(X, f(s, -HW, z0), f(s1, -HW, z1), f(s1, HW, z1), f(s, HW, z0), DECK, [0, 1, 1, 0]);
      pushQuad(X, f(s, -HW, z0 - TH), f(s1, -HW, z1 - TH), f(s1, -HW, z1), f(s, -HW, z0), EDGE, solid);
      pushQuad(X, f(s1, HW, z1 - TH), f(s, HW, z0 - TH), f(s, HW, z0), f(s1, HW, z1), EDGE, solid);
      pushQuad(X, f(s1, -HW + 0.4, z1 - TH - 0.05), f(s, -HW + 0.4, z0 - TH - 0.05), f(s, HW - 0.4, z0 - TH - 0.05), f(s1, HW - 0.4, z1 - TH - 0.05), EDGE.map((q) => q * 0.8), solid);
    }
    // žebra po 2,5 m: pod mostovkou prohnutý oblouk k lanu, nad ní sloupek zábradlí prohnutý ven; madlo s LED
    const rib = (s, pts) => {                                               // lomená čára v řezu (t, z) z malých kvádrů
      for (let k = 0; k < pts.length - 1; k++) {
        const [ta, za] = pts[k], [tb, zb] = pts[k + 1], n = Math.max(1, Math.ceil(Math.abs(zb - za) / 0.16));
        for (let i = 0; i < n; i++) {
          const u0 = i / n, u1 = (i + 1) / n, tm = ta + (tb - ta) * (u0 + u1) / 2;
          pushBox(X, f, s - 0.17, s + 0.17, tm - 0.11, tm + 0.11, Math.min(za + (zb - za) * u0, za + (zb - za) * u1), Math.max(za + (zb - za) * u0, za + (zb - za) * u1) + 0.02, WHITE, solid);
        }
      }
    };
    for (let s = 1.25; s < L - 0.5; s += 2.5) {
      const z = zd(s), d = dep(s), tc = 1.15 + 0.35 * d / 2.2;
      for (const sd of [-1, 1]) {
        rib(s, [[sd * HW, z - TH], [sd * (HW + 0.45), z - TH - 0.3 * d], [sd * (HW + 0.25), z - TH - 0.7 * d], [sd * tc, z - TH - d]]);
        rib(s, [[sd * (HW - 0.05), z], [sd * (HW + 0.05), z + 0.45], [sd * (HW + 0.22), z + 0.9], [sd * (HW + 0.35), z + 1.3]]);
      }
    }
    for (let s = 0; s < L - 0.01; s += 1.25) {
      const s1 = Math.min(L, s + 1.25), za = zd(s), zb = zd(s1), da = dep(s), db = dep(s1);
      for (const sd of [-1, 1]) {
        const ta = sd * (1.15 + 0.35 * da / 2.2), tb = sd * (1.15 + 0.35 * db / 2.2);
        // spodní pás: dvě lana
        pushQuad(X, f(s, ta - 0.07, za - TH - da), f(s1, tb - 0.07, zb - TH - db), f(s1, tb + 0.07, zb - TH - db + 0.12), f(s, ta + 0.07, za - TH - da + 0.12), CABLE, solid);
        // madlo (svítí v noci) a mezilehlé madlo
        const th = sd * (HW + 0.35);
        pushBox(X, f, s, s1 + 0.02, th - 0.07, th + 0.07, (za + zb) / 2 + 1.25, (za + zb) / 2 + 1.37, WHITE, [0.75, 1, 0, 0], LED);
        pushBox(X, f, s, s1 + 0.02, sd * (HW + 0.18) - 0.03, sd * (HW + 0.18) + 0.03, (za + zb) / 2 + 0.62, (za + zb) / 2 + 0.68, C(200, 202, 204), solid);
      }
    }
    // opěra na západním břehu a pilíř do V u východní stezky
    pushBox(X, f, 1.5, 5.0, -1.6, 1.6, (pr.zapad ?? g + 3.4) - 2.5, zd(1.5) - TH - 0.3, CONC, solid);
    const gp = pr.pilir ?? g + 1.7, zp = zd(SP) - TH;
    for (let k = 0; k < 14; k++) {                                          // dvě ramena V podél osy, dole spojená
      const u0 = k / 14, u1 = (k + 1) / 14, h0 = gp + (zp - gp) * u0, h1 = gp + (zp - gp) * u1;
      const sp0 = 0.6 + 2.6 * Math.pow(u0, 1.4), sp1 = 0.6 + 2.6 * Math.pow(u1, 1.4), sm = (sp0 + sp1) / 2;
      if (k < 3) pushBox(X, f, SP - sm - 0.45, SP + sm + 0.45, -0.75, 0.75, h0, h1 + 0.02, CONC, solid);
      else for (const sd of [-1, 1]) pushBox(X, f, SP + sd * sm - 0.45, SP + sd * sm + 0.45, -0.75, 0.75, h0, h1 + 0.02, CONC, solid);
    }
    pushBox(X, f, SP - 3.6, SP + 3.6, -1.0, 1.0, zp - 0.25, zp, CONC, solid);                   // úložný práh
    // západní konec: plošina a schodiště do předpolí ve tvaru vějíře (7 stupňů)
    const fz = frameAt(cx + A0[0], cy + A0[1], 0, ang), Rs = 2.6, NS = 7, rise = (Zw - (pr.zapad ?? Zw - 1.05)) / NS;
    pushBox(X, fz, -1.0, 0.6, -HW, HW, Zw - 1.4, Zw, DECK, [0, 1, 1, 0]);
    for (let k = 0; k < NS; k++) {
      const r0 = Rs + k * 0.42, r1 = r0 + 0.42, zt = Zw - (k + 1) * rise;
      for (let a = 0; a < 18; a++) {
        const a0 = Math.PI / 2 + Math.PI * a / 18, a1 = Math.PI / 2 + Math.PI * (a + 1) / 18, am = (a0 + a1) / 2;
        const ff = frameAt(cx + A0[0] + Math.cos(ang + am) * (r0 + r1) / 2 - Math.cos(ang) * 1.0, cy + A0[1] + Math.sin(ang + am) * (r0 + r1) / 2 - Math.sin(ang) * 1.0, 0, ang + am);
        const hw = Math.tan((a1 - a0) / 2) * r1 + 0.03;
        pushBox(X, ff, -0.21, 0.21, -hw, hw, zt - 1.2, zt, k % 2 ? C(190, 188, 182) : C(200, 198, 192), [0, 1, 1, 0]);
      }
    }
    // náplavka na východním břehu: dřevěné sedací schody podél stezky k hladině, betonové čelní zídky
    const WOOD = C(204, 168, 112), WOOD_D = C(150, 118, 76);
    const B0 = [23.3, 6.0], B1 = [20.2, 40.0], bl = Math.hypot(B1[0] - B0[0], B1[1] - B0[1]), ba = Math.atan2(B1[1] - B0[1], B1[0] - B0[0]);
    const fb = frameAt(cx + B0[0], cy + B0[1], 0, ba);                       // s podél břehu k severu, t > 0 = k řece (na západ)
    const zt0 = (pr.naplavka ?? g + 1.7) - 0.05, zw = (pr.voda ?? g) + 0.15, NB = 9, run = 0.78, rb = (zt0 - zw) / NB;
    for (let k = 0; k < NB; k++) {
      const t0 = 1.6 + k * run, z = zt0 - (k + 1) * rb;
      pushBox(X, fb, 0, bl, t0, t0 + run, zw - 1.0, z, WOOD_D, [0, 1, 0, 0], WOOD);
    }
    for (const s of [-0.5, bl]) pushBox(X, fb, s, s + 0.5, 1.4, 1.6 + NB * run, zw - 1.0, zt0 + 0.1, C(186, 184, 178), solid);
    // molo: dřevěný plovoucí pontón u severního konce schodů se zábradlím k řece
    const fm = frameAt(cx + 11.8, cy + 47.9, 0, ba), zm = Math.max(zw + 0.45, (pr.molo ?? zw) + 0.4);
    pushBox(X, fm, -3.6, 3.6, -1.7, 1.7, zm - 0.3, zm, WOOD_D, [0, 1, 0, 0], WOOD);
    pushBox(X, fm, -3.4, 3.4, -1.5, 1.5, zm - 0.75, zm - 0.3, C(60, 62, 66), solid);                   // plováky
    for (let s = -3.4; s <= 3.41; s += 1.7) pushBox(X, fm, s - 0.05, s + 0.05, 1.56, 1.66, zm, zm + 1.0, C(70, 74, 80), solid);
    pushBox(X, fm, -3.45, 3.45, 1.54, 1.68, zm + 0.93, zm + 1.02, C(70, 74, 80), solid);
    pushBox(X, fm, -3.6, -2.4, -1.7 - 2.2, -1.7, zm - 0.05, zm + 0.02, WOOD, [0, 1, 0, 0]);              // lávka na břeh
    return true;
  },

  // Estakáda I/31 (Okružní) se skleněným protihlukovým tunelem (ŘSD 2008, arch. Patrik Kotas): 180 m dlouhý tunel nad oběma
  // jízdními pásy mezi křižovatkou s Pilnáčkovou a nadjezdem nad Pospíšilovou. Skleněné stěny se obloukem zakřivují do střechy,
  // žebra po ~2,9 m, hlavní příčná táhla po 23 m: venku bílé šikmé stožáry, ze kterých vedou táhla k podélnému nosníku
  // ve střeše. Osa a výška mostovky: b.os = [[dx, dy, výška nad b.g]] z prep.py (mostovka z dat). Sklo je kresleno proužkově,
  // aby byla vidět vozovka uvnitř (dlaždice nemají průhlednost). Předlohy: landmarks_ref/estakada_i31.
  estakada_i31(b, { X, pushQuad, tv }) {
    const os = b.os; if (!os || os.length < 2) return true;
    let cx = 0, cy = 0; for (const [x, y] of b.p) { cx += x / b.p.length; cy += y / b.p.length; }
    const g = b.g, solid = [0, 1, 0, 0], lit = [0.85, 1, 0, 0];
    const WHITE = C(244, 245, 246), CONC = C(176, 174, 168), GL = C(176, 212, 222), GL2 = C(150, 190, 206), GLR = C(204, 228, 236), LED = C(255, 244, 214), CABLE = C(110, 114, 120);
    const n = os.length, P = os.map(([dx, dy, dz]) => [cx + dx, cy + dy, g + dz]);
    const tan = P.map((p, i) => { const a = P[Math.max(0, i - 1)], c = P[Math.min(n - 1, i + 1)], l = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1; return [(c[0] - a[0]) / l, (c[1] - a[1]) / l]; });
    const xyz = (i, t, h) => [P[i][0] - tan[i][1] * t, P[i][1] + tan[i][0] * t, P[i][2] + h];     // t > 0 = vlevo po směru osy
    const at = (i, t, h) => tv(...xyz(i, t, h));
    const lerp3 = (a, b2, u) => [a[0] + (b2[0] - a[0]) * u, a[1] + (b2[1] - a[1]) * u, a[2] + (b2[2] - a[2]) * u];
    const bar = (A, B, r, col, aw = solid) => {                              // čtyřboký hranol mezi body (x, y, z)
      const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], l = Math.hypot(...d) || 1, u = d.map((v) => v / l);
      let p1 = [-u[1], u[0], 0]; const m = Math.hypot(p1[0], p1[1]); p1 = m < 0.2 ? [1, 0, 0] : [p1[0] / m, p1[1] / m, 0];
      const p2 = [u[1] * p1[2] - u[2] * p1[1], u[2] * p1[0] - u[0] * p1[2], u[0] * p1[1] - u[1] * p1[0]];
      const q = (p, s1, s2) => tv(p[0] + (p1[0] * s1 + p2[0] * s2) * r, p[1] + (p1[1] * s1 + p2[1] * s2) * r, p[2] + (p1[2] * s1 + p2[2] * s2) * r);
      const c = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
      for (let k = 0; k < 4; k++) { const [a1, a2] = c[k], [b1, b2] = c[(k + 1) % 4]; pushQuad(X, q(A, a1, a2), q(A, b1, b2), q(B, b1, b2), q(B, a1, a2), col, aw); }
    };
    // půlprofil (t, výška nad mostovkou) od paty stěny ke hřebeni; stěna mírně ven, pak oblouk do střechy
    const HP = [[9.7, 0.0], [9.9, 2.5], [10.0, 4.6], [9.2, 6.0], [7.4, 7.3], [4.8, 8.2], [2.2, 8.7], [0.0, 8.85]];
    const pt = (i, sd, k) => xyz(i, sd * HP[k][0], HP[k][1]);
    // pata: betonová římsa dolů k mostovce a deska mezi jízdním pásem a stěnou
    for (let i = 0; i < n - 1; i++) {
      for (const sd of [-1, 1]) {
        pushQuad(X, at(i, sd * 7.4, 0.02), at(i + 1, sd * 7.4, 0.02), at(i + 1, sd * 10.3, 0.02), at(i, sd * 10.3, 0.02), CONC, [0, 1, 1, 0]);
        pushQuad(X, at(i, sd * 10.3, -0.7), at(i + 1, sd * 10.3, -0.7), at(i + 1, sd * 10.3, 0.02), at(i, sd * 10.3, 0.02), CONC, solid);
        pushQuad(X, at(i, sd * 9.6, 0.02), at(i + 1, sd * 9.6, 0.02), at(i + 1, sd * 9.6, 0.8), at(i, sd * 9.6, 0.8), CONC, solid);
        // sklo: stěny světle modré, střecha světlejší (odraz oblohy); každá čtvrtá tabule je o odstín tmavší
        for (let k = 0; k < HP.length - 1; k++) {
          const col = k >= 3 ? (i % 4 === 0 ? GL : GLR) : (i % 4 === 0 ? GL2 : GL);
          pushQuad(X, at(...[i, sd * HP[k][0], HP[k][1]]), at(i + 1, sd * HP[k][0], HP[k][1]), at(i + 1, sd * HP[k + 1][0], HP[k + 1][1]), at(i, sd * HP[k + 1][0], HP[k + 1][1]), col, solid);
        }
      }
      bar(xyz(i, 0, 9.3), xyz(i + 1, 0, 9.3), 0.32, WHITE);                  // podélný nosník ve střeše
      for (const sd of [-1, 1]) bar(xyz(i, sd * 7.1, 7.1), xyz(i + 1, sd * 7.1, 7.1), 0.07, LED, lit);   // osvětlení pod střechou
    }
    // žebra po ~2,9 m (hlavní příčná táhla po 8. stanici = ~23 m) a venkovní stožáry
    for (let i = 0; i < n; i++) {
      const main = i % 8 === 0;
      for (const sd of [-1, 1]) for (let k = 0; k < HP.length - 1; k++) bar(pt(i, sd, k), pt(i, sd, k + 1), main ? 0.2 : 0.1, WHITE);
      if (!main) continue;
      for (const sd of [-1, 1]) {
        const base = xyz(i, sd * 11.0, -0.3), top = xyz(i, sd * 12.8, 13.6);
        bar(base, top, 0.24, WHITE);
        bar(xyz(i, sd * 10.0, 4.6), xyz(i, sd * 11.9, 8.0), 0.11, WHITE);       // vzpěra stožáru ke stěně
        for (const j of [i - 3, i, i + 3]) if (j >= 0 && j < n) bar(top, xyz(j, 0, 9.3), 0.045, CABLE);    // táhla k nosníku ve střeše
        for (const j of [i - 3, i + 3]) if (j >= 0 && j < n) bar(top, xyz(j, sd * 9.2, 6.0), 0.045, CABLE);
      }
    }
    return true;
  },

  // Nový most plk. Šrámka ve Svinarech přes Orlici (otevřen 2019, ocelový obloukový silniční most): dva modré oblouky po stranách
  // vozovky (mírně nakloněné dovnitř), z nich svislá závěsná lana k mostovce. Mostovku, vozovku a zábradlí kreslí data; model
  // přidává jen oblouky a závěsy. Osa a výška mostovky: b.os z prep.py. Rozpětí oblouku ~62 m, vzepětí ~10 m (odhad z fotek).
  // Předlohy: landmarks_ref/sramek_most.
  most_sramek(b, { X, pushQuad, tv }) {
    const os = b.os; if (!os || os.length < 2) return true;
    let cx = 0, cy = 0; for (const [x, y] of b.p) { cx += x / b.p.length; cy += y / b.p.length; }
    const g = b.g, solid = [0, 1, 0, 0];
    const BLUE = C(28, 112, 196), BLUE2 = C(18, 84, 160), CABLE = C(214, 218, 222);
    const n = os.length, P = os.map(([dx, dy, dz]) => [cx + dx, cy + dy, g + dz]);
    const tan = P.map((p, i) => { const a = P[Math.max(0, i - 1)], c = P[Math.min(n - 1, i + 1)], l = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1; return [(c[0] - a[0]) / l, (c[1] - a[1]) / l]; });
    const xyz = (i, t, h) => [P[i][0] - tan[i][1] * t, P[i][1] + tan[i][0] * t, P[i][2] + h];     // t > 0 = vlevo po směru osy
    const bar = (A, B, r, col, aw = solid) => {
      const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], l = Math.hypot(...d) || 1, u = d.map((v) => v / l);
      let p1 = [-u[1], u[0], 0]; const m = Math.hypot(p1[0], p1[1]); p1 = m < 0.2 ? [1, 0, 0] : [p1[0] / m, p1[1] / m, 0];
      const p2 = [u[1] * p1[2] - u[2] * p1[1], u[2] * p1[0] - u[0] * p1[2], u[0] * p1[1] - u[1] * p1[0]];
      const q = (p, s1, s2) => tv(p[0] + (p1[0] * s1 + p2[0] * s2) * r, p[1] + (p1[1] * s1 + p2[1] * s2) * r, p[2] + (p1[2] * s1 + p2[2] * s2) * r);
      const c = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
      for (let k = 0; k < 4; k++) { const [a1, a2] = c[k], [b1, b2] = c[(k + 1) % 4]; pushQuad(X, q(A, a1, a2), q(A, b1, b2), q(B, b1, b2), q(B, a1, a2), col, aw); }
    };
    const s = [0]; for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const Ltot = s[n - 1], SP = Math.min(62, Ltot * 0.7), s0 = (Ltot - SP) / 2, RISE = 10.0, T0 = 4.35, LEAN = 0.18;
    const u = (i) => (s[i] - s0) / SP;                          // 0..1 po délce oblouku
    const arch = (i) => { const w = 4 * u(i) * (1 - u(i)); return [w * RISE, T0 - LEAN * w * RISE]; };   // [výška, odstup od osy]
    for (let i = 0; i < n - 1; i++) {
      if (u(i) < -1e-6 || u(i + 1) > 1 + 1e-6) continue;
      const a = arch(i), c = arch(i + 1);
      for (const sd of [-1, 1]) bar(xyz(i, sd * a[1], a[0] + 0.3), xyz(i + 1, sd * c[1], c[0] + 0.3), 0.55, i % 2 ? BLUE : BLUE2);
    }
    for (let i = 0; i < n; i++) {                               // závěsná lana po ~5,8 m
      if (u(i) <= 0.03 || u(i) >= 0.97 || i % 2) continue;
      const a = arch(i);
      for (const sd of [-1, 1]) bar(xyz(i, sd * a[1], a[0] + 0.3), xyz(i, sd * T0, 0.9), 0.035, CABLE);
    }
    return true;
  },
  // ---- Hlavní nádraží (funkcionalismus): hala, hodinová věž, severní křídlo kolem dvora, jižní blok s pavilonem a sochou ----
  // Rámec z dominanty.json ("osa" -> b.osa v assets/custom_prep.py): s podél budovy k severu, t napříč k průčelí (východ, Riegrovo
  // náměstí), z nad terénem. Půdorys, výšky a tvary střech z ortofota a laseru ČÚZK (DMP 1G), členění fasád a barvy z fotek
  // (landmarks_ref/hlavni_nadrazi). Kamera (od jihozápadu) vidí hlavně fasádu k nástupištím (západ) a jižní čelo.
  hlavni_nadrazi(b, { X, R, pushBox, pushQuad, pushTri, tv, ring }) {
    let x0, y0, ang;
    if (b.osa) [x0, y0, ang] = b.osa;
    else {                                                                 // záloha bez osy: opsaný obdélník půdorysu
      const F2 = frame2(b.p), fl = F2.u[1] < 0 ? -1 : 1;
      ang = Math.atan2(F2.u[1] * fl, F2.u[0] * fl);
      x0 = F2.cx + F2.u[0] * (F2.s0 + F2.s1) / 2 + F2.v[0] * (F2.t0 + F2.t1) / 2; y0 = F2.cy + F2.u[1] * (F2.s0 + F2.s1) / 2 + F2.v[1] * (F2.t0 + F2.t1) / 2;
    }
    const g = b.g, Z0 = b.b - g, ca = Math.cos(ang), sa = Math.sin(ang);
    const F = (s, t, h) => tv(x0 + ca * s + sa * t, y0 + sa * s - ca * t, h);    // h absolutně (pushBox, ring)
    const P = (s, t, z) => F(s, t, g + z);
    const FIX = [0, 1, 0, 0], SNOW = [0, 1, 1, 0];
    const WALL = C(226, 216, 190), WALL_N = C(222, 212, 186), CORN = C(238, 232, 214), PLINTH = C(140, 136, 128), LIGHTER = C(232, 223, 198);
    const GL = C(77, 97, 128), GLR = C(150, 166, 168), BAR = C(70, 78, 84), TILE = C(170, 84, 58), FLAT = C(104, 107, 110);
    const GLASS = C(158, 182, 178), RIB = C(104, 126, 122), GUT = C(104, 140, 124), COPPER = C(74, 120, 102), COPPER_D = C(36, 62, 57);
    const DIAL = C(112, 60, 46), WHITE = C(244, 242, 234), BLUE = C(34, 58, 128), EMB = C(46, 84, 168), SILVER = C(214, 218, 220);
    const BRONZE = C(76, 120, 98), BRONZE_D = C(48, 62, 56), CANOPY = C(76, 80, 86), BRICK = C(150, 82, 62);
    const hh = (a, c, d) => Math.abs(Math.sin(a * 12.9898 + c * 78.233 + d * 37.719) * 43758.5453) % 1;
    const box = (s0, s1, t0, t1, z0, z1, col, aw = FIX, top) => pushBox(X, F, s0, s1, t0, t1, g + z0, g + z1, col, aw, top);
    const quad = (B, a, c, d, e, col, aw = FIX) => pushQuad(B, P(...a), P(...c), P(...d), P(...e), col, aw);
    const tri = (B, a, c, d, col, aw = FIX) => pushTri(B, P(...a), P(...c), P(...d), col, aw);

    // zdi hranolu: západní (t = tW) do zW, východní do zE, čela do nižší z obou
    const wblock = (s0, s1, tW, tE, zW, zE = zW, col = WALL) => {
      const zm = Math.min(zW, zE);
      quad(X, [s0, tW, Z0], [s1, tW, Z0], [s1, tW, zW], [s0, tW, zW], col);
      quad(X, [s1, tE, Z0], [s0, tE, Z0], [s0, tE, zE], [s1, tE, zE], col);
      quad(X, [s0, tE, Z0], [s0, tW, Z0], [s0, tW, zm], [s0, tE, zm], col);
      quad(X, [s1, tW, Z0], [s1, tE, Z0], [s1, tE, zm], [s1, tW, zm], col);
    };
    // plochá střecha (R) s atikou a římsou na vybraných stranách ('wesn' = západ, východ, jih, sever)
    const flat = (s0, s1, t0, t1, z, sides = 'wesn', par = 0.45, corn = true) => {
      quad(R, [s0, t0, z], [s1, t0, z], [s1, t1, z], [s0, t1, z], FLAT, [0, 0, 0, 0]);
      const k = 0.28;
      if (sides.includes('w')) { box(s0, s1, t0, t0 + k, z, z + par, CORN, SNOW); if (corn) box(s0, s1, t0 - 0.22, t0, z - 0.75, z - 0.35, CORN, SNOW); }
      if (sides.includes('e')) { box(s0, s1, t1 - k, t1, z, z + par, CORN, SNOW); if (corn) box(s0, s1, t1, t1 + 0.22, z - 0.75, z - 0.35, CORN, SNOW); }
      if (sides.includes('s')) { box(s0, s0 + k, t0, t1, z, z + par, CORN, SNOW); if (corn) box(s0 - 0.22, s0, t0, t1, z - 0.75, z - 0.35, CORN, SNOW); }
      if (sides.includes('n')) { box(s1 - k, s1, t0, t1, z, z + par, CORN, SNOW); if (corn) box(s1, s1 + 0.22, t0, t1, z - 0.75, z - 0.35, CORN, SNOW); }
    };
    // okno na fasádě: osa 't' = stěna v t = c (podél s), osa 's' = stěna v s = c (podél t); sd = strana ven; lit = podíl rozsvícených v noci
    const win = (ax, c, sd, a0, a1, z0, z1, lit = 0.5, col) => {
      const h = hh(a0 * 1.3 + c, z0, a1 + sd), cl = col || (h > 0.86 ? GLR : GL), on = hh(a1, c * 0.7, z1 * 1.7) < lit ? 0.55 + 0.4 * hh(z0, a0, c) : 0;
      const o = c + sd * 0.05, aw = [on, 1, 0, 0];
      if (ax === 't') quad(X, [a0, o, z0], [a1, o, z0], [a1, o, z1], [a0, o, z1], cl, aw);
      else quad(X, [o, a0, z0], [o, a1, z0], [o, a1, z1], [o, a0, z1], cl, aw);
    };
    const row = (ax, c, sd, from, to, pitch, w, z0, z1, lit) => {
      const n = Math.max(1, Math.floor((to - from) / pitch + 1e-6)), st = from + ((to - from) - n * pitch) / 2;
      for (let k = 0; k < n; k++) { const m = st + pitch * (k + 0.5); win(ax, c, sd, m - w / 2, m + w / 2, z0, z1, lit); }
    };
    // velké prosklené okno s mříží příček (rám tmavý, tabule v noci svítí)
    const bigWin = (ax, c, sd, a0, a1, z0, z1, nv, nh, lit = 0.85) => {
      const q = (d, a, z) => (ax === 't' ? [a, c + sd * d, z] : [c + sd * d, a, z]);
      quad(X, q(0.04, a0, z0), q(0.04, a1, z0), q(0.04, a1, z1), q(0.04, a0, z1), BAR);
      const bw = 0.13, da = (a1 - a0) / nv, dz = (z1 - z0) / nh;
      for (let i = 0; i < nv; i++) for (let j = 0; j < nh; j++) {
        const pa = a0 + da * i + bw, pb = a0 + da * (i + 1) - bw, za = z0 + dz * j + bw, zb = z0 + dz * (j + 1) - bw;
        quad(X, q(0.07, pa, za), q(0.07, pb, za), q(0.07, pb, zb), q(0.07, pa, zb), hh(i, j, c) > 0.8 ? GLR : GL, [lit, 1, 0, 0]);
      }
    };
    // okřídlené kolo (znak drah) v rovině stěny: střed a, z, poloměr r
    const emblem = (ax, c, sd, a, z, r, col, d = 0.1) => {
      const q = (u, w) => (ax === 't' ? P(a + u, c + sd * d, z + w) : P(c + sd * d, a + u, z + w));
      for (let k = 0; k < 8; k++) {
        const a0 = k / 8 * Math.PI * 2, a1 = (k + 1) / 8 * Math.PI * 2;
        pushTri(X, q(0, 0), q(Math.cos(a0) * r, Math.sin(a0) * r), q(Math.cos(a1) * r, Math.sin(a1) * r), col, FIX);
      }
      for (const sg of [-1, 1]) {
        pushQuad(X, q(sg * r * 0.7, r * 0.15), q(sg * r * 3.0, r * 0.75), q(sg * r * 3.1, r * 0.35), q(sg * r * 0.8, -r * 0.25), col, FIX);
        pushQuad(X, q(sg * r * 0.8, -r * 0.25), q(sg * r * 2.6, r * 0.2), q(sg * r * 2.6, -r * 0.15), q(sg * r * 0.8, -r * 0.55), col, FIX);
      }
    };
    // sedlová / valbová střecha: okapy podél osy a0..a1, napříč wW..wE ve výškách zW, zE, hřeben w = wR ve výšce zR,
    // valby hs / hn (vodorovná délka, 0 = štít); osa 's' = hřeben podél s, 't' = podél t (a = t, w = s)
    const roof = ({ ax = 's', a0, a1, wW, wE, zW, zE = zW, wR, zR, hs = 0, hn = 0, col = TILE, ov = 0.45, wc = WALL }) => {
      const M = (a, w, z) => (ax === 's' ? [a, w, z] : [w, a, z]);
      const kW = (zR - zW) / (wR - wW), kE = (zR - zE) / (wE - wR), zw = zW - ov * kW, ze = zE - ov * kE;
      const b0 = a0 - (hs ? ov : 0), b1 = a1 + (hn ? ov : 0);
      const w0 = M(b0, wW - ov, zw), w1 = M(b1, wW - ov, zw), e0 = M(b0, wE + ov, ze), e1 = M(b1, wE + ov, ze);
      const r0 = M(a0 + hs, wR, zR), r1 = M(a1 - hn, wR, zR), aw = [1, g + zR, g + Math.min(zw, ze), 0];
      quad(R, w0, w1, r1, r0, col, aw); quad(R, e1, e0, r0, r1, col, aw);
      const zm = Math.min(zW, zE), hi = zW > zE ? M(0, wW, zW) : M(0, wE, zE);
      for (const [a, hip, ee, ww, rr] of [[a0, hs, e0, w0, r0], [a1, hn, e1, w1, r1]]) {
        if (hip) tri(R, ee, ww, rr, col, aw);
        else {
          tri(X, M(a, wW, zm), M(a, wE, zm), M(a, wE, zE), wc); tri(X, M(a, wW, zm), M(a, wE, zE), M(a, wR, zR), wc); tri(X, M(a, wW, zm), M(a, wR, zR), M(a, wW, zW), wc);
        }
        if (hip && Math.abs(zW - zE) > 0.05) { const h_ = [...hi]; h_[ax === 's' ? 0 : 1] = a; tri(X, M(a, wW, zm), M(a, wE, zm), h_, wc); }
      }
      // okapní žlaby (měděné, zelenavé)
      const gut = (w, z, sg) => { const [p, q] = ax === 's' ? [[b0, b1], [Math.min(w, w + sg * 0.2), Math.max(w, w + sg * 0.2)]] : [[Math.min(w, w + sg * 0.2), Math.max(w, w + sg * 0.2)], [b0, b1]]; box(p[0], p[1], q[0], q[1], z - 0.22, z, GUT, SNOW); };
      gut(wW - ov, zw, -1); gut(wE + ov, ze, 1);
    };
    // prosklená střecha haly: okapy s0..s1 / tW..tE ve výšce z0, hřeben tR ve výšce zR, jižní valba hs (sever = štít);
    // tabule mezi příčkami po 1,3 m a třech podélných pásech, v noci prosvítá světlo haly
    const glassRoof = (s0, s1, tW, tE, z0, tR, zR, hs, glow = 0.52) => {
      const awG = [glow, 1, 1, 0], awR = [0, 1, 1, 0], up = 0.035;
      const slope = (tE_, sg) => {                                        // sg -1 = západní, +1 = východní
        const pt = (s, f, d = 0) => [s, tE_ + (tR - tE_) * f, z0 + (zR - z0) * f + d];
        const smin = (f) => s0 + hs * f;
        quad(X, pt(s0, 0), pt(s1, 0), pt(s1, 1), pt(smin(1), 1), RIB, awR);
        const NB = 3;
        for (let j = 0; j < NB; j++) {
          const fa = j / NB + 0.03, fb = (j + 1) / NB - 0.03;
          for (let s = s0; s < s1 - 0.2; s += 1.3) {
            const sb = Math.min(s + 1.3, s1) - 0.09, la = Math.max(s + 0.09, smin(fa) + 0.12), lb = Math.max(s + 0.09, smin(fb) + 0.12);
            if (lb >= sb) continue;
            const c = hh(s, j, sg) > 0.85 ? GLASS.map((q) => q * 1.08) : GLASS;
            quad(X, pt(la, fa, up), pt(sb, fa, up), pt(sb, fb, up), pt(lb, fb, up), c, awG);
          }
        }
      };
      slope(tW, -1); slope(tE, 1);
      if (hs) {                                                            // jižní valba: vodorovné pásy, svislé příčky
        const pt = (f, t, d = 0) => [s0 + hs * f, t, z0 + (zR - z0) * f + d];
        tri(X, pt(0, tE), pt(0, tW), pt(1, tR), RIB, awR);
        const NB = 3;
        for (let j = 0; j < NB; j++) {
          const fa = j / NB + 0.03, fb = (j + 1) / NB - 0.03;
          const la = tW + (tR - tW) * fa, ra = tE - (tE - tR) * fa, lb = tW + (tR - tW) * fb, rb = tE - (tE - tR) * fb;
          for (let t = tW; t < tE - 0.2; t += 1.3) {
            const ta = t + 0.09, tb = t + 1.3 - 0.09;
            const A0 = Math.max(ta, la), A1 = Math.min(tb, ra), B0 = Math.max(ta, lb), B1 = Math.min(tb, rb);
            if (A1 - A0 < 0.1 || B1 - B0 < 0.05) continue;
            quad(X, pt(fa, A0, up), pt(fa, A1, up), pt(fb, B1, up), pt(fb, B0, up), GLASS, awG);
          }
        }
        box(s0 - 0.3, s0, tW, tE, z0 - 0.3, z0, GUT, SNOW);
      } else tri(X, [s0, tW, z0], [s0, tE, z0], [s0, tR, zR], WALL);
      tri(X, [s1, tE, z0], [s1, tW, z0], [s1, tR, zR], WALL);
      box(s0 + hs, s1, tR - 0.18, tR + 0.18, zR - 0.1, zR + 0.12, GUT, SNOW);            // hřebenáč
      box(s0, s1, tW - 0.3, tW, z0 - 0.3, z0, GUT, SNOW); box(s0, s1, tE, tE + 0.3, z0 - 0.3, z0, GUT, SNOW);   // okapy
    };

    // ===== jižní blok (12,6 m) a nárožní pavilon (17,4 m) se sochou =====
    wblock(-76, -66, -19.2, 12.15, 12.2);
    flat(-76, -66, -19.2, 12.15, 12.2, 'wsn');
    box(-76.06, -66, -19.26, 12.21, Z0, 0.55, PLINTH, FIX);
    row('s', -76, -1, -19.2, 12.15, 3.13, 1.5, 0.9, 3.4, 0.6);          // jižní čelo: přízemí a dvě patra
    row('s', -76, -1, -19.2, 12.15, 3.13, 1.5, 4.9, 7.1, 0.45);
    row('s', -76, -1, -19.2, 12.15, 3.13, 1.5, 8.3, 10.5, 0.45);
    for (const [z0, z1] of [[4.9, 7.1], [8.3, 10.5]]) row('t', -19.2, -1, -76, -66, 3.3, 1.5, z0, z1, 0.45);   // k nástupištím
    for (const [z0, z1] of [[0.9, 3.4], [4.9, 7.1], [8.3, 10.5]]) row('t', 12.15, 1, -76, -68.2, 3.6, 1.5, z0, z1, 0.45);
    wblock(-68.2, -62.3, 5.5, 13.5, 17.0);
    flat(-68.2, -62.3, 5.5, 13.5, 17.0);
    for (const [z0, z1] of [[0.9, 3.6], [4.6, 6.8], [8.0, 10.2], [11.4, 13.6], [14.6, 16.1]]) win('t', 13.5, 1, -66.0, -64.5, z0, z1, 0.4);
    win('s', -68.2, -1, 8.8, 10.2, 13.6, 15.8, 0.4);
    {                                                                      // socha na pavilonu: okřídlená postava na měděném podstavci
      const sc = -65.25, tc = 9.5, f = (a, d, h) => F(sc + a, tc + d, h), z = g + 17.0;
      pushBox(X, f, -1.4, 1.4, -1.4, 1.4, z, z + 0.5, CORN, SNOW);
      ring(X, f, 1.25, 1.15, z + 0.5, z + 1.3, 8, BRONZE, SNOW, Math.PI / 8);
      ring(X, f, 1.15, 0.55, z + 1.3, z + 1.9, 8, BRONZE, SNOW, Math.PI / 8);
      pushBox(X, f, -0.3, 0.3, -0.25, 0.25, z + 1.9, z + 3.5, BRONZE_D, FIX);
      pushBox(X, f, -0.18, 0.18, -0.16, 0.16, z + 3.5, z + 3.9, BRONZE_D, FIX);
      for (const sg of [-1, 1]) {                                          // křídla rozepjatá podél průčelí
        pushQuad(X, f(sg * 0.25, 0, z + 3.3), f(sg * 1.9, -0.1, z + 4.5), f(sg * 2.2, -0.1, z + 3.9), f(sg * 0.3, 0, z + 2.6), BRONZE_D, FIX);
        pushQuad(X, f(sg * 0.3, 0.02, z + 2.6), f(sg * 2.2, -0.08, z + 3.9), f(sg * 1.8, -0.08, z + 3.2), f(sg * 0.3, 0.02, z + 2.2), BRONZE, FIX);
      }
    }

    // ===== odbavovací hala =====
    // střední loď pod prosklenou střechou (okap 15,3 m, hřeben 19,7 m), sever končí štítem u křídla
    wblock(-67, -2.5, -10, 5.5, 15.3);
    glassRoof(-67, -2.5, -10, 5.5, 15.3, -2.25, 19.7, 6.6);
    // západní trakt k nástupištím: výšky z laseru (14,4 / 12,6 / 14,4 m)
    const WS = [[-66, -48, 14.4], [-48, -22, 12.6], [-22, -7.5, 14.4]];
    for (const [s0, s1, z] of WS) { wblock(s0, s1, -19.2, -10, z); flat(s0, s1, -19.2, -10, z, 'w'); }
    box(-66, -7.5, -19.26, -19.2, Z0, 0.55, PLINTH);
    row('t', -10, -1, -48, -22, 2.9, 1.3, 13.4, 14.6, 0.5);               // okénka v nadsvětlí nad nižší částí
    // fasáda k nástupištím (t = -19,2): přízemí pod přístřeškem, dvě patra oken, dvě velká okna s okřídleným kolem
    row('t', -19.2, -1, -66, -7.5, 2.9, 1.7, 0.5, 3.8, 0.75);
    for (const [z0, z1] of [[6.4, 9.0], [10.2, 12.6]]) { row('t', -19.2, -1, -66, -48, 2.9, 1.5, z0, z1, 0.55); row('t', -19.2, -1, -22, -14.2, 2.75, 1.5, z0, z1, 0.55); }
    for (const [z0, z1] of [[6.2, 8.4], [9.4, 11.4]]) { row('t', -19.2, -1, -48, -44.5, 2.9, 1.4, z0, z1, 0.55); row('t', -19.2, -1, -33.5, -22, 2.85, 1.5, z0, z1, 0.55); }
    bigWin('t', -19.2, -1, -44.3, -33.7, 4.6, 11.4, 8, 5);
    bigWin('t', -19.2, -1, -14.0, -8.3, 4.6, 12.6, 4, 6);
    emblem('t', -19.2, -1, -39.0, 8.4, 0.75, EMB, 0.12); emblem('t', -19.2, -1, -11.15, 9.0, 0.6, EMB, 0.12);
    for (const [s0, s1] of [[-44.6, -44.3], [-33.7, -33.4], [-14.3, -14.0], [-8.3, -8.0]]) box(s0, s1, -19.45, -19.2, 4.3, s0 > -15 ? 12.9 : 11.7, LIGHTER);
    // východní trakt a průčelí k náměstí (t = 15,6): 16 pilastrů, okna, markýza, velké okno u věže, nápis na střeše
    wblock(-62.3, -6.98, 5.5, 15.6, 14.4);
    flat(-62.3, -6.98, 5.5, 15.6, 14.4, 'e', 0.5, false);
    box(-62.3, -6.98, 15.6, 15.85, 12.85, 13.15, CORN, SNOW);
    const B0 = -62.3, BW = (-20.5 - B0) / 15;
    for (let k = 0; k <= 15; k++) box(B0 + k * BW - (k ? 0.45 : 0), B0 + k * BW + (k < 15 ? 0.45 : 0), 15.6, 16.0, 4.75, 12.85, LIGHTER);
    for (let k = 0; k < 15; k++) {
      const a = B0 + k * BW + 0.6, c = B0 + (k + 1) * BW - 0.6;
      if (k < 5) win('t', 15.6, 1, a, c, 5.6, 12.4, 0.8);
      else { win('t', 15.6, 1, a, c, 6.0, 8.8, 0.6); win('t', 15.6, 1, a, c, 10.0, 12.4, 0.6); }
      win('t', 15.6, 1, a - 0.1, c + 0.1, 0.4, 3.9, 0.85);
    }
    bigWin('t', 15.6, 1, -20.0, -7.9, 4.9, 12.9, 9, 6);
    box(-20.6, -20.0, 15.6, 16.4, 4.75, 13.5, LIGHTER); box(-7.9, -7.3, 15.6, 16.4, 4.75, 13.5, LIGHTER); box(-20.6, -7.3, 15.6, 16.4, 12.9, 13.5, LIGHTER, SNOW);
    win('t', 15.6, 1, -19.6, -8.3, 0.3, 4.0, 0.9);
    box(-62.3, -7.0, 15.6, 20.9, 4.35, 4.75, CANOPY, SNOW, C(196, 196, 192));         // markýza
    {                                                                      // nápis HRADEC KRÁLOVÉ HL.N. (písmo 3 × 5, výška ~0,85 m)
      const txt = 'HRADEC KRÁLOVÉ HL.N.', cell = 0.168, zb = g + 15.0, tt = 15.15;
      let s = -50.3;
      const ff = (a, d, h) => F(a, tt + d, h);
      pushBox(X, ff, s - 0.3, -37.7, -0.04, 0.04, zb - 0.6, zb - 0.5, SILVER, FIX);
      for (const ch of txt) {
        const base = { 'Á': 'A', 'É': 'E' }[ch] || ch, gl = ch === '.' ? [0, 0, 0, 0, 4] : (ZN_FONT[base] || ZN_FONT[' ']);
        for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (gl[r] & (4 >> c))
          pushBox(X, ff, s + c * cell, s + (c + 1) * cell, -0.06, 0.06, zb + (4 - r) * cell, zb + (5 - r) * cell, BLUE, FIX);
        if (base !== ch) pushBox(X, ff, s + 2 * cell, s + 3 * cell, -0.06, 0.06, zb + 5.3 * cell, zb + 6.3 * cell, BLUE, FIX);
        if (ch !== ' ' && ch !== '.') pushBox(X, ff, s + cell, s + 2 * cell, -0.03, 0.03, zb - 0.5, zb, SILVER, FIX);
        s += ch === '.' ? 2 * cell : 4 * cell;
      }
      for (const se of [-53.2, -34.8]) {                                   // okřídlená kola na stožárcích po stranách nápisu
        box(se - 0.05, se + 0.05, tt - 0.05, tt + 0.05, 14.4, 16.1, SILVER);
        emblem('t', tt, 1, se, 16.55, 0.42, SILVER, 0.02);
      }
    }
    // blok mezi halou a věží (19,2 m)
    wblock(-9.0, -1.6, 3.5, 11.64, 19.2);
    flat(-9.0, -1.6, 3.5, 11.64, 19.2, 'wesn', 0.4);
    for (const t of [5.6, 7.6, 9.6]) win('s', -9.0, -1, t - 0.6, t + 0.6, 15.6, 17.8, 0.5);

    // ===== hodinová věž: dřík 5,45 × 8,4 m do 38,8 m, lucerna z měděných žeber do 46,9 m =====
    {
      const S0 = -6.98, S1 = -1.53, T0 = 11.64, T1 = 20.03, H = 38.8, sc = (S0 + S1) / 2, tc = (T0 + T1) / 2;
      wblock(S0, S1, T0, T1, H, H, C(224, 216, 194));
      box(S0 - 0.06, S1 + 0.06, T0 - 0.06, T1 + 0.06, Z0, 0.6, PLINTH);
      box(S0 - 0.16, S1 + 0.16, T0 - 0.16, T1 + 0.16, H - 0.45, H, CORN, SNOW);
      // líce věže: a = vodorovně (vpravo pro pozorovatele), d = ven, z
      const faces = [
        [(a, d) => [sc + a, T1 + d], S1 - S0], [(a, d) => [sc - a, T0 - d], S1 - S0],     // východ (průčelí), západ
        [(a, d) => [S0 - d, tc + a], T1 - T0], [(a, d) => [S1 + d, tc - a], T1 - T0],     // jih, sever
      ];
      const TIME = [10, 8];
      for (const [m] of faces) {
        const Ff = (a, d, z) => P(...m(a, d), z), Fb = (a, d, h) => F(...m(a, d), h);
        const zc = 34.25, R_ = 1.55;
        pushBox(X, Fb, -R_, R_, 0, 0.14, g + zc - R_, g + zc + R_, DIAL, FIX);            // čtvercový ciferník
        pushBox(X, Fb, -R_ - 0.12, R_ + 0.12, 0, 0.1, g + zc - R_ - 0.12, g + zc + R_ + 0.12, C(80, 66, 56), FIX);
        const LW = [0.75, 1, 0, 0];
        for (let k = 0; k < 12; k++) {                                     // hodinové značky
          const a = k / 12 * Math.PI * 2, r0 = k % 3 ? 1.12 : 0.95, r1 = 1.38, w = k % 3 ? 0.07 : 0.1, ca_ = Math.sin(a), cz = Math.cos(a);
          pushQuad(X, Ff(ca_ * r0 - cz * w, 0.17, zc + cz * r0 + ca_ * w), Ff(ca_ * r1 - cz * w, 0.17, zc + cz * r1 + ca_ * w), Ff(ca_ * r1 + cz * w, 0.17, zc + cz * r1 - ca_ * w), Ff(ca_ * r0 + cz * w, 0.17, zc + cz * r0 - ca_ * w), WHITE, LW);
        }
        const hand = (a, L, w) => { const sx = Math.sin(a), cz = Math.cos(a); pushQuad(X, Ff(-sx * 0.2 - cz * w, 0.2, zc - cz * 0.2 + sx * w), Ff(sx * L - cz * w, 0.2, zc + cz * L + sx * w), Ff(sx * L + cz * w, 0.2, zc + cz * L - sx * w), Ff(-sx * 0.2 + cz * w, 0.2, zc - cz * 0.2 - sx * w), WHITE, LW); };
        hand((TIME[0] + TIME[1] / 60) / 12 * Math.PI * 2, 0.82, 0.1); hand(TIME[1] / 60 * Math.PI * 2, 1.25, 0.07);
        for (const sg of [-1, 1]) {                                         // lampy na výložnících v rozích nahoře
          const a = sg * (Math.abs(m(1, 0)[0] - m(0, 0)[0]) > 0.5 ? (S1 - S0) : (T1 - T0)) / 2;
          pushBox(X, Fb, a - 0.08, a + 0.08, 0, 0.7, g + H - 1.3, g + H - 1.2, C(60, 62, 66), FIX);
          pushBox(X, Fb, a - 0.14, a + 0.14, 0.55, 0.85, g + H - 1.55, g + H - 1.2, C(250, 236, 200), [1, 1, 0, 0]);
        }
      }
      // svislý pás oken pod hodinami v průčelí, dveře do věže
      for (let z = 4.2; z < 31.0; z += 2.6) win('t', T1, 1, sc - 0.42, sc + 0.42, z, z + 1.7, 0.35);
      win('t', T1, 1, sc - 0.9, sc + 0.9, 0.2, 3.0, 0.9, C(70, 58, 50));
      // lucerna: tmavé jádro, měděná žebra, odstupňované zakončení, anténa
      const L0 = -5.6, L1 = -2.9, M0 = 13.2, M1 = 18.5, LH = 45.5;
      box(L0 - 0.25, L1 + 0.25, M0 - 0.25, M1 + 0.25, H, H + 0.45, COPPER, SNOW);
      box(L0, L1, M0, M1, H + 0.45, LH, COPPER_D);
      for (const [a0, a1, b0, b1] of [[L0 - 0.3, L0 + 0.15, M0 - 0.3, M0 + 0.15], [L1 - 0.15, L1 + 0.3, M0 - 0.3, M0 + 0.15], [L0 - 0.3, L0 + 0.15, M1 - 0.15, M1 + 0.3], [L1 - 0.15, L1 + 0.3, M1 - 0.15, M1 + 0.3]])
        box(a0, a1, b0, b1, H + 0.45, LH + 0.2, COPPER);                   // nárožní pilíře
      for (let k = 1; k < 6; k++) { const t = M0 + (M1 - M0) * k / 6; box(L0 - 0.25, L0, t - 0.16, t + 0.16, H + 0.45, LH - 0.2, COPPER); box(L1, L1 + 0.25, t - 0.16, t + 0.16, H + 0.45, LH - 0.2, COPPER); }
      for (let k = 1; k < 3; k++) { const s = L0 + (L1 - L0) * k / 3; box(s - 0.16, s + 0.16, M0 - 0.25, M0, H + 0.45, LH - 0.2, COPPER); box(s - 0.16, s + 0.16, M1, M1 + 0.25, H + 0.45, LH - 0.2, COPPER); }
      box(L0 - 0.1, L1 + 0.1, M0 - 0.1, M1 + 0.1, LH - 0.2, LH + 0.5, COPPER, SNOW);
      box(L0 + 0.35, L1 - 0.35, M0 + 0.5, M1 - 0.5, LH + 0.5, LH + 1.0, COPPER, SNOW);
      box(L0 + 0.75, L1 - 0.75, M0 + 1.1, M1 - 1.1, LH + 1.0, LH + 1.4, COPPER, SNOW);
      box(sc - 0.05, sc + 0.05, tc - 0.05, tc + 0.05, LH + 1.4, LH + 5.2, C(70, 72, 76));   // anténa
      box(sc - 0.05, sc + 0.05, tc - 0.6, tc + 0.6, LH + 3.6, LH + 3.7, C(70, 72, 76));
    }

    // ===== severní křídlo: dva trakty kolem dvora, příčný trakt na severu, sedlové taškové střechy (hřebeny 19,5 m) =====
    wblock(-7.5, 30, -19.2, -5.5, 13.5, 13.5, WALL_N);
    roof({ a0: -7.5, a1: 30, wW: -19.2, wE: -5.5, zW: 13.5, wR: -12.4, zR: 19.5, hs: 6.85, wc: WALL_N });
    wblock(30, 75.7, -19.2, -6.0, 16.0, 15.3, WALL_N);
    roof({ a0: 30, a1: 75.7, wW: -19.2, wE: -6.0, zW: 16.0, zE: 15.3, wR: -15.0, zR: 19.5, hn: 6.0, wc: WALL_N });
    box(-7.5, 75.7, -19.26, -19.2, Z0, 0.55, PLINTH);
    // fasáda k nástupištím: přízemí (pod přístřeškem) a patra po 2,75 m
    row('t', -19.2, -1, -6.5, 30, 2.75, 1.6, 0.5, 3.8, 0.7);
    for (const [z0, z1] of [[5.3, 7.3], [8.3, 10.3], [11.2, 12.8]]) row('t', -19.2, -1, -6.5, 30, 2.75, 1.35, z0, z1, 0.45);
    row('t', -19.2, -1, 30, 75.7, 2.75, 1.6, 0.5, 3.8, 0.6);
    for (const [z0, z1] of [[5.3, 7.3], [8.5, 10.5], [11.7, 13.7]]) row('t', -19.2, -1, 30, 75.7, 2.75, 1.35, z0, z1, 0.45);
    row('t', -19.2, -1, 30, 75.7, 2.75, 1.0, 14.5, 15.4, 0.3);
    for (const [z0, z1] of [[0.6, 3.6], [5.0, 7.0], [8.4, 10.4], [11.8, 13.8]]) row('s', 75.7, 1, -19.2, 15.6, 2.9, 1.4, z0, z1, 0.4);
    // východní trakt k náměstí, hřeben mimo střed (laser)
    wblock(-1.5, 75.7, 1.0, 15.6, 15.4, 15.4, WALL_N);
    roof({ a0: -1.5, a1: 75.7, wW: 1.0, wE: 15.6, zW: 15.4, wR: 10.0, zR: 19.5, hs: 5.6, hn: 5.6, wc: WALL_N });
    for (const [z0, z1] of [[1.0, 3.6], [5.0, 7.2], [8.4, 10.6], [12.2, 14.2]]) row('t', 15.6, 1, 32.3, 75.7, 2.9, 1.5, z0, z1, 0.45);
    for (const [z0, z1] of [[9.8, 11.2], [12.4, 14.2]]) row('t', 15.6, 1, -1.5, 32.3, 3.76, 1.6, z0, z1, 0.45);
    for (const [z0, z1] of [[1.0, 3.4], [5.0, 7.0], [8.4, 10.4]]) row('t', 1.0, -1, 40, 61, 2.9, 1.4, z0, z1, 0.4);
    row('t', 1.0, -1, -1.5, 75.7, 2.9, 1.4, 12.2, 14.0, 0.4);
    // přízemní hala před východním traktem (9,2 m): vysoká okna mezi pilíři
    wblock(-1.5, 32.3, 15.6, 19.3, 8.8);
    flat(-1.5, 32.3, 15.6, 19.3, 8.8, 'esn', 0.45);
    {
      const n = 9, d = (32.3 + 1.5) / n;
      for (let k = 0; k < n; k++) { const a = -1.5 + d * k + 0.5, c = -1.5 + d * (k + 1) - 0.5; win('t', 19.3, 1, a, c, 0.5, 7.6, 0.85); }
      for (let k = 0; k <= n; k++) box(-1.5 + d * k - 0.45, -1.5 + d * k + 0.45, 19.3, 19.5, Z0, 8.0, LIGHTER);
      box(-1.5, 32.3, 19.3, 19.55, 7.9, 8.4, CORN, SNOW);
    }
    // příčný trakt na severu (hřeben podél t), štíty schované pod střechami traktů
    roof({ ax: 't', a0: -15.0, a1: 10.0, wW: 61.0, wE: 75.7, zW: 16.0, wR: 68.35, zR: 19.5, wc: WALL_N });
    quad(X, [61, 1.0, Z0], [61, -6.0, Z0], [61, -6.0, 16.0], [61, 1.0, 16.0], WALL_N);
    for (const [z0, z1] of [[1.0, 3.4], [5.0, 7.0], [8.4, 10.4], [11.8, 13.8]]) row('s', 61, -1, -6.0, 1.0, 2.6, 1.3, z0, z1, 0.4);
    // dvůr: nízká prosklená střecha nad jižní částí, nízké přístavky, otevřená část s - 40..61
    wblock(-1.5, 33, -5.5, 1.0, 10.0);
    glassRoof(-1.5, 33, -5.5, 1.0, 10.0, -2.25, 11.4, 0, 0.51);
    wblock(33, 40, -6.0, 1.0, 12.2); flat(33, 40, -6.0, 1.0, 12.2, 'sn', 0.3, false);
    wblock(46, 60, -6.0, -3.5, 8.4); flat(46, 60, -6.0, -3.5, 8.4, 'e', 0.3, false);
    wblock(40, 44, -6.0, 1.0, 3.9); flat(40, 44, -6.0, 1.0, 3.9, 'e', 0.3, false);
    // komíny a vikýře
    for (const [s, t, z] of [[22, 10.0, 19.2], [58, 10.0, 19.2], [12, -12.4, 19.2], [50, -15.0, 19.2]]) box(s - 0.45, s + 0.45, t - 0.35, t + 0.35, z - 1.5, z + 1.3, BRICK, SNOW, C(70, 60, 56));
    for (const s of [46, 52, 58, 64]) {                                   // vikýře na západní straně východního traktu (ke dvoru)
      const zb = 15.4 + (4.0 - 1.0) * (4.1 / 9.0);
      box(s - 0.8, s + 0.8, 4.0, 6.6, zb - 0.3, zb + 1.6, WALL_N);
      box(s - 1.0, s + 1.0, 3.8, 6.6, zb + 1.6, zb + 1.85, TILE, SNOW);
      win('t', 4.0, -1, s - 0.45, s + 0.45, zb + 0.3, zb + 1.3, 0.4);
    }
    return true;
  },
};

// ---------- velikonoční vajíčko: zaparkovaná auta (props.egg = [x, y, z, úhel, typ]; + je přední část vozu) ----------
// zjednodušené karoserie: dolní kastle, nižší kapota, kabina jako komolý jehlan (čelní sklo, střecha, zadní okno), kola, světla
const EGG_CARS = [
  // název, barva, L, W, pás, střecha, kapota, [xf0, xf1, xr1, xr0] kabiny
  ['rx8',    [0.72, 0.10, 0.10], 4.43, 1.77, 0.95, 1.35, 0.84, [0.60, -0.15, -1.15, -1.55]],
  ['rx7',    [0.93, 0.93, 0.91], 4.29, 1.76, 0.86, 1.23, 0.70, [0.35, -0.40, -1.05, -1.55]],
  ['p106',   [0.40, 0.17, 0.55], 3.68, 1.59, 0.95, 1.38, 0.86, [0.45, -0.05, -1.35, -1.52]],
  ['p106gt', [0.76, 0.10, 0.10], 3.68, 1.59, 0.95, 1.38, 0.86, [0.45, -0.05, -1.35, -1.52]],
  ['x1',     [0.20, 0.22, 0.25], 4.45, 1.82, 1.05, 1.60, 0.95, [0.70, 0.10, -1.70, -1.95]],
  ['m140',   [0.16, 0.30, 0.62], 4.32, 1.77, 0.95, 1.41, 0.86, [0.55, -0.05, -1.20, -1.55]],
  ['gt86',   [0.78, 0.10, 0.10], 4.24, 1.78, 0.88, 1.29, 0.76, [0.45, -0.25, -1.15, -1.55]],
];
export const EGG_TYPES = EGG_CARS.map((c) => c[0]);
export function buildProps(P, { make, inst, F, pushBox, pushQuad, pushTri }) {
  const items = P.egg || [];
  if (!items.length) return;
  const GLASS = [0.16, 0.20, 0.26], DARK = [0.10, 0.10, 0.11], FIX = [0, 1, 0, 0], FIXS = [0, 1, 1, 0];
  EGG_CARS.forEach(([, col, L, W, belt, roof, hood, [xf0, xf1, xr1, xr0]], ti) => {
    const mine = items.filter((it) => it[4] === ti);
    if (!mine.length) return;
    const g = make((B) => {
      const z0 = 0.28, hl = L / 2, hw = W / 2;
      pushBox(B, F, -hl, 0.45 * hl, -hw, hw, z0, belt, col, FIX);                       // trup
      pushBox(B, F, 0.45 * hl, hl, -hw + 0.04, hw - 0.04, z0, hood, col, FIX);            // kapota
      const wb = hw - 0.12, wr = wb - 0.16;
      pushQuad(B, F(xr1, -wr, roof), F(xf1, -wr, roof), F(xf1, wr, roof), F(xr1, wr, roof), col, FIXS);          // střecha
      pushQuad(B, F(xf0, wb, belt), F(xr0, wb, belt), F(xr1, wr, roof), F(xf1, wr, roof), GLASS, FIX);             // bok vlevo
      pushQuad(B, F(xr0, -wb, belt), F(xf0, -wb, belt), F(xf1, -wr, roof), F(xr1, -wr, roof), GLASS, FIX);         // bok vpravo
      pushQuad(B, F(xf0, -wb, belt), F(xf0, wb, belt), F(xf1, wr, roof), F(xf1, -wr, roof), GLASS, FIX);           // čelní sklo
      pushQuad(B, F(xr0, wb, belt), F(xr0, -wb, belt), F(xr1, -wr, roof), F(xr1, wr, roof), GLASS, FIX);           // zadní okno
      for (const s of [-0.31 * L, 0.31 * L]) for (const t of [-hw + 0.02, hw - 0.02]) pushBox(B, F, s - 0.32, s + 0.32, t - 0.1, t + 0.1, 0, 0.62, DARK, FIX);   // kola
      for (const t of [-hw + 0.1, hw - 0.5]) pushBox(B, F, -hl - 0.02, -hl + 0.06, t, t + 0.4, belt - 0.22, belt - 0.1, [0.9, 0.12, 0.10], [0.8, 1, 0, 0]);    // zadní světla
      for (const t of [-hw + 0.1, hw - 0.5]) pushBox(B, F, hl - 0.06, hl + 0.02, t, t + 0.4, hood - 0.2, hood - 0.08, [0.95, 0.92, 0.75], [0.3, 1, 0, 0]);    // přední světla
    });
    inst(g, mine, (it) => [it[0], it[1], it[2], it[3]], null);
  });
}

// ---- Vizuální identita řetězců (assets/znacky.json, přiřazení v assets/custom_prep.py -> b.zn) ----
// b.zn.m: 'cela' = celá budova v barvách značky (pás pod střechou po obvodu, nápis / cedule a vstup na průčelí f = [stěna, poloha]),
//         'cast' = jednotky v budově s víc nájemci (seg: pás a nápis jen na úseku stěny, z = výška parteru u vysokých domů),
//         'stris' = stříška čerpací stanice (barevné čelo, ostrůvky se stojany).
// b.zn.pl = [x, y, z, úhel silnice, výška] pylon u vjezdu. Barvy 0–255. Zdi a střechu kreslí běžný kód (b.wc, b.rc).
const ZN_GLASS = [0.26, 0.38, 0.48], ZN_GREY = [0.40, 0.42, 0.45], ZN_WHITE = [0.95, 0.95, 0.93], ZN_ASPH = [0.30, 0.30, 0.32];
const ZN_FIX = [0, 1, 0, 0], ZN_GLOW = [0.75, 1, 0, 1], ZN_GL = [0.55, 1, 0, 0];   // ZN_GLOW: v noci svítí vlastní barvou (render.html, aw.w)
const zc = (a) => (a ? [a[0] / 255, a[1] / 255, a[2] / 255] : null);
const zdark = (c, k = 0.82) => c.map((q) => q * k);
const tvZ = (x, y, z) => [x, z, -y];

// písmo 3 × 5 bodů (řádky shora, bity zleva) pro nápisy na fasádách a cedulích
const ZN_FONT = {
  A: [2, 5, 7, 5, 5], B: [6, 5, 6, 5, 6], C: [3, 4, 4, 4, 3], D: [6, 5, 5, 5, 6], E: [7, 4, 6, 4, 7], F: [7, 4, 6, 4, 4], G: [3, 4, 5, 5, 3],
  H: [5, 5, 7, 5, 5], I: [7, 2, 2, 2, 7], J: [1, 1, 1, 5, 2], K: [5, 5, 6, 5, 5], L: [4, 4, 4, 4, 7], M: [5, 7, 7, 5, 5], N: [6, 5, 5, 5, 5],
  O: [2, 5, 5, 5, 2], P: [6, 5, 6, 4, 4], Q: [2, 5, 5, 6, 3], R: [6, 5, 6, 5, 5], S: [3, 4, 2, 1, 6], T: [7, 2, 2, 2, 2], U: [5, 5, 5, 5, 7],
  V: [5, 5, 5, 5, 2], W: [5, 5, 7, 7, 5], X: [5, 5, 2, 5, 5], Y: [5, 5, 2, 2, 2], Z: [7, 1, 2, 4, 7], 2: [6, 1, 2, 4, 7], 4: [5, 5, 7, 1, 1], ' ': [0, 0, 0, 0, 0],
};
// nápis: střed sc podél s, čelo t (záporné = před stěnou), spodní hrana z0, výška písmen h (zmenší se na šířku maxW); vrací šířku
function znText(X, pushBox, f, sc, t, z0, h, maxW, text, col, aw = ZN_GLOW) {
  const n = text.length, cells = n * 4 - 1;
  const cell = Math.min(h / 5, maxW / cells), w = cell * cells, s0 = sc - w / 2;
  for (let k = 0; k < n; k++) {
    const g = ZN_FONT[text[k]] || ZN_FONT[' '];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
      if (!(g[r] & (4 >> c))) continue;
      const s = s0 + (k * 4 + c) * cell, z = z0 + (4 - r) * cell;
      pushBox(X, f, s, s + cell * 1.02, t - 0.06, t + 0.02, z, z + cell * 1.02, col, aw);
    }
  }
  return w;
}

// stěna i obrysu: rámec s počátkem v prvním bodě (s podél stěny, t > 0 dovnitř budovy – obrys je proti směru hodin)
function znEdge(ring, i, frameAt) {
  const [x0, y0] = ring[i], [x1, y1] = ring[(i + 1) % ring.length];
  return { f: frameAt(x0, y0, 0, Math.atan2(y1 - y0, x1 - x0)), L: Math.hypot(x1 - x0, y1 - y0), ang: Math.atan2(y1 - y0, x1 - x0), x0, y0 };
}

// cedule s logem: rámeček, podklad, znak (čtverec uprostřed), na čele t0 (záporné = před stěnou), svítí v noci
function znSign(X, pushBox, f, s, t0, z0, z1, w, lg, both = false) {
  const bg = zc(lg[0]), fg = zc(lg[1]), rm = zc(lg[2]), h = z1 - z0, zm = (z0 + z1) / 2;
  const tt = both ? [-t0, t0] : [t0 - 0.05, t0 + 0.3];
  if (rm) pushBox(X, f, s - w / 2 - 0.22, s + w / 2 + 0.22, tt[0] + 0.06, tt[1] - 0.06, z0 - 0.22, z1 + 0.22, rm, ZN_GLOW);
  pushBox(X, f, s - w / 2, s + w / 2, tt[0], tt[1], z0, z1, bg, ZN_GLOW, zdark(bg, 0.9));
  const fw = Math.min(w * 0.6, h * 0.62) / 2, fh = Math.min(h * 0.3, w * 0.3);
  pushBox(X, f, s - fw, s + fw, tt[0] - 0.06, both ? tt[1] + 0.06 : tt[0] + 0.02, zm - fh, zm + fh, fg, ZN_GLOW);
}

// žluté oblouky „M“ (s podél, výška z0..z1, tloušťka t0..t1)
function znArches(X, pushBox, f, s0, w, z0, z1, t0, t1, col) {
  const r = w / 4, zc_ = z1 - r, th = Math.max(0.14, w * 0.08);
  for (const sx of [s0 - r, s0 + r]) {
    for (let k = 0; k < 7; k++) {
      const a = Math.PI * k / 6, ss = sx - Math.cos(a) * r, zz = zc_ + Math.sin(a) * r;
      pushBox(X, f, ss - th, ss + th, t0, t1, zz - th, zz + th, col, ZN_GLOW);
    }
  }
  for (const [ss, top] of [[s0 - 2 * r, zc_], [s0, zc_ - 0.15 * r], [s0 + 2 * r, zc_]]) pushBox(X, f, ss - th, ss + th, t0, t1, z0, top, col, ZN_GLOW);
}

function znPylon(X, pushBox, pl, zn) {
  const [x, y, g, a, H] = pl, f = (s, t, h) => tvZ(x + Math.cos(a) * s - Math.sin(a) * t, y + Math.sin(a) * s + Math.cos(a) * t, h);
  const pas = zc(zn.pas);
  if (zn.k === 'mcdonalds') {                                   // vysoký sloup se žlutým M na červeném panelu
    pushBox(X, f, -0.3, 0.3, -0.3, 0.3, g - 0.3, g + H - 3.0, ZN_GREY, ZN_FIX);
    pushBox(X, f, -1.8, 1.8, -0.25, 0.25, g + H - 3.5, g + H, zc([200, 20, 24]), ZN_GLOW);
    znArches(X, pushBox, f, 0, 3.0, g + H - 3.2, g + H - 0.3, -0.32, 0.32, zc([255, 199, 44]));
    return;
  }
  if (zn.m === 'stris' || zn.pumpa) {                           // pylon s cenami: logo nahoře, pod ním tabule s cenami
    pushBox(X, f, -1.1, 1.1, -0.3, 0.3, g - 0.3, g + H, [0.16, 0.18, 0.22], ZN_FIX, pas);
    znSign(X, pushBox, f, 0, 0.36, g + H - 2.0, g + H - 0.1, 2.2, zn.lg, true);
    for (let r = 0; r < 3; r++) {
      const z = g + H - 2.6 - r * 0.85;
      pushBox(X, f, -0.85, 0.85, -0.36, 0.36, z - 0.32, z + 0.12, [0.96, 0.92, 0.70], [0.9, 1, 0, 0]);
    }
    pushBox(X, f, -1.12, 1.12, -0.34, 0.34, g + 0.6, g + 1.0, pas, ZN_FIX);
    return;
  }
  // obchod: dva sloupky a velký panel s logem (podklad, rámeček, znak) na obou stranách
  const pw = Math.max(2.6, H * 0.34), ph = Math.min(H * 0.42, 3.8);
  for (const s of [-pw * 0.32, pw * 0.32]) pushBox(X, f, s - 0.18, s + 0.18, -0.18, 0.18, g - 0.3, g + H - ph, ZN_GREY, ZN_FIX);
  znSign(X, pushBox, f, 0, 0.4, g + H - ph, g + H, pw, zn.lg, true);
  if (zn.k === 'kfc') for (let k = 0; k < 6; k++) pushBox(X, f, -pw / 2 + k * pw / 6, -pw / 2 + (k + 0.5) * pw / 6, -0.42, 0.42, g + H - ph - 0.6, g + H - ph, k % 2 ? ZN_WHITE : zc([200, 16, 46]), ZN_FIX);
}

// pás pod střechou na úseku stěny s0..s1 (z0..z1), volitelně tenký proužek p2 pod ním; KFC = svislé červenobílé pruhy
function znBand(X, pushBox, E, s0, s1, z0, z1, pas, p2, kfc) {
  if (s1 - s0 < 0.3) return;
  if (kfc) {
    const n = Math.max(1, Math.round((s1 - s0) / 1.3));
    for (let k = 0; k < n; k++) pushBox(X, E.f, s0 + (s1 - s0) * k / n, s0 + (s1 - s0) * (k + 1) / n, -0.24, 0.1, z0, z1, k % 2 ? ZN_WHITE : pas, ZN_FIX);
  } else pushBox(X, E.f, s0, s1, -0.24, 0.1, z0, z1, pas, [0.2, 1, 0, 0], zdark(pas, 0.9));
  if (p2) pushBox(X, E.f, s0, s1, -0.2, 0.05, z0 - 0.45, z0 - 0.08, p2, [0.2, 1, 0, 0]);
}

landmarks.znacka = function (b, { X, R, frameAt, pushBox, pushQuad }) {
  const zn = b.zn; if (!zn) return false;
  const ring = b.p, g = b.g, e = b.e;
  if (zn.seg) {                                                  // jednotky s vlastním pásem (i nájemci v parteru hypermarketu)
    for (const sg of zn.seg) {
      const [i, s0, s1] = sg.e, E = znEdge(ring, i, frameAt), pas = zc(sg.pas), p2 = zc(sg.p2), sm = (s0 + s1) / 2, w = s1 - s0;
      const za = sg.z ? g + sg.z : e - sg.ph, zb = sg.z ? g + sg.z + Math.min(sg.ph, 1.2) : e + 0.45;
      znBand(X, pushBox, E, s0, s1, za, zb, pas, p2, sg.k === 'kfc');
      if (sg.txt) znText(X, pushBox, E.f, sm, -0.3, za + (zb - za) * 0.16, (zb - za) * 0.68, w * 0.9, sg.txt, zc(sg.tc));
      else znSign(X, pushBox, E.f, sm, -0.55, za - 0.15, zb + (sg.z ? 0.2 : 1.0), Math.min(sg.z ? 2.6 : 5.0, Math.max(2.4, w * 0.3)), sg.lg);
    }
    if (zn.m === 'cast') return true;
  }
  const pas = zc(zn.pas), p2 = zc(zn.p2), ph = zn.ph;
  if (zn.m === 'stris') {                                        // stříška čerpací stanice
    for (let i = 0; i < ring.length; i++) {
      const E = znEdge(ring, i, frameAt); if (E.L < 0.3) continue;
      pushBox(X, E.f, -0.05, E.L + 0.05, -0.28, 0.05, e - ph, e + 0.18, pas, [0.7, 1, 0, 1], zdark(pas, 0.9));
      if (p2) pushBox(X, E.f, -0.05, E.L + 0.05, -0.32, -0.26, e - ph, e - ph + 0.32, p2, [0.7, 1, 0, 1]);
      if (zn.txt && E.L > 8 && Math.sin(E.ang) < 0.5 && -Math.cos(E.ang) < 0.5 && Math.abs(Math.sin(E.ang)) + Math.abs(Math.cos(E.ang)) > 0)
        znText(X, pushBox, E.f, E.L / 2, -0.32, e - ph * 0.85, ph * 0.7, E.L * 0.5, zn.txt, zc(zn.tc));
    }
    const F = frame2(ring), sl = F.s1 - F.s0, tl = F.t1 - F.t0;
    const rows = tl > 13 ? [0.3, 0.7] : [0.5], n = Math.max(1, Math.min(4, Math.round((sl - 2) / 8)));
    for (const rt of rows) for (let k = 0; k < n; k++) {
      const s = F.s0 + sl * (k + 0.5) / n, t = F.t0 + tl * rt;
      const f = frameAt(F.cx + F.u[0] * s + F.v[0] * t, F.cy + F.u[1] * s + F.v[1] * t, 0, F.ang);
      pushBox(X, f, -2.3, 2.3, -0.6, 0.6, g - 0.3, g + 0.22, [0.66, 0.66, 0.64], ZN_FIX);
      for (const ds of [-1.1, 1.1]) {
        pushBox(X, f, ds - 0.45, ds + 0.45, -0.3, 0.3, g + 0.22, g + 1.6, ZN_WHITE, ZN_FIX);
        pushBox(X, f, ds - 0.47, ds + 0.47, -0.32, 0.32, g + 1.6, g + 1.95, pas, [0.7, 1, 0, 1]);
      }
    }
    if (zn.pl) znPylon(X, pushBox, zn.pl, zn);
    return true;
  }
  // celá budova: pás po obvodu
  const kfc = zn.k === 'kfc';
  for (let i = 0; i < ring.length; i++) {
    const E = znEdge(ring, i, frameAt); if (E.L < 0.3) continue;
    znBand(X, pushBox, E, -0.1, E.L + 0.1, e - ph, e + 0.45, pas, p2, kfc);
  }
  const [fi, fs] = zn.f, E = znEdge(ring, fi, frameAt), L = E.L, f = E.f;
  const por = zn.por;
  let lw = Math.min(7, Math.max(2.6, L * 0.2)), lt = -0.55, lz0 = e - ph - 0.2, lz1 = e + 1.6, ls = fs, txtDone = false;
  if (por === 'lidl') {                                          // prosklený vstup s kosou střechou vybíhající nahoru ven
    const W = Math.min(16, Math.max(8, L * 0.35)), D = 3.4, s0 = fs - W / 2, s1 = fs + W / 2;
    pushBox(X, f, s0, s1, -D, 0.05, g - 0.3, e + 0.4, ZN_GLASS, ZN_GL, [0.55, 0.57, 0.6]);
    for (let s = s0; s <= s1 + 0.01; s += W / 6) pushBox(X, f, s - 0.08, s + 0.08, -D - 0.04, -D + 0.04, g, e + 0.4, [0.75, 0.77, 0.8], ZN_FIX);
    const zi = e + 0.4, zo = e + 2.3, DO = D + 1.2;
    pushQuad(R, f(s0 - 0.6, 0.1, zi), f(s1 + 0.6, 0.1, zi), f(s1 + 0.6, -DO, zo), f(s0 - 0.6, -DO, zo), [0.74, 0.76, 0.78], [0, 0, 1, 0]);
    pushQuad(X, f(s0 - 0.6, -DO, zo), f(s1 + 0.6, -DO, zo), f(s1 + 0.6, 0.1, zi), f(s0 - 0.6, 0.1, zi), [0.55, 0.57, 0.60], ZN_FIX);
    pushBox(X, f, s0 - 0.6, s1 + 0.6, -DO - 0.25, -DO + 0.05, zo - 0.7, zo + 0.1, pas, ZN_FIX);
    ls = s1 - 1.9; lw = 3.0; lt = -DO - 0.35; lz0 = zo - 0.3; lz1 = zo + 2.7;
  } else if (por === 'kaufland') {                               // vystupující červený vstupní portál vyšší než hala
    const W = Math.min(16, Math.max(9, L * 0.25)), D = 3.6, s0 = fs - W / 2, s1 = fs + W / 2;
    pushBox(X, f, s0, s1, -D, 0.1, g - 0.3, e + 3.0, pas, ZN_FIX, zdark(pas, 0.9));
    pushBox(X, f, s0 + W * 0.15, s1 - W * 0.15, -D - 0.06, -D + 0.02, g, g + 3.8, ZN_GLASS, ZN_GL);
    if (zn.txt) { znText(X, pushBox, f, fs, -D - 0.08, e - 0.2, 2.2, W * 0.9, zn.txt, zc(zn.tc)); txtDone = true; }
    lw = 0;
  } else if (por === 'sklo' || por === 'mcd' || por === 'kfc') {  // prosklený vstup se stříškou v barvě pásu
    const W = Math.min(14, Math.max(4, L * (por === 'sklo' ? 0.3 : 0.45))), s0 = fs - W / 2, s1 = fs + W / 2;
    pushBox(X, f, s0, s1, -2.2, 0.05, g - 0.3, g + 3.8, ZN_GLASS, ZN_GL, [0.6, 0.6, 0.62]);
    pushBox(X, f, s0 - 0.5, s1 + 0.5, -3.0, 0.05, g + 3.8, g + 4.3, pas, ZN_FIX, zdark(pas, 0.9));
  } else if (por === 'stres') {                                  // stříška nad vstupem na sloupech, prosklený vstup ve zdi
    const W = Math.min(16, Math.max(6, L * 0.3)), s0 = fs - W / 2, s1 = fs + W / 2;
    pushBox(X, f, s0 + 0.8, s1 - 0.8, -0.12, 0.02, g, g + 3.3, ZN_GLASS, ZN_GL);
    pushBox(X, f, s0, s1, -4.5, 0.05, g + 3.6, g + 4.2, pas, ZN_FIX, zdark(pas, 0.92));
    for (const s of [s0 + 0.4, s1 - 0.4]) pushBox(X, f, s - 0.15, s + 0.15, -4.35, -4.05, g - 0.3, g + 3.6, ZN_GREY, ZN_FIX);
  }
  if (zn.k === 'mcdonalds') {                                    // žluté M na průčelí
    znArches(X, pushBox, f, fs, Math.min(4.0, L * 0.25), e - ph - 0.2, e + 1.6, -0.5, -0.3, zc([255, 199, 44]));
  } else if (zn.txt && !txtDone && L > 6) {                      // nápis na pásu průčelí (u Lidlu je navíc cedule nad vstupem)
    const tw = znText(X, pushBox, f, fs, -0.3, e - ph * 0.86, ph * 0.72, L * 0.7, zn.txt, zc(zn.tc));
    if (por === 'lidl' && L > 3) znSign(X, pushBox, f, ls, lt, lz0, lz1, lw, zn.lg);
  } else if (lw > 0) {
    if (lz1 - lz0 > lw * 1.1) lz0 = lz1 - lw * 1.1;
    if (L > 3) znSign(X, pushBox, f, ls, lt, lz0, lz1, lw, zn.lg);
  }
  if (zn.f2) {                                                   // průčelí je na odvrácené straně: nápis i na viditelné stěně
    const E2 = znEdge(ring, zn.f2[0], frameAt), s2 = zn.f2[1];
    if (zn.k === 'mcdonalds') znArches(X, pushBox, E2.f, s2, Math.min(4.0, E2.L * 0.25), e - ph - 0.2, e + 1.6, -0.5, -0.3, zc([255, 199, 44]));
    else if (zn.txt) znText(X, pushBox, E2.f, s2, -0.3, e - ph * 0.86, ph * 0.72, E2.L * 0.7, zn.txt, zc(zn.tc));
    else znSign(X, pushBox, E2.f, s2, -0.55, e - ph - 0.2, e + 1.6, Math.min(7, Math.max(2.6, E2.L * 0.2)), zn.lg);
  }
  if (por === 'mcd') {                                           // drive-in: pruh kolem boční a zadní stěny, výdejní okénko, menu tabule
    for (const k of [1, 2]) {
      const Ei = znEdge(ring, (fi + k) % ring.length, frameAt); if (Ei.L < 2) continue;
      pushQuad(X, Ei.f(-4.5, -0.6, g + 0.08), Ei.f(Ei.L + 4.5, -0.6, g + 0.08), Ei.f(Ei.L + 4.5, -4.4, g + 0.08), Ei.f(-4.5, -4.4, g + 0.08), ZN_ASPH, [0, 1, 0, 0]);
      for (let s = 0; s < Ei.L; s += 3) pushQuad(X, Ei.f(s, -2.45, g + 0.1), Ei.f(s + 1.5, -2.45, g + 0.1), Ei.f(s + 1.5, -2.6, g + 0.1), Ei.f(s, -2.6, g + 0.1), [0.95, 0.80, 0.20], [0, 1, 0, 0]);
      if (k === 1) {
        pushBox(X, Ei.f, Ei.L * 0.5 - 1, Ei.L * 0.5 + 1, -0.25, 0.02, g + 0.9, g + 2.2, ZN_GLASS, ZN_GL);
        pushBox(X, Ei.f, Ei.L * 0.5 - 1.4, Ei.L * 0.5 + 1.4, -1.1, 0.02, g + 2.5, g + 2.8, pas, ZN_FIX);
      } else pushBox(X, Ei.f, Ei.L * 0.5 - 0.9, Ei.L * 0.5 + 0.9, -5.1, -4.8, g - 0.3, g + 2.0, [0.15, 0.15, 0.17], [0.5, 1, 0, 0]);
    }
  }
  if (zn.pl) znPylon(X, pushBox, zn.pl, zn);
  return true;
};

// ---- Nákupní centra podle fotek (dominanty.json "spec": {"lm": "oc", "oc": {...}}, souřadnice převádí custom_prep.py) ----
// casti: hranoly / ovály nad budovou {q | c + r [rx, ry] + a (°), z [od, do] nad terénem, wc, rc, win (styl oken) nebo sklo},
// fasady: obklad úseku stěny {q [[x, y], [x, y]], z, c, c2 (přechod barvy), druh panel | cikcak | okno | sklo | cihla | pruhy},
// plochy: {q, c, z, mriz} plochy na střeše (fotovoltaika),
// cedule: {p, a (° směr nápisu, 0 = na východ), w, z, bg, fg, pruhy, txt, tc, vert (písmena pod sebou), noha}, svetliky: [[x, y, velikost, úhel°]] na střeše.
function ocPoly(o) {
  let pts = o.q;
  if (!pts) {
    const [cx, cy] = o.c, [rx, ry] = o.r, a = (o.a || 0) * Math.PI / 180, n = 24;
    pts = []; for (let k = 0; k < n; k++) { const t = 2 * Math.PI * k / n, x = Math.cos(t) * rx, y = Math.sin(t) * ry; pts.push([cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)]); }
  }
  let A = 0; for (let i = 0; i < pts.length; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length]; A += x0 * y1 - x1 * y0; }
  return A < 0 ? pts.slice().reverse() : pts;
}
landmarks.oc = function (b, { X, W, R, frameAt, pushBox, pushQuad, pushTri, tv }) {
  const o = b.oc; if (!o) return true;
  const g = b.g;
  let cx = 0, cy = 0; for (const [x, y] of b.p) { cx += x / b.p.length; cy += y / b.p.length; }
  for (const c of o.casti || []) {
    const pts = ocPoly(c), z0 = g + c.z[0], z1 = g + c.z[1], wc = zc(c.wc), rc = zc(c.rc || [150, 152, 156]);
    if (c.sklo) {                                                // prosklená část: sklo s příčkami a pásy stropů, v noci svítí
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length], L = Math.hypot(x1 - x0, y1 - y0); if (L < 0.05) continue;
        const f = frameAt(x0, y0, 0, Math.atan2(y1 - y0, x1 - x0));
        pushQuad(X, f(0, 0, z0), f(L, 0, z0), f(L, 0, z1), f(0, 0, z1), wc, [0.45, 1, 0, 0]);
        for (let z = z0 + 3.6; z < z1 - 0.3; z += 3.6) pushBox(X, f, 0, L, -0.1, 0.02, z - 0.14, z + 0.14, zc(c.pas || [176, 180, 186]), ZN_FIX);
      }
      for (let i = 1; i < pts.length - 1; i++) pushTri(R, tv(...pts[0], z1), tv(...pts[i], z1), tv(...pts[i + 1], z1), rc, [0, 0, 0, 0]);
    } else prism(W, R, pushQuad, pushTri, tv, g, pts, z0, z1, wc, c.win ?? 15, rc);
    if (c.atika) for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
      pushQuad(X, tv(x0, y0, z1), tv(x1, y1, z1), tv(x1, y1, z1 + c.atika), tv(x0, y0, z1 + c.atika), zc(c.atika_c || c.wc), ZN_FIX);
    }
  }
  const fas = [];                                                // "obvod": 1 = obklad na všech stěnách půdorysu (delších než 3 m)
  for (const fa of o.fasady || []) {
    if (fa.obvod) { for (let i = 0; i < b.p.length; i++) { const q = [b.p[i], b.p[(i + 1) % b.p.length]]; if (Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]) > 3) fas.push({ ...fa, q }); } }
    else fas.push(fa);
  }
  for (const fa of fas) {
    const [[x0, y0], [x1, y1]] = fa.q, L = Math.hypot(x1 - x0, y1 - y0); if (L < 0.5) continue;
    let a = Math.atan2(y1 - y0, x1 - x0);
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, out = (-Math.sin(a)) * (cx - mx) + Math.cos(a) * (cy - my) > 0 ? -1 : 1;   // t < 0 musí být ven
    const f = out < 0 ? frameAt(x0, y0, 0, a) : frameAt(x1, y1, 0, a + Math.PI), z0 = g + fa.z[0], z1 = g + fa.z[1], c = zc(fa.c), c2 = zc(fa.c2 || fa.c);
    const off = fa.o || 0;
    if (fa.druh === 'cikcak') {                                   // bílé lomené čáry na šedé stěně (Aupark)
      pushBox(X, f, 0, L, -off - 0.12, 0.02, z0, z1, c, ZN_FIX);
      for (const zz of [0.25, 0.7]) {
        const per = 14, amp = (z1 - z0) * 0.22;
        for (let s = 0; s < L - 0.5; s += per / 2) {
          const k = Math.round(s / (per / 2)) % 2, za = z0 + (z1 - z0) * zz + (k ? amp : -amp), zb = z0 + (z1 - z0) * zz + (k ? -amp : amp), se = Math.min(L, s + per / 2), n = 8;
          for (let j = 0; j < n; j++) { const s_ = s + (se - s) * j / n, z_ = za + (zb - za) * j / n; pushBox(X, f, s_, s_ + (se - s) / n + 0.05, -off - 0.18, -off - 0.1, z_ - 0.16, z_ + 0.16, c2, [0.3, 1, 0, 0]); }
        }
      }
    } else if (fa.druh === 'okno') {                             // vystouplý tmavý rám s prosklením (Aupark)
      pushBox(X, f, 0, L, -off - 1.4, 0.02, z0, z1, [0.20, 0.21, 0.23], ZN_FIX);
      pushBox(X, f, 0.6, L - 0.6, -off - 1.46, -off - 1.38, z0 + 0.6, z1 - 0.6, ZN_GLASS, [0.6, 1, 0, 0]);
    } else if (fa.druh === 'sklo') {
      pushBox(X, f, 0, L, -off - 0.12, 0.02, z0, z1, c, [0.45, 1, 0, 0]);
      for (let s = 0; s < L; s += 1.8) pushBox(X, f, s, s + 0.12, -off - 0.18, -off - 0.1, z0, z1, c2, ZN_FIX);
      for (let z = z0 + 3.6; z < z1 - 0.3; z += 3.6) pushBox(X, f, 0, L, -off - 0.18, -off - 0.1, z - 0.15, z + 0.15, c2, ZN_FIX);
    } else if (fa.druh === 'pruhy') {                            // obklad se skupinami svislých světlých pruhů a úzkými okny (Atrium)
      pushBox(X, f, 0, L, -off - 0.12, 0.02, z0, z1, c, ZN_FIX);
      for (let s = 3; s < L - 2; s += 8.5) {
        for (const d of [0, 0.7, 1.4]) pushBox(X, f, s + d, s + d + 0.22, -off - 0.18, -off - 0.1, z0 + 0.8, z1 - 0.3, c2, ZN_FIX);
        pushBox(X, f, s + 4.0, s + 4.6, -off - 0.16, -off - 0.1, z0 + (z1 - z0) * 0.3, z0 + (z1 - z0) * 0.75, [0.16, 0.17, 0.2], [0.5, 1, 0, 0]);
      }
    } else if (fa.druh === 'cihla') {                            // cihlový parter s perforovanými poli (Futurum)
      pushBox(X, f, 0, L, -off - 0.12, 0.02, z0, z1, c, ZN_FIX);
      for (let s = 2; s < L - 6; s += 9) pushBox(X, f, s, s + 6, -off - 0.18, -off - 0.1, z0 + (z1 - z0) * 0.55, z1 - 0.5, c2, ZN_FIX);
    } else {                                                     // panely s přechodem barvy c -> c2
      const n = Math.max(1, Math.round(L / 2.4));
      for (let k = 0; k < n; k++) {
        const t = n > 1 ? k / (n - 1) : 0, col = c.map((q, i) => (q + (c2[i] - q) * t) * (k % 2 ? 0.97 : 1.0));
        pushBox(X, f, L * k / n, L * (k + 1) / n, -off - 0.18, 0.02, z0, z1, col, [0.1, 1, 0, 0]);
      }
    }
  }
  for (const pl of o.plochy || []) {                             // plochy na střeše (fotovoltaika, membrána): konvexní mnohoúhelník
    const pts = ocPoly(pl), z = b.e + (pl.z || 0.1), col = zc(pl.c);
    for (let i = 1; i < pts.length - 1; i++) pushTri(R, tv(...pts[0], z), tv(...pts[i], z), tv(...pts[i + 1], z), col, [0, 0, 0, 0]);
    if (pl.mriz) { const F = frame2(pts); for (let s = F.s0 + 1.6; s < F.s1; s += 1.6) pushBox(X, frameAt(F.cx + F.u[0] * s, F.cy + F.u[1] * s, 0, F.ang), -0.05, 0.05, F.t0 * 0.95, F.t1 * 0.95, z, z + 0.04, zc(pl.mriz), ZN_FIX); }
  }
  for (const s of o.svetliky || []) {
    const [x, y, w, a] = s, f = frameAt(x, y, 0, (a || 0) * Math.PI / 180), z = b.e + 0.08, col = zc(o.svetliky_c || [80, 120, 150]);
    pushQuad(R, f(-w, 0, z), f(0, -w * 0.62, z), f(w, 0, z), f(0, w * 0.62, z), col, [0.2, 0, 0, 0]);
  }
  for (const c of o.cedule || []) {
    const [x, y] = c.p, f = frameAt(x, y, 0, (c.a || 0) * Math.PI / 180), z0 = g + c.z[0], z1 = g + c.z[1], w = c.w;
    if (c.noha) for (const s of [-w * 0.3, w * 0.3]) pushBox(X, f, s - 0.15, s + 0.15, -0.15, 0.15, g - 0.3, z0, ZN_GREY, ZN_FIX);
    if (c.bg) pushBox(X, f, -w / 2, w / 2, -0.2, 0.2, z0, z1, zc(c.bg), ZN_GLOW, zdark(zc(c.bg), 0.9));
    if (c.pruhy) for (let k = 0; k < 4; k++) { const zz = z0 + (z1 - z0) * (0.1 + 0.22 * k); pushBox(X, f, -w / 2 - 0.02, w / 2 + 0.02, -0.24, 0.24, zz, zz + (z1 - z0) * 0.09, zc(c.pruhy), ZN_GLOW); }
    if (c.txt && c.vert) {                                       // svislý nápis: písmena pod sebou
      const n = c.txt.length, h = Math.min(w / 0.6 * 0.6, (z1 - z0) / (n * 1.25));
      for (let k = 0; k < n; k++) znText(X, pushBox, f, 0, -0.26, z1 - (k + 1) * h * 1.25, h, w, c.txt[k], zc(c.tc));
    } else if (c.txt) znText(X, pushBox, f, 0, -0.26, z0 + (z1 - z0) * 0.12, (z1 - z0) * 0.76, w * 0.94, c.txt, zc(c.tc));
    if (c.fg) { const h = (z1 - z0) * 0.6; pushBox(X, f, -h / 2, h / 2, -0.28, 0.28, z0 + (z1 - z0) * 0.2, z0 + (z1 - z0) * 0.2 + h, zc(c.fg), ZN_GLOW); }
  }
  return true;
};
