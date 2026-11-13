# terén z laseru: DMR 5G (ČÚZK, CC BY 4.0, digitální model reliéfu 5. generace, jen body terénu, přesnost ~0,2 m)
# -> build/dmr/<list>.laz a build/teren_dmr.npz (mřížka po 2,5 m v lokálních metrech mapy: z, x0, y1, krok)
# prep.py ji použije místo Terrarium (Terrarium má ~10 m na pixel a ve městě o metry výš, rozmaže hrany návrší, nábřeží a hráze)
# spouštět z kořene repa po dmp_fetch.py (seznam listů se bere z build/dmp/): python nastroje/teren_dmr.py
import glob, os, subprocess, sys; sys.path.insert(0, '.')
from multiprocessing import Pool
import numpy as np, laspy
from pyproj import Transformer
import geo

D = 'build/dmr/'; os.makedirs(D, exist_ok=True)
RES = 2.5
X0, Y0, X1, Y1 = geo.extent(geo.MARGIN + 200)
NX, NY = int((X1 - X0) / RES) + 1, int((Y1 - Y0) / RES) + 1


def fetch(n):
    z = f'{D}{n}.laz'
    if os.path.exists(z): return z
    subprocess.run(['curl', '-sL', '-m', '300', '-o', f'{D}{n}.zip', f'https://openzu.cuzk.cz/opendata/DMR5G/epsg-5514/{n}.zip'], check=True)
    subprocess.run(['unzip', '-oq', f'{D}{n}.zip', '-d', D], check=True); os.remove(f'{D}{n}.zip')
    return z if os.path.exists(z) else (glob.glob(f'{D}{n}*.laz') or [None])[0]


def grid(f):
    """součet a počet výšek bodů terénu v buňkách mřížky"""
    T = Transformer.from_crs(5514, 4326, always_xy=True)
    l = laspy.read(f)
    m = np.isin(np.array(l.classification), (2,)) if len(np.unique(l.classification)) > 1 else slice(None)
    lon, lat = T.transform(np.array(l.x)[m], np.array(l.y)[m])
    x, y = geo.to_local(lon, lat); z = np.array(l.z)[m]
    i = np.floor((x - X0) / RES).astype(np.int64); j = np.floor((Y1 - y) / RES).astype(np.int64)
    ok = (i >= 0) & (i < NX) & (j >= 0) & (j < NY)
    k = j[ok] * NX + i[ok]
    return np.bincount(k, z[ok], NX * NY), np.bincount(k, None, NX * NY)


if __name__ == '__main__':
    sheets = sorted(os.path.basename(f)[:-4] for f in glob.glob('build/dmp/*.laz'))
    if not sheets: sys.exit('nejdřív python dmp_fetch.py (seznam listů)')
    with Pool(6) as p: files = [f for f in p.map(fetch, sheets) if f]
    print('listů DMR 5G', len(files), flush=True)
    S = np.zeros(NX * NY); C = np.zeros(NX * NY)
    with Pool(6) as p:
        for s, c in p.imap_unordered(grid, files): S += s; C += c
    Z = np.where(C > 0, S / np.maximum(C, 1), np.nan).reshape(NY, NX)
    # díry (voda, pod budovami, bez bodů): do díry se po krocích šíří nejnižší okolní hodnota -> řeka dostane výšku hladiny
    # u břehu, ne výšku břehu; pod budovou je terén jako nejnižší okolní (budova ho zakryje)
    from scipy import ndimage
    # malé mezery mezi body (DMR 5G je řídká síť, ~40 % buněk po 2,5 m): vážený průměr okolí do ~5 m
    k_ = ~np.isnan(Z); Wt = ndimage.gaussian_filter(k_.astype(float), 1.5); Vt = ndimage.gaussian_filter(np.where(k_, Z, 0.0), 1.5)
    Z = np.where(k_, Z, np.where(Wt > 0.08, Vt / np.maximum(Wt, 1e-9), np.nan))
    miss = np.isnan(Z); F = np.where(miss, np.inf, Z); todo = miss.copy()
    for _ in range(400):
        if not todo.any(): break
        e = ndimage.grey_erosion(F, size=3)
        new = todo & np.isfinite(e)
        F[new] = e[new]; todo &= ~new
    F[~np.isfinite(F)] = np.nanmedian(Z)
    Z = np.where(miss, ndimage.uniform_filter(F, 5), Z)          # doplněná místa uhladit (žádné schody v hladině)
    np.savez_compressed('build/teren_dmr.npz', z=Z.astype(np.float32), x0=X0, y1=Y1, res=RES)
    print('terén z DMR 5G', NX, '×', NY, f'po {RES} m, změřeno {100 * (1 - miss.mean()):.0f} % buněk, výšky {np.nanmin(Z):.1f}–{np.nanmax(Z):.1f} m')
