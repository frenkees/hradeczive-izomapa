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
};
