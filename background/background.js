/* global browser, ThomannMatcher, ThomannClientLib */
'use strict';

const DEFAULT_SETTINGS = {
  domain: 'www.thomannmusic.ch',
  ttlHours: 24,
  hideBstock: false,
  concurrency: 2,
  spacingMs: 300,
  extraStopWords: 'recherche',
  eurChfRate: 0,        // 0 = no conversion / no "cheaper" hint across currencies
  allowCookies: false,
  matchMin: 0.6,
  uncertainMin: 0.3
};

const KNOWN_DOMAINS = ['www.thomannmusic.ch', 'www.thomann.fr', 'www.thomann.de'];
const CACHE_KEY = 'cache';
const OVERRIDES_KEY = 'overrides';
const CACHE_MAX_ENTRIES = 600;

const enabledTabs = new Set();

// ---------- settings ----------
async function getSettings() {
  const stored = await browser.storage.sync.get('settings');
  return Object.assign({}, DEFAULT_SETTINGS, stored.settings || {});
}

// ---------- cache (storage.local) ----------
const cacheStore = {
  async get(key) {
    const { [CACHE_KEY]: cache = {} } = await browser.storage.local.get(CACHE_KEY);
    return cache[key] || null;
  },
  async set(key, value) {
    const { [CACHE_KEY]: cache = {} } = await browser.storage.local.get(CACHE_KEY);
    cache[key] = value;
    const keys = Object.keys(cache);
    if (keys.length > CACHE_MAX_ENTRIES) {
      keys.sort((a, b) => cache[a].ts - cache[b].ts);
      for (const k of keys.slice(0, keys.length - CACHE_MAX_ENTRIES)) delete cache[k];
    }
    await browser.storage.local.set({ [CACHE_KEY]: cache });
  },
  async clear() { await browser.storage.local.remove(CACHE_KEY); },
  async size() {
    const { [CACHE_KEY]: cache = {} } = await browser.storage.local.get(CACHE_KEY);
    return Object.keys(cache).length;
  }
};

async function getOverrides() {
  const { [OVERRIDES_KEY]: o = {} } = await browser.storage.local.get(OVERRIDES_KEY);
  return o;
}
async function setOverride(query, articleId) {
  const o = await getOverrides();
  if (articleId) o[query.toLowerCase()] = articleId; else delete o[query.toLowerCase()];
  await browser.storage.local.set({ [OVERRIDES_KEY]: o });
}

const client = new ThomannClientLib.ThomannClient({ fetch: (u, i) => fetch(u, i), cache: cacheStore });

// ---------- permissions ----------
function originFor(domain) { return 'https://' + domain + '/*'; }
async function hasHostPermission(domain) {
  try { return await browser.permissions.contains({ origins: [originFor(domain)] }); } catch (e) { return false; }
}

// ---------- lookup ----------
async function lookup(msg) {
  const settings = await getSettings();
  const domain = settings.domain;
  if (!(await hasHostPermission(domain))) {
    return { status: 'noPermission', domain, searchUrl: ThomannClientLib.searchUrl(domain, msg.title, false) };
  }
  client.queue.configure({ concurrency: settings.concurrency, spacingMs: settings.spacingMs });

  const extra = settings.extraStopWords.split(/[,\s]+/).filter(Boolean);
  const query = ThomannMatcher.cleanQuery(msg.title, { extraStopWords: extra });
  const searchUrl = ThomannClientLib.searchUrl(domain, query || msg.title, false);
  if (!query) return { status: 'none', query, searchUrl, ranked: [] };

  const res = await client.search(domain, query, {
    ttlMs: settings.ttlHours * 3600 * 1000,
    allowCookies: settings.allowCookies,
    force: !!msg.force,
    priority: msg.priority || 0
  });
  if (res.error || !res.candidates) return { status: 'error', query, searchUrl, error: res.error || 'no data', ranked: [] };

  let candidates = res.candidates.slice();
  // Thomann's search excludes "A-140" when asked for "a-140-1": retry with the base code and merge.
  if (!ThomannMatcher.hasCodeMatch(query, candidates)) {
    for (const fq of ThomannMatcher.fallbackQueries(query)) {
      const extraRes = await client.search(domain, fq, { ttlMs: settings.ttlHours * 3600 * 1000, allowCookies: settings.allowCookies, force: !!msg.force, priority: msg.priority || 0 });
      if (!extraRes.candidates) continue;
      const seen = new Set(candidates.map((c) => c.id));
      for (const c of extraRes.candidates) if (!seen.has(c.id)) { candidates.push(c); seen.add(c.id); }
    }
  }
  if (settings.hideBstock) candidates = candidates.filter((c) => !c.bstock);

  const overrides = await getOverrides();
  const forced = overrides[query.toLowerCase()];
  let pick = ThomannMatcher.pickBest(query, candidates, { matchMin: settings.matchMin, uncertainMin: settings.uncertainMin });
  if (forced) {
    const c = pick.ranked.find((x) => x.id === forced);
    if (c) pick = { status: 'match', best: c, ranked: pick.ranked, overridden: true };
  }

  return {
    status: pick.status,
    query,
    searchUrl,
    best: pick.best,
    ranked: pick.ranked.slice(0, 5),
    overridden: !!pick.overridden,
    fromCache: res.fromCache,
    ts: res.ts,
    eurChfRate: settings.eurChfRate,
    domain
  };
}

// ---------- per-tab toggle ----------
const CONTENT_FILES = [
  'content/util.js',
  'content/adapters/leboncoin.js',
  'content/adapters/ricardo.js',
  'content/adapters/anibis.js',
  'content/adapters/generic.js',
  'content/content.js'
];

async function setBadge(tabId, on) {
  await browser.action.setBadgeText({ tabId, text: on ? 'ON' : '' });
  if (on) await browser.action.setBadgeBackgroundColor({ tabId, color: '#2e7d32' });
  await browser.action.setTitle({ tabId, title: on ? 'Thomann prices: ON (click to disable)' : 'Thomann prices: click to enable on this page' });
  try { await browser.action.setIcon({ tabId, path: on ? 'icons/on.svg' : 'icons/off.svg' }); } catch (e) { /* ignore */ }
}

async function enableOnTab(tabId) {
  const settings = await getSettings();
  // Firefox treats MV3 host_permissions as optional; ask on first use (user gesture context).
  if (!(await hasHostPermission(settings.domain))) {
    try { await browser.permissions.request({ origins: [originFor(settings.domain)] }); } catch (e) { /* ignore */ }
  }
  await browser.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
  await browser.tabs.sendMessage(tabId, { type: 'enable' }).catch(() => {});
  enabledTabs.add(tabId);
  await setBadge(tabId, true);
}

async function disableOnTab(tabId) {
  enabledTabs.delete(tabId);
  await browser.tabs.sendMessage(tabId, { type: 'disable' }).catch(() => {});
  await setBadge(tabId, false);
}

browser.action.onClicked.addListener(async (tab) => {
  if (!tab || tab.id == null) return;
  if (!/^https?:/.test(tab.url || '')) return;
  try {
    if (enabledTabs.has(tab.id)) await disableOnTab(tab.id);
    else await enableOnTab(tab.id);
  } catch (e) {
    console.error('[thomann-companion] toggle failed', e);
  }
});

browser.tabs.onRemoved.addListener((tabId) => enabledTabs.delete(tabId));

// A real navigation (not pushState) ends the per-page enablement.
browser.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  if (enabledTabs.has(details.tabId)) {
    enabledTabs.delete(details.tabId);
    setBadge(details.tabId, false).catch(() => {});
  }
});

// ---------- context menu: search selection on Thomann ----------
browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: 'thc-search-selection',
    title: 'Search "%s" on Thomann',
    contexts: ['selection']
  });
});
browser.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== 'thc-search-selection' || !info.selectionText) return;
  const settings = await getSettings();
  const q = ThomannMatcher.cleanQuery(info.selectionText) || info.selectionText.trim();
  await browser.tabs.create({ url: ThomannClientLib.searchUrl(settings.domain, q, false) });
});

// ---------- messages ----------
browser.runtime.onMessage.addListener((msg, sender) => {
  switch (msg && msg.type) {
    case 'lookup':
      return lookup(msg);
    case 'override':
      return setOverride(msg.query, msg.articleId).then(() => ({ ok: true }));
    case 'getSettings':
      return getSettings().then((s) => ({ settings: s, defaults: DEFAULT_SETTINGS, knownDomains: KNOWN_DOMAINS }));
    case 'saveSettings':
      return browser.storage.sync.set({ settings: Object.assign({}, DEFAULT_SETTINGS, msg.settings) }).then(() => ({ ok: true }));
    case 'clearCache':
      return cacheStore.clear().then(() => ({ ok: true }));
    case 'clearOverrides':
      return browser.storage.local.remove(OVERRIDES_KEY).then(() => ({ ok: true }));
    case 'cacheStats':
      return Promise.all([cacheStore.size(), getOverrides()]).then(([n, o]) => ({ cacheEntries: n, overrides: Object.keys(o).length }));
    case 'hasPermission':
      return hasHostPermission(msg.domain).then((ok) => ({ ok }));
    case 'isEnabled':
      return Promise.resolve({ enabled: sender && sender.tab ? enabledTabs.has(sender.tab.id) : false });
    case 'openTab':
      return browser.tabs.create({ url: msg.url, active: msg.active !== false }).then(() => ({ ok: true }));
    default:
      return undefined;
  }
});
