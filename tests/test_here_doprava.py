import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'nastroje'))
import here_doprava as H


def usek(lat, lng, delka, jam, rychlost, volna):
    return {'location': {'description': 'x', 'length': delka, 'shape': {'links': [{'points': [{'lat': lat, 'lng': lng}, {'lat': lat + .001, 'lng': lng}]}]}},
            'currentFlow': {'jamFactor': jam, 'speed': rychlost, 'freeFlow': volna}}


class TestHere(unittest.TestCase):
    def test_klic_je_stabilni(self):
        self.assertEqual(H.klic(usek(50.2, 15.8, 120.4, 1, 5, 8)), '50.20000,15.80000,120')

    def test_snimek_z(self):
        d = {'results': [usek(50.2, 15.8, 100, 3.3, 4, 8), usek(50.3, 15.8, 100, 0, 9, 8)]}
        ids = {H.klic(d['results'][0]): 7, H.klic(d['results'][1]): 8}
        s = H.snimek_z(d, ids)
        self.assertEqual(s[7], [33, 50]); self.assertEqual(s[8], [0, 100])   # rychlost se ořízne na volnou

    def test_snimek_z_bez_jamfactoru_a_neznamy_usek(self):
        r = usek(50.2, 15.8, 100, 1, 4, 8); del r['currentFlow']['jamFactor']
        self.assertEqual(H.snimek_z({'results': [r, usek(50.9, 15.8, 1, 1, 1, 1)]}, {H.klic(r): 1}), {})


if __name__ == '__main__':
    unittest.main()
