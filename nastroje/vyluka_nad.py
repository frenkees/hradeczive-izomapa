# Náhradní autobusová doprava za výluku trati HK hl.n. – Jaroměř (1. 11. – 12. 12. 2026) -> build/gtfs_extra/*.txt (doplní mhd.py k GTFS)
# Odjezdy z odjezdy.json (přepsané z PDF ČD cz-k031-2026vyluka08.pdf, cesta níže): zastávka MHD „F“ u nádražní budovy -> Jaroměř; v mapě jedou
# jen do zastávky Plotiště Říčařova na severním okraji (dál trasa vede mimo mapu). Dny: denně / pracovní dny / so+ne podle značek v PDF.
# python nastroje/vyluka_nad.py   (z kořene izomapa/; po něm python mhd.py)
import csv, io, json, os, sys, zipfile
sys.path.insert(0, '.')
ODJ = os.environ.get('VYLUKA_ODJEZDY', r'C:\Users\pavel\AppData\Local\Temp\claude\7d29c3d8097f1fda\37c9896b-e31d-4158-8be8-ab6bba82ef4b\scratchpad\vyluka\odjezdy.json')
if not os.path.exists(ODJ) and os.path.exists('assets/vyluka_odjezdy.json'): ODJ = 'assets/vyluka_odjezdy.json'
D = json.load(open(ODJ, encoding='utf-8'))
json.dump(D, open('assets/vyluka_odjezdy.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)     # uložit do repa (data z veřejného PDF ČD)
OD, DO = D['platnost']['od'].replace('-', ''), D['platnost']['do'].replace('-', '')
zf = zipfile.ZipFile('build/gtfs.zip')
hdr = lambda n: next(csv.reader(io.TextIOWrapper(zf.open(n + '.txt'), encoding='utf-8-sig')))
os.makedirs('build/gtfs_extra', exist_ok=True)
def zapis(n, rows):
    h = hdr(n)
    with open(f'build/gtfs_extra/{n}.txt', 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=h); w.writeheader()
        for r in rows: w.writerow({k: r.get(k, '') for k in h})
AG = 'NAD_VYL'
zapis('agency', [{'agency_id': AG, 'agency_name': 'Náhradní autobusová doprava (výluka Hradec Králové – Jaroměř)', 'agency_timezone': 'Europe/Prague'}])
LINKY = {'J': 'NAD J Hradec Králové – Jaroměř', 'R': 'NAD R Hradec Králové – Jaroměř', 'Z': 'NAD Z Hradec Králové – Jaroměř (zastavuje)'}
zapis('routes', [{'route_id': 'NAD_' + k, 'agency_id': AG, 'route_short_name': k, 'route_long_name': v + ' linka: ' + k, 'route_type': '3'} for k, v in LINKY.items()])
# zastávky: F u nádražní budovy (poloha zastávky MHD Hlavní nádraží), cíl na severním okraji mapy
zapis('stops', [
    {'stop_id': 'NAD_F', 'stop_name': 'Hradec Králové, hlavní nádraží, zastávka F (NAD)', 'stop_lat': '50.213799', 'stop_lon': '15.812720', 'location_type': '1'},
    {'stop_id': 'NAD_PL', 'stop_name': 'Hradec Králové, Plotiště Říčařova (NAD směr Jaroměř)', 'stop_lat': '50.240299', 'stop_lon': '15.807600', 'location_type': '1'}])
sv = {'denne': ('NADS_DEN', [1] * 7), 'pracovni dny': ('NADS_PRAC', [1, 1, 1, 1, 1, 0, 0]), 'so+ne': ('NADS_VIK', [0, 0, 0, 0, 0, 1, 1])}
zapis('calendar', [dict(service_id=sid, **dict(zip(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'], map(str, dd))), start_date=OD, end_date=DO) for sid, dd in sv.values()])
sec = lambda t: int(t[:2]) * 3600 + int(t[3:5]) * 60
hms = lambda s: f'{s // 3600:02d}:{s % 3600 // 60:02d}:00'
trips, st = [], []
for i, o in enumerate(D['hk_do_jaromere']):
    sid = sv.get(o['dny'], sv['denne'])[0]; tid = f'NAD_{i}_{o["spoj"]}'
    trips.append({'route_id': 'NAD_' + o['linka'], 'trip_id': tid, 'service_id': sid, 'trip_headsign': 'Jaroměř', 'trip_short_name': o['spoj']})
    t0 = sec(o['odjezd']); dur = (sec(o['prijezd_jaromer']) - t0)
    st += [{'trip_id': tid, 'stop_id': 'NAD_F', 'arrival_time': hms(t0), 'departure_time': hms(t0), 'stop_sequence': '1'},
           {'trip_id': tid, 'stop_id': 'NAD_PL', 'arrival_time': hms(t0 + 420), 'departure_time': hms(t0 + 420), 'stop_sequence': '2'}]
zapis('trips', trips); zapis('stop_times', st)
print('NAD spojů', len(trips))
