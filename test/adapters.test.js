'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

// Markup captured from the real sites (September 2026), trimmed to what the adapters rely on.
const LBC_HTML = `
<main>
<article aria-label="(eurorack) Doepfer a-148"><div data-qa-id="aditem_container">
  <a class="absolute inset-0" aria-label="Voir l’annonce" href="/ad/instruments_de_musique/3263022871"></a>
  <p class="text-callout font-bold"><span class="text-success">50 €</span></p>
</div></article>
<article aria-label="Doepfer A-140-1"><div data-qa-id="aditem_container">
  <a href="/ad/instruments_de_musique/3263022872"></a>
  <p><span class="text-success">1 250 €</span></p>
</div></article>
<article aria-label="Not an ad (no link)"><div>nothing</div></article>
</main>`;

const RICARDO_HTML = `
<div data-testid="regular-results"><div>
<a class="MuiBox-root" href="/fr/a/doepfer-a-156-ve-1328920578/"><img alt="Doepfer A-156 VE" src="x">
  <span>Doepfer A-156 VE</span><span>Doepfer</span><span>70.00</span><span>Achat direct</span><span>Dim 4 oct, 16:09</span></a>
<a class="MuiBox-root" href="/fr/a/eurorack-modul-doepfer-a-110-standard-vco-1328071298/"><img alt="Eurorack Modul - Doepfer - A-110 Standard VCO" src="x">
  <span>Eurorack Modul - Doepfer - A-110 Standard VCO</span><span>Doepfer</span><span>99.00</span><span>(0 enchère)</span><span>109.00</span><span>Achat direct</span><span>Lun 14 sept</span></a>
</div></div>`;

const ANIBIS_HTML = `
<div data-private-srp-listing-item-id="54530781"><a tabindex="0" href="/fr/vi/1073912570"><img alt="Doepfer A-118 Noise" src="x"></a>
  <span>Seftigen, 3662, Aujourd'hui 11:49</span><div><a href="/fr/vi/1073912570">Doepfer A-118 Noise</a></div><span>Very nice</span><span>45.-</span></div>
<div data-private-srp-listing-item-id="54530782"><a href="/fr/vi/1073912571"><img alt="Gratuit thing" src="x"></a><span>Gratuit</span></div>`;

function load(html, url) {
  const dom = new JSDOM(html, { url });
  const g = globalThis;
  const saved = { window: g.window, document: g.document, location: g.location, NodeFilter: g.NodeFilter, __thcUtil: g.__thcUtil, __thcAdapters: g.__thcAdapters };
  g.window = dom.window; g.document = dom.window.document; g.location = dom.window.location; g.NodeFilter = dom.window.NodeFilter;
  delete g.__thcUtil; g.__thcAdapters = [];
  // getBoundingClientRect is zero in jsdom; treat everything as visible.
  dom.window.Element.prototype.getBoundingClientRect = () => ({ width: 1, height: 1 });
  const dir = path.join(__dirname, '..', 'content');
  for (const f of ['util.js', 'adapters/leboncoin.js', 'adapters/ricardo.js', 'adapters/anibis.js', 'adapters/thomann.js', 'adapters/generic.js']) {
    new Function(fs.readFileSync(path.join(dir, f), 'utf8'))();
  }
  const adapters = g.__thcAdapters;
  const adapter = adapters.find((a) => a.matches(dom.window.location));
  const products = adapter.findProducts(dom.window.document);
  Object.assign(g, saved);
  return { adapter, products };
}

test('leboncoin adapter reads cards', () => {
  const { adapter, products } = load(LBC_HTML, 'https://www.leboncoin.fr/recherche?text=doepfer');
  assert.equal(adapter.name, 'leboncoin');
  assert.equal(products.length, 2);
  assert.equal(products[0].key, 'lbc:3263022871');
  assert.equal(products[0].title, '(eurorack) Doepfer a-148');
  assert.equal(products[0].priceValue, 50);
  assert.equal(products[0].currency, 'EUR');
  assert.equal(products[0].mount.textContent, '50 €');
  assert.equal(products[1].priceValue, 1250);
});

test('ricardo adapter reads cards and prefers the buy-now price', () => {
  const { adapter, products } = load(RICARDO_HTML, 'https://www.ricardo.ch/fr/s/doepfer/');
  assert.equal(adapter.name, 'ricardo');
  assert.equal(products.length, 2);
  assert.equal(products[0].key, 'ric:1328920578');
  assert.equal(products[0].title, 'Doepfer A-156 VE');
  assert.equal(products[0].priceValue, 70);
  assert.equal(products[0].currency, 'CHF');
  assert.equal(products[1].priceValue, 109);
});

test('anibis adapter reads cards', () => {
  const { adapter, products } = load(ANIBIS_HTML, 'https://www.anibis.ch/fr/q/doepfer');
  assert.equal(adapter.name, 'anibis');
  assert.equal(products.length, 2);
  assert.equal(products[0].key, 'ani:54530781');
  assert.equal(products[0].title, 'Doepfer A-118 Noise');
  assert.equal(products[0].priceValue, 45);
  assert.equal(products[1].priceValue, null); // "Gratuit": badge still shown, no price to compare
});

test('generic adapter handles a JSON-LD product page', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Maths', brand: { name: 'Make Noise' }, offers: { price: '299', priceCurrency: 'EUR' } })}</script>
    <main><h1>Make Noise Maths</h1><div><span class="price">299,00 €</span></div></main>`;
  const { adapter, products } = load(html, 'https://shop.example.com/p/123');
  assert.equal(adapter.name, 'generic');
  assert.equal(products.length, 1);
  assert.equal(products[0].title, 'Make Noise Maths');
  assert.equal(products[0].priceValue, 299);
  assert.equal(products[0].mount.className, 'price');
});

test('leboncoin adapter handles the ad page (main price + sticky header, not the other ads)', () => {
  const html = `<main>
    <div class="sticky"><p class="text-headline-2">50 €</p></div>
    <h1>Doepfer A-183-5 Quad Attenuator</h1>
    <p class="text-headline-1">50 €</p>
    <section><article aria-label="Other ad"><div data-qa-id="aditem_container"><a href="/ad/instruments_de_musique/1"></a><span class="text-success">50 €</span></div></article></section>
  </main>`;
  const { products } = load(html, 'https://www.leboncoin.fr/ad/instruments_de_musique/3215266634');
  assert.equal(products.length, 2);
  assert.ok(products.every((p) => p.title === 'Doepfer A-183-5 Quad Attenuator' && p.priceValue === 50));
  assert.equal(products.find((p) => p.key === 'lbc:3215266634').mount.className, 'text-headline-1');
});

test('thomann adapter reads product-list entries and the product page, and targets the marketplaces', () => {
  const list = `<div class="fx-product-list-entry" data-product-id="166483"><div class="product"><a class="product__content" href="doepfer_a131.htm">
    <div class="product__title fx-text"><span class="title__manufacturer">Doepfer </span><span class="title__name">A-131</span></div></a>
    <div class="product__price"><div class="fx-typography-price-primary fx-price-group__primary product__price-primary">68 CHF</div></div></div></div>
    <div class="fx-product-list-entry" data-product-id="372340"><div class="product__title"><span class="title__manufacturer">Doepfer </span><span class="title__name">A-110-4 Thru Zero Quad VCO SE</span></div>
    <div class="fx-typography-price-primary product__price-primary"></div></div>`;
  const { adapter, products } = load(list, 'https://www.thomannmusic.ch/search_dir.html?sw=doepfer');
  assert.equal(adapter.name, 'thomann');
  assert.deepEqual(adapter.sources, ['leboncoin', 'ricardo', 'anibis']);
  assert.equal(products.length, 2);
  assert.equal(products[0].key, 'tho:166483');
  assert.equal(products[0].title, 'Doepfer A-131');
  assert.equal(products[0].priceValue, 68);
  assert.equal(products[0].currency, 'CHF');
  assert.equal(products[1].priceValue, null); // price filled later by Thomann's JS

  const page = `<main><h1 class="font-sans">\n  Doepfer A-131\n</h1><div class="price-and-availability"><div class="fx-price-group"><span class="fx-typography-price-primary fx-price-group__primary">68 CHF</span></div></div>
    <div class="price-and-availability"><span class="fx-price-group__primary">109 CHF</span></div></main>`;
  const r2 = load(page, 'https://www.thomannmusic.ch/doepfer_a131.htm');
  assert.equal(r2.products.length, 1);
  assert.equal(r2.products[0].title, 'Doepfer A-131');
  assert.equal(r2.products[0].priceValue, 68);
  assert.equal(r2.products[0].key, 'tho:/doepfer_a131');
});

test('adapters expose the title element so link pills can sit next to the name', () => {
  const lbc = load(LBC_HTML.replace('<p class="text-callout font-bold">', '<p class="title">(eurorack) Doepfer a-148</p><p class="text-callout font-bold">'), 'https://www.leboncoin.fr/recherche?text=doepfer');
  assert.equal(lbc.products[0].titleEl.className, 'title');
  const ric = load(RICARDO_HTML, 'https://www.ricardo.ch/fr/s/doepfer/');
  assert.equal(ric.products[0].titleEl.textContent, 'Doepfer A-156 VE');
  assert.equal(ric.products[0].image, 'x');
  const ani = load(ANIBIS_HTML, 'https://www.anibis.ch/fr/q/doepfer');
  assert.equal(ani.products[0].titleEl.tagName, 'A');
});
