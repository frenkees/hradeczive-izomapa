"""Místní náhled mapy s api/doprava (HERE): python nastroje/nahled_doprava.py [port]  ->  http://127.0.0.1:<port>
Obsluhuje složku site/ jako `npm run nahled` a navíc /api/doprava stejně jako Vercel funkce (cache 10 min). Poslouchá jen na 127.0.0.1."""
import http.server, json, os, sys, time, functools
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import here_doprava as H

pamet = {'t': 0, 'telo': b'{"s":{}}'}


def provoz():
    if time.time() - pamet['t'] > 600:
        d = H.stahni(); s = {}
        for r in d.get('results', []):
            f = r.get('currentFlow') or {}
            if 'jamFactor' not in f: continue
            ff = f.get('freeFlow') or 0
            s[H.klic(r)] = [round(f['jamFactor'] * 10), round(100 * min(1.0, (f.get('speed') or 0) / ff)) if ff else 100]
        pamet.update(t=time.time(), telo=json.dumps({'t': d.get('sourceUpdated'), 's': s}).encode())
    return pamet['telo']


class Obsluha(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split('?')[0] == '/api/doprava':
            try: telo = provoz(); kod = 200
            except Exception as e: telo = b'{"s":{}}'; kod = 502; print('HERE:', e)
            self.send_response(kod); self.send_header('content-type', 'application/json'); self.send_header('content-length', str(len(telo))); self.end_headers(); self.wfile.write(telo); return
        if self.path.split('?')[0] == '/api/doprava_typicka':   # místní zkouška: build/here/data/typicka.json ze sběrače (skripty/doprava_sber.mjs)
            f = os.path.join(H.ROOT, 'build', 'here', 'data', 'typicka.json')
            telo = open(f, 'rb').read() if os.path.exists(f) else b'{"n":0,"s":{}}'
            self.send_response(200); self.send_header('content-type', 'application/json'); self.send_header('content-length', str(len(telo))); self.end_headers(); self.wfile.write(telo); return
        super().do_GET()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
    site = os.path.join(H.ROOT, 'site')
    http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(Obsluha, directory=site)).serve_forever()
