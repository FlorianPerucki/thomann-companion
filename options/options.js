/* global browser */
'use strict';

const $ = (id) => document.getElementById(id);
const FIELDS = ['hideBstock', 'skipWords', 'extraStopWords', 'matchMin', 'eurChfRate', 'ttlHours', 'concurrency', 'spacingMs', 'allowCookies'];
let defaults = {};
let knownDomains = [];

function status(msg, cls) {
  const el = $('status');
  el.textContent = msg;
  el.className = cls || '';
}

function currentDomain() {
  const custom = $('customDomain').value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
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
  refreshPermission();
}

function read() {
  const s = { domain: currentDomain() };
  for (const f of FIELDS) {
    const el = $(f);
    if (el.type === 'checkbox') s[f] = el.checked;
    else if (el.type === 'number') s[f] = Number(el.value);
    else s[f] = el.value;
  }
  return s;
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
  $('stats').textContent = st.cacheEntries + ' cached lookups · ' + st.overrides + ' manual matches';
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
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s.domain)) { status('Invalid domain', 'warn'); return; }
  await browser.runtime.sendMessage({ type: 'saveSettings', settings: s });
  status('Saved.', 'ok');
  refreshPermission();
});

$('reset').addEventListener('click', () => { fill(defaults); status('Defaults restored (not saved yet).'); });

$('grant').addEventListener('click', async () => {
  const domain = currentDomain();
  try {
    const ok = await browser.permissions.request({ origins: ['https://' + domain + '/*'] });
    status(ok ? 'Access granted.' : 'Access denied.', ok ? 'ok' : 'warn');
  } catch (e) {
    status('Cannot request access for ' + domain + ' (not declared in the manifest).', 'warn');
  }
  refreshPermission();
});

$('clearCache').addEventListener('click', async () => { await browser.runtime.sendMessage({ type: 'clearCache' }); status('Cache cleared.', 'ok'); refreshStats(); });
$('clearOverrides').addEventListener('click', async () => { await browser.runtime.sendMessage({ type: 'clearOverrides' }); status('Manual matches cleared.', 'ok'); refreshStats(); });
$('domain').addEventListener('change', refreshPermission);
$('customDomain').addEventListener('input', refreshPermission);

load();
