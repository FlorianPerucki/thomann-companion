/* global browser, ThomannMatcher, ThomannClientLib */
'use strict';

const DEFAULT_SETTINGS = {
  domain: 'www.thomannmusic.ch',
  ttlHours: 24,
  hideBstock: false,
  concurrency: 2,
  spacingMs: 300,
  extraStopWords: '',
  skipWords: 'recherche',   // titles containing one of these words are not looked up at all
  eurChfRate: 0,        // 0 = no conversion / no "cheaper" hint across currencies
  allowCookies: false,
  matchMin: 0.6,
  uncertainMin: 0.3
};

const KNOWN_DOMAINS = ['www.thomannmusic.ch', 'www.thomann.fr', 'www.thomann.de'];
const CACHE_KEY = 'cache';
const OVERRIDES_KEY = 'overrides';
const CACHE_MAX_ENTRIES = 600;

const enabledTabs = new Map(); // tabId -> { mode: 'page' | 'keep', origin? }

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

  const skip = ThomannMatcher.findSkipWord(msg.title, settings.skipWords.split(/[,\s]+/).filter(Boolean));
  if (skip) return { status: 'skipped', skipWord: skip, searchUrl: ThomannClientLib.searchUrl(domain, msg.title, false), ranked: [] };

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

  let candidates = res.candidates.map((c) => Object.assign({}, c));
  // Thomann ANDs all terms and excludes "A-140" when asked for "a-140-1": when there is no direct
  // hit carrying the model code, retry with narrower queries and merge the results.
  const hasDirect = (list) => list.some((c) => !c.alternative) && ThomannMatcher.hasCodeMatch(query, list.filter((c) => !c.alternative));
  if (!hasDirect(candidates)) {
    for (const fq of ThomannMatcher.fallbackQueries(query)) {
      const extraRes = await client.search(domain, fq, { ttlMs: settings.ttlHours * 3600 * 1000, allowCookies: settings.allowCookies, force: !!msg.force, priority: msg.priority || 0 });
      if (!extraRes.candidates) continue;
      const seen = new Map(candidates.map((c) => [c.id, c]));
      for (const c of extraRes.candidates) {
        const prev = seen.get(c.id);
        if (!prev) { candidates.push(c); seen.set(c.id, c); }
        else if (prev.alternative && !c.alternative) prev.alternative = false; // upgraded to a direct hit
      }
      if (hasDirect(candidates)) break;
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
    candidateCount: pick.ranked.length,
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

// Tab state: absent = OFF, { mode: 'page' } = ON for this page only (activeTab),
// { mode: 'keep', origin } = KEEP ON: survives reloads and same-tab navigations within the
// same site, backed by a host permission for that origin that is granted on the click and
// removed again when the user turns it off.
const BADGE = {
  off: { text: '', color: '#2e7d32', title: 'Thomann prices: click to enable on this page', icon: 'icons/off.svg' },
  page: { text: 'ON', color: '#2e7d32', title: 'Thomann prices: ON for this page (click again to keep it on across pages, twice to turn off)', icon: 'icons/on.svg' },
  keep: { text: 'KEEP', color: '#1565c0', title: 'Thomann prices: KEPT ON for this site in this tab (click to turn off)', icon: 'icons/on.svg' }
};

async function setBadge(tabId, mode) {
  const b = BADGE[mode] || BADGE.off;
  await browser.action.setBadgeText({ tabId, text: b.text });
  await browser.action.setBadgeBackgroundColor({ tabId, color: b.color });
  await browser.action.setTitle({ tabId, title: b.title });
  try { await browser.action.setIcon({ tabId, path: b.icon }); } catch (e) { /* ignore */ }
}

function originPatternFor(url) {
  try { const u = new URL(url); return u.protocol + '//' + u.host + '/*'; } catch (e) { return null; }
}

async function inject(tabId) {
  await browser.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
  await browser.tabs.sendMessage(tabId, { type: 'enable' }).catch(() => {});
}

async function enableOnTab(tabId) {
  const settings = await getSettings();
  // Firefox treats MV3 host_permissions as optional; ask on first use (user gesture context).
  if (!(await hasHostPermission(settings.domain))) {
    try { await browser.permissions.request({ origins: [originFor(settings.domain)] }); } catch (e) { /* ignore */ }
  }
  await inject(tabId);
  enabledTabs.set(tabId, { mode: 'page' });
  await setBadge(tabId, 'page');
}

async function keepOnTab(tabId, url) {
  const origin = originPatternFor(url);
  if (!origin) return false;
  let granted = false;
  try { granted = await browser.permissions.request({ origins: [origin] }); } catch (e) { granted = false; }
  if (!granted) return false;
  enabledTabs.set(tabId, { mode: 'keep', origin });
  await setBadge(tabId, 'keep');
  return true;
}

async function disableOnTab(tabId) {
  const state = enabledTabs.get(tabId);
  enabledTabs.delete(tabId);
  await browser.tabs.sendMessage(tabId, { type: 'disable' }).catch(() => {});
  await setBadge(tabId, 'off');
  if (state && state.mode === 'keep' && state.origin) {
    // Give the site-wide access back unless another tab still keeps the same origin.
    const stillUsed = [...enabledTabs.values()].some((s) => s.mode === 'keep' && s.origin === state.origin);
    if (!stillUsed) { try { await browser.permissions.remove({ origins: [state.origin] }); } catch (e) { /* ignore */ } }
  }
}

browser.action.onClicked.addListener((tab) => {
  if (!tab || tab.id == null) return;
  if (!/^https?:/.test(tab.url || '')) return;
  const state = enabledTabs.get(tab.id);
  // No await before permissions.request: it must run inside the click's user-gesture context.
  let p;
  if (!state) p = enableOnTab(tab.id);
  else if (state.mode === 'page') p = keepOnTab(tab.id, tab.url).then((ok) => { if (!ok) return disableOnTab(tab.id); });
  else p = disableOnTab(tab.id);
  p.catch((e) => console.error('[thomann-companion] toggle failed', e));
});

browser.tabs.onRemoved.addListener((tabId) => enabledTabs.delete(tabId));

// A real navigation (not pushState): page mode ends; keep mode re-injects when the origin still
// matches, and ends when the tab leaves the site.
browser.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  const state = enabledTabs.get(details.tabId);
  if (!state) return;
  if (state.mode === 'keep' && originPatternFor(details.url) === state.origin) return;
  enabledTabs.delete(details.tabId);
  setBadge(details.tabId, 'off').catch(() => {});
  if (state.mode === 'keep' && state.origin) {
    const stillUsed = [...enabledTabs.values()].some((s) => s.mode === 'keep' && s.origin === state.origin);
    if (!stillUsed) browser.permissions.remove({ origins: [state.origin] }).catch(() => {});
  }
});

browser.webNavigation.onDOMContentLoaded.addListener(async (details) => {
  if (details.frameId !== 0) return;
  const state = enabledTabs.get(details.tabId);
  if (!state || state.mode !== 'keep') return;
  try {
    await inject(details.tabId);
    await setBadge(details.tabId, 'keep');
  } catch (e) {
    console.warn('[thomann-companion] re-inject failed', e);
    enabledTabs.delete(details.tabId);
    setBadge(details.tabId, 'off').catch(() => {});
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
    case 'isEnabled': {
      const st = sender && sender.tab ? enabledTabs.get(sender.tab.id) : null;
      return Promise.resolve({ enabled: !!st, mode: st ? st.mode : 'off' });
    }
    case 'openTab':
      return browser.tabs.create({ url: msg.url, active: msg.active !== false }).then(() => ({ ok: true }));
    default:
      return undefined;
  }
});
