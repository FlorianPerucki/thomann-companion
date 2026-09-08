/* global browser */
'use strict';

const $ = (id) => document.getElementById(id);
const FIELDS = ['hideBstock', 'skipWords', 'extraStopWords', 'matchMin', 'eurChfRate', 'ttlHours', 'concurrency', 'spacingMs', 'allowCookies', 'reverseMatchMin', 'reverseTtlHours', 'lbcCategory', 'marketLang', 'allowMarketCookies', 'marketCookieFallback', 'lbcSkipInProgress', 'youtube', 'modulargrid'];
const SOURCES = ['leboncoin', 'ricardo', 'anibis'];
const SOURCE_ORIGIN = { leboncoin: 'https://www.leboncoin.fr/*', ricardo: 'https://www.ricardo.ch/*', anibis: 'https://www.anibis.ch/*' };
let defaults = {};
let knownDomains = [];

function status(msg, cls) {
  const el = $('status');
  el.textContent = msg;
  el.className = cls || '';
}

function currentDomain() {
  const custom = $('customDomain').value.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return custom || $('domain').value;
}

function fill(s) {
  $('domain').innerHTML = '';
  for (const d of knownDomains) {
    const o = document.createElement('option');
    o.value = d; o.textContent = d;
    $('domain').appendChild(o);
  }
  if (knownDomains.includes(s.domain)) { $('domain').value = s.domain; $('customDomain').value = ''; }
  else { $('customDomain').value = s.domain; }
  for (const f of FIELDS) {
    const el = $(f);
    if (el.type === 'checkbox') el.checked = !!s[f]; else el.value = s[f];
  }
  for (const src of SOURCES) $('src-' + src).checked = !s.sources || s.sources[src] !== false;
  refreshPermission();
  refreshMarketPermissions();
}

function read() {
  const s = { domain: currentDomain() };
  for (const f of FIELDS) {
    const el = $(f);
    if (el.type === 'checkbox') s[f] = el.checked;
    else if (el.type === 'number') s[f] = Number(el.value);
    else s[f] = el.value;
  }
  s.sources = {};
  for (const src of SOURCES) s.sources[src] = $('src-' + src).checked;
  return s;
}

async function refreshMarketPermissions() {
  const { perms } = await browser.runtime.sendMessage({ type: 'marketPermissions' });
  try {
    const mg = await browser.permissions.contains({ origins: ['https://modulargrid.com/*'] });
    $('perm-modulargrid').textContent = mg ? '✓ access granted' : 'no access yet';
    $('perm-modulargrid').className = mg ? 'ok' : 'warn';
    $('grantMg').hidden = mg || !$('modulargrid').checked;
  } catch (e) { /* ignore */ }
  let missing = false;
  for (const src of SOURCES) {
    const ok = perms[src];
    const el = $('perm-' + src);
    el.textContent = ok ? '✓ access granted' : 'no access yet';
    el.className = ok ? 'ok' : 'warn';
    if (!ok && $('src-' + src).checked) missing = true;
  }
  $('grantMarkets').hidden = !missing;
}

async function refreshPermission() {
  const domain = currentDomain();
  const { ok } = await browser.runtime.sendMessage({ type: 'hasPermission', domain });
  $('perm').textContent = ok ? '✓ access granted for ' + domain : '⚠ no access to ' + domain + ' yet';
  $('perm').className = ok ? 'ok' : 'warn';
  $('grant').hidden = ok;
}

async function refreshStats() {
  const st = await browser.runtime.sendMessage({ type: 'cacheStats' });
  $('stats').textContent = st.cacheEntries + ' cached lookups · ' + st.overrides + ' manual matches · ' + (st.hidden || 0) + ' hidden listings';
}

async function load() {
  const r = await browser.runtime.sendMessage({ type: 'getSettings' });
  defaults = r.defaults;
  knownDomains = r.knownDomains;
  fill(r.settings);
  refreshStats();
}

$('save').addEventListener('click', async () => {
  const s = read();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}(\/[a-z0-9_-]+)*$/i.test(s.domain)) { status('Invalid domain (host, optionally followed by a locale path such as /fr-ch)', 'warn'); return; }
  await browser.runtime.sendMessage({ type: 'saveSettings', settings: s });
  status('Saved.', 'ok');
  refreshPermission();
});

$('reset').addEventListener('click', () => { fill(defaults); status('Defaults restored (not saved yet).'); });

$('grant').addEventListener('click', async () => {
  const domain = currentDomain();
  try {
    const ok = await browser.permissions.request({ origins: ['https://' + domain.split('/')[0] + '/*'] });
    status(ok ? 'Access granted.' : 'Access denied.', ok ? 'ok' : 'warn');
  } catch (e) {
    status('Cannot request access for ' + domain + ' (not declared in the manifest).', 'warn');
  }
  refreshPermission();
});

$('grantMarkets').addEventListener('click', async () => {
  const origins = SOURCES.filter((src) => $('src-' + src).checked).map((src) => SOURCE_ORIGIN[src]);
  if (!origins.length) return;
  try {
    const ok = await browser.permissions.request({ origins });
    status(ok ? 'Access granted.' : 'Access denied.', ok ? 'ok' : 'warn');
  } catch (e) { status('Cannot request access: ' + e.message, 'warn'); }
  refreshMarketPermissions();
});
for (const src of SOURCES) $('src-' + src).addEventListener('change', refreshMarketPermissions);
$('modulargrid').addEventListener('change', refreshMarketPermissions);
$('grantMg').addEventListener('click', async () => {
  try {
    const ok = await browser.permissions.request({ origins: ['https://modulargrid.com/*'] });
    status(ok ? 'Access granted.' : 'Access denied.', ok ? 'ok' : 'warn');
  } catch (e) { status('Cannot request access: ' + e.message, 'warn'); }
  refreshMarketPermissions();
});
$('clearHidden').addEventListener('click', async () => { await browser.runtime.sendMessage({ type: 'clearHidden' }); status('Hidden listings cleared.', 'ok'); refreshStats(); });

$('clearCache').addEventListener('click', async () => { await browser.runtime.sendMessage({ type: 'clearCache' }); status('Cache cleared.', 'ok'); refreshStats(); });
$('clearOverrides').addEventListener('click', async () => { await browser.runtime.sendMessage({ type: 'clearOverrides' }); status('Manual matches cleared.', 'ok'); refreshStats(); });
$('domain').addEventListener('change', refreshPermission);
$('customDomain').addEventListener('input', refreshPermission);

load();
