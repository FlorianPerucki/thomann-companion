'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../background/matcher.js');
const fixture = require('./fixtures/search_doepfer_a110.json');
const { parseSearchPayload } = require('../background/thomann-client.js');

const candidates = parseSearchPayload(fixture, 'www.thomannmusic.ch');

test('normalizeModelCodes unifies spellings', () => {
  assert.equal(M.normalizeModelCodes('Doepfer A 110 VCO'), 'Doepfer a-110 VCO');
  assert.equal(M.normalizeModelCodes('doepfer a110'), 'doepfer a-110');
  assert.equal(M.normalizeModelCodes('Doepfer A-110-1'), 'Doepfer a-110-1');
  assert.equal(M.normalizeModelCodes('Doepfer A 110 1'), 'Doepfer a-110-1');
  assert.equal(M.normalizeModelCodes('PK88GH'), 'PK88GH'); // no boundary after digits
});

test('cleanQuery strips noise and keeps brand + model', () => {
  assert.equal(M.cleanQuery('(eurorack) Doepfer a-148'), 'doepfer a-148');
  assert.equal(M.cleanQuery('Doepfer A-140-1 TBE comme neuf'), 'doepfer a-140-1');
  assert.equal(M.cleanQuery('Module doepfer A 110 vco'), 'doepfer vco a-110');
  assert.equal(M.cleanQuery('Vends Make Noise Maths, très bon état'), 'make noise maths');
  assert.equal(M.cleanQuery('Doepfer A-110-1 TBE', { extraStopWords: ['doepfer'] }), 'a-110-1');
});

test('exact model code wins over siblings', () => {
  const r = M.pickBest('doepfer a-110-2', candidates);
  assert.equal(r.status, 'match');
  assert.equal(r.best.model, 'A-110-2');
});

test('plain "a-110" is uncertain among A-110-x variants', () => {
  const r = M.pickBest('doepfer a-110', candidates);
  assert.notEqual(r.status, 'none');
  assert.ok(r.ranked[0].model.startsWith('A-110'));
});

test('vintage edition loses to the standard model unless asked for', () => {
  const r = M.pickBest('doepfer a-110-1', candidates);
  assert.equal(r.best.model, 'A-110-1');
  const v = M.pickBest('doepfer a-110-1 vintage edition', candidates);
  assert.equal(v.best.model, 'A-110-1 Vintage Edition');
});

test('the cheapest offer of the identified product wins, B-stock included', () => {
  const r = M.pickBest('doepfer a-110-4 thru zero quad vco', candidates);
  assert.equal(r.status, 'match');
  assert.equal(r.best.bstock, true);
  assert.equal(r.best.price, 118);
  assert.equal(r.best.aStockId, '267881');
  // The new-condition sibling comes right after it, then other products.
  assert.equal(r.ranked[1].model, 'A-110-4 Thru Zero Quad VCO');
  assert.equal(r.ranked[1].bstock, false);
  // A B-stock of a *different* product never wins on price alone.
  const r2 = M.pickBest('doepfer a-110-2', candidates);
  assert.equal(r2.best.model, 'A-110-2');
});

test('unrelated query yields none', () => {
  const r = M.pickBest('make noise maths', candidates);
  assert.equal(r.status, 'none');
});

test('"a-140-1" matches Thomann\'s "A-140" (base model) and proposes a fallback query', () => {
  const real = [['A-140-2', 127], ['A-100BS2-P9 PSU3', 2190], ['A-140-2 VE', 145], ['A-140-3', 90], ['A-140', 59], ['A-140 Vintage Edition', 84], ['A-140-3 VE', 99]]
    .map(([model, price]) => ({ manufacturer: 'Doepfer', model, price, inStock: true }));
  assert.deepEqual(M.fallbackQueries('doepfer a-140-1'), ['doepfer a-140']);
  assert.equal(M.hasCodeMatch('doepfer a-140-1', real.slice(0, 4)), false);
  assert.equal(M.hasCodeMatch('doepfer a-140-1', real), true);
  const r = M.pickBest('doepfer a-140-1', real);
  assert.equal(r.status, 'match');
  assert.equal(r.best.model, 'A-140');
  assert.equal(M.pickBest('doepfer a-140-2', real).best.model, 'A-140-2');
});

test('fallback queries narrow to brand + model code (Thomann ANDs all terms)', () => {
  assert.deepEqual(M.fallbackQueries('doepfer exponential vca a-131'), ['doepfer a-131']);
  assert.deepEqual(M.fallbackQueries('doepfer exponential vca a-140-1'), ['doepfer a-140-1', 'doepfer a-140', 'doepfer exponential vca a-140']);
  assert.deepEqual(M.fallbackQueries('make noise maths'), []);
});

test('a direct hit wins a tie against an alternative of the same product', () => {
  const alt = { manufacturer: 'Doepfer', model: 'A-131', price: 68, inStock: true, alternative: true, id: '1' };
  const direct = { manufacturer: 'Doepfer', model: 'A-131', price: 68, inStock: true, alternative: false, id: '2' };
  const r = M.pickBest('doepfer a-131', [alt, direct]);
  assert.equal(r.best.id, '2');
  assert.equal(M.pickBest('doepfer a-131', [alt]).status, 'match');
});
