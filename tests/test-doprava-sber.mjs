import assert from 'node:assert/strict';
import { pridej, typicka, slot, kvota, kvotaDen, slucLive, jeTomTom } from '../../skripty/doprava_sber.mjs';

const agg = { n: 0, s: {} };
const kdy = new Date('2026-11-16T07:10:00Z');                       // pondělí 8:10 v Praze
assert.equal(slot(kdy), 8);
assert.equal(slot(new Date('2026-11-14T10:00:00Z')), 24 + 11);        // sobota 11:00
assert.equal(pridej(agg, { t: 'a', s: { k1: [40, 50] } }, kdy), true);
assert.equal(pridej(agg, { t: 'a', s: { k1: [40, 50] } }, kdy), false);   // týž snímek (cache funkce) se nezapočítá dvakrát
assert.equal(pridej(agg, { t: 'b', s: { k1: [60, 40], k2: [0, 100] } }, kdy), true);
assert.equal(pridej(agg, { t: 'c', s: {} }, kdy), false);
assert.equal(pridej(agg, null, kdy), false);
const t = typicka(agg);
assert.equal(t.n, 2);
assert.equal(t.s.k1[8], 40);                                          // medián z (40, 60) = spodní prostřední
assert.equal(t.s.k1[9], null);                                        // jiná hodina: bez dat
assert.equal(t.s.k2, undefined);                                      // jediný snímek nestačí
const q = { n: 0, s: {} }, d1 = new Date('2026-11-16T07:10:00Z');
assert.equal(kvota(q, d1, 2), true); assert.equal(kvota(q, d1, 2), true); assert.equal(kvota(q, d1, 2), false);   // po limitu už ne
assert.equal(kvota(q, new Date('2026-12-01T00:10:00Z'), 2), true);                                               // nový měsíc = počítadlo od nuly
assert.equal(q.kvota.n, 1);
assert.equal(jeTomTom('t14/8910/5539/-410,2570,20'), true); assert.equal(jeTomTom('50.21305,15.90958,3143'), false);
const L1 = slucLive(null, { t: 'h1', s: { '50.1,15.8,100': [10, 90] } }, 'here');
const L2 = slucLive(L1, { t: 'tt1', s: { 't14/1/2/3,4,5': [20, 80] } }, 'tomtom');
assert.deepEqual(Object.keys(L2.s).sort(), ['50.1,15.8,100', 't14/1/2/3,4,5']);             // druhý zdroj zůstane z minula
const L3 = slucLive(L2, { t: 'h2', s: { '50.2,15.9,50': [0, 100] } }, 'here');
assert.deepEqual(Object.keys(L3.s).sort(), ['50.2,15.9,50', 't14/1/2/3,4,5']);              // staré klíče HERE se nahradí
const q2 = { n: 0, s: {} }, dd = new Date('2026-11-16T10:00:00Z');
assert.equal(kvotaDen(q2, 60, dd, 100), true); assert.equal(kvotaDen(q2, 60, dd, 100), false);   // denní limit dlaždic
assert.equal(kvotaDen(q2, 60, new Date('2026-11-17T10:00:00Z'), 100), true);
console.log('doprava-sber OK');
