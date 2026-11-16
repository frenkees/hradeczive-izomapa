import assert from 'node:assert/strict';
import { pridej, typicka, slot } from '../../skripty/doprava_sber.mjs';

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
console.log('doprava-sber OK');
