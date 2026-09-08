/* Orchestrator: scans the page with the matching adapter, asks the background for Thomann prices, renders badges. */
(function () {
  'use strict';

  if (globalThis.__thc) { globalThis.__thc.enable(); return; }

  const U = globalThis.__thcUtil;
  const badges = new Map(); // key -> { host, shadow, product, result }
  let enabled = false;
  let adapter = null;
  let mo = null, io = null, scanTimer = null;
  let lastUrl = location.href;

  const CSS = `
    :host { all: initial; display: inline-block; vertical-align: middle; margin-left: .5em; font: 600 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; position: relative; z-index: 2147483000; }
    .b { display: inline-flex; align-items: center; gap: .35em; padding: 2px 7px; border-radius: 999px; border: 1px solid #bbb; background: #fff; color: #222; text-decoration: none; white-space: nowrap; cursor: pointer; }
    .b:hover { border-color: #666; }
    .b.loading { color: #888; font-weight: 500; }
    .b.match { border-color: #2e7d32; color: #1b5e20; background: #f1f8f1; }
    .b.match.cheaper { background: #2e7d32; color: #fff; border-color: #2e7d32; }
    .b.uncertain { border-color: #ef6c00; color: #b45309; background: #fff7ed; }
    .b.none, .b.error, .b.noPermission { border-color: #bbb; color: #555; background: #fafafa; }
    .b.error { border-color: #d32f2f; color: #b71c1c; }
    .logo { font-weight: 800; letter-spacing: -.02em; color: #0aa; }
    .tag { font-size: 10px; padding: 0 4px; border-radius: 4px; background: #eee; color: #333; }
  `;

  // The hover panel lives in one overlay attached to <html> with position:fixed, so card
  // containers with overflow:hidden cannot clip it.
  const PANEL_CSS = `
    :host([hidden]) { display: none !important; }
    :host { all: initial; display: block; position: fixed; top: 0; left: 0; z-index: 2147483001; font: 400 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    .panel { box-sizing: border-box; min-width: 260px; max-width: min(420px, 95vw); max-height: 70vh; overflow: auto; padding: 8px; background: #fff; color: #222; border: 1px solid #ccc; border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.18); }
    .panel .q { color: #666; font-size: 11px; margin-bottom: 6px; word-break: break-word; }
    .panel .row { display: flex; align-items: center; gap: 6px; padding: 4px 2px; border-top: 1px solid #eee; }
    .panel .row a.n { flex: 1; color: #1a56db; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .panel .row .p { font-weight: 600; white-space: nowrap; }
    .panel .row .s { color: #999; font-size: 10px; }
    .panel button { font: inherit; font-size: 11px; padding: 1px 6px; border: 1px solid #bbb; border-radius: 4px; background: #f6f6f6; cursor: pointer; }
    .panel .foot { display: flex; justify-content: space-between; align-items: center; margin-top: 6px; color: #888; font-size: 10px; }
    .panel .foot a { color: #1a56db; text-decoration: none; }
  `;

  function fmtPrice(v, cur) {
    if (v == null) return '?';
    const n = Math.round(v * 100) / 100;
    const s = Number.isInteger(n) ? String(n) : n.toFixed(2);
    return s + ' ' + (cur || '');
  }

  function isCheaper(product, best, rate) {
    if (!product.priceValue || !best || best.price == null) return false;
    let site = product.priceValue;
    const sc = product.currency, tc = best.currency;
    if (sc && tc && sc !== tc) {
      if (!rate) return false;
      if (sc === 'EUR' && tc === 'CHF') site = site * rate;
      else if (sc === 'CHF' && tc === 'EUR') site = site / rate;
      else return false;
    }
    return best.price < site;
  }

  function createBadge(product) {
    const host = document.createElement('span');
    host.setAttribute('data-thc-host', '1');
    host.tabIndex = 0;
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);
    const entry = { host, shadow, product, result: null, requested: false };
    host.addEventListener('mouseenter', () => showPanel(entry));
    host.addEventListener('focusin', () => showPanel(entry));
    host.addEventListener('mouseleave', scheduleHidePanel);
    host.addEventListener('focusout', scheduleHidePanel);
    render(entry, { status: 'idle' });
    const m = product.mount;
    if (m && m.parentNode) {
      if (m.tagName === 'H1') m.appendChild(host); else m.insertAdjacentElement('afterend', host);
    } else return null;
    return entry;
  }

  function render(entry, r) {
    const { shadow, product } = entry;
    shadow.querySelectorAll('.b').forEach((n) => n.remove());
    const a = document.createElement('a');
    a.className = 'b ' + (r.status === 'idle' ? 'loading' : r.status);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    const label = (text, tags) => {
      const logo = document.createElement('span');
      logo.className = 'logo'; logo.textContent = 't';
      a.append(logo, document.createTextNode(text));
      for (const t of tags || []) { const el = document.createElement('span'); el.className = 'tag'; el.textContent = t; a.append(' ', el); }
    };

    if (r.status === 'idle' || r.status === 'loading') {
      label('…');
      a.href = r.searchUrl || '#';
      a.title = 'Looking up on Thomann…';
    } else if (r.status === 'match' || r.status === 'uncertain') {
      const b = r.best;
      const cheaper = r.status === 'match' && isCheaper(product, b, r.eurChfRate);
      if (cheaper) a.classList.add('cheaper');
      a.href = b.url;
      const tags = [];
      if (b.bstock) tags.push('B');
      if (!b.inStock) tags.push('⏳');
      label((r.status === 'uncertain' ? '≈ ' : '') + fmtPrice(b.price, b.currency) + (r.status === 'uncertain' ? '?' : ''), tags);
      a.title = b.name + (b.availabilityText ? ' · ' + b.availabilityText : '') + (r.fromCache ? ' · cached ' + new Date(r.ts).toLocaleString() : '') + (r.overridden ? ' · manual match' : '');
    } else if (r.status === 'noPermission') {
      a.href = r.searchUrl;
      label('grant access');
      a.title = 'Open the extension options and grant access to ' + r.domain;
    } else if (r.status === 'error') {
      a.href = r.searchUrl;
      label('error ↗');
      a.title = 'Lookup failed: ' + (r.error || 'unknown') + ' — click to search on Thomann';
    } else {
      a.href = r.searchUrl || '#';
      label('no match ↗');
      a.title = 'No confident match — click to search on Thomann';
    }
    a.addEventListener('click', (e) => e.stopPropagation());
    shadow.appendChild(a);

    if (overlay.entry === entry) showPanel(entry);
  }

  // ---------- hover panel overlay ----------
  const overlay = { host: null, shadow: null, entry: null, hideTimer: null };

  function ensureOverlay() {
    if (overlay.host && overlay.host.isConnected) return;
    const host = document.createElement('span');
    host.setAttribute('data-thc-host', 'panel');
    host.hidden = true;
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    shadow.appendChild(style);
    host.addEventListener('mouseenter', () => clearTimeout(overlay.hideTimer));
    host.addEventListener('mouseleave', scheduleHidePanel);
    document.documentElement.appendChild(host);
    overlay.host = host; overlay.shadow = shadow;
  }

  function showPanel(entry) {
    clearTimeout(overlay.hideTimer);
    const r = entry.result;
    if (!r || r.status === 'loading') return;
    ensureOverlay();
    overlay.entry = entry;
    overlay.shadow.querySelectorAll('.panel').forEach((n) => n.remove());
    overlay.shadow.appendChild(buildPanel(entry, r));
    overlay.host.hidden = false;
    positionPanel();
  }

  function positionPanel() {
    if (!overlay.entry || overlay.host.hidden) return;
    const rect = overlay.entry.host.getBoundingClientRect();
    const panel = overlay.shadow.querySelector('.panel');
    const pw = panel ? panel.offsetWidth : 300, ph = panel ? panel.offsetHeight : 200;
    let left = rect.left, top = rect.bottom + 4;
    if (left + pw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - pw - 8);
    if (top + ph > window.innerHeight - 8 && rect.top - ph - 4 > 0) top = rect.top - ph - 4;
    overlay.host.style.transform = 'translate(' + Math.round(left) + 'px,' + Math.round(top) + 'px)';
  }

  function hidePanel() {
    if (overlay.host) overlay.host.hidden = true;
    overlay.entry = null;
  }

  function scheduleHidePanel() {
    clearTimeout(overlay.hideTimer);
    overlay.hideTimer = setTimeout(hidePanel, 700);
  }

  function buildPanel(entry, r) {
    const p = document.createElement('div');
    p.className = 'panel';
    const q = document.createElement('div');
    q.className = 'q';
    q.textContent = 'Query: ' + (r.query || entry.product.title);
    p.appendChild(q);
    for (const c of (r.ranked || []).slice(0, 5)) {
      const row = document.createElement('div');
      row.className = 'row';
      const n = document.createElement('a');
      n.className = 'n'; n.href = c.url; n.target = '_blank'; n.rel = 'noopener noreferrer';
      n.textContent = c.name + (c.bstock ? ' (B-stock)' : '');
      n.title = c.name;
      const price = document.createElement('span');
      price.className = 'p'; price.textContent = fmtPrice(c.price, c.currency);
      const s = document.createElement('span');
      s.className = 's'; s.textContent = (c.score != null ? c.score.toFixed(2) : '');
      row.append(n, price, s);
      if (!r.best || c.id !== r.best.id) {
        const btn = document.createElement('button');
        btn.textContent = 'use';
        btn.title = 'Remember this as the correct match for this query';
        btn.addEventListener('click', async (e) => {
          e.preventDefault(); e.stopPropagation();
          await browser.runtime.sendMessage({ type: 'override', query: r.query, articleId: c.id });
          lookup(entry, { force: false });
        });
        row.appendChild(btn);
      }
      p.appendChild(row);
    }
    const foot = document.createElement('div');
    foot.className = 'foot';
    const left = document.createElement('span');
    left.textContent = r.fromCache ? 'cached ' + new Date(r.ts).toLocaleString() : 'live';
    const right = document.createElement('span');
    const refresh = document.createElement('button');
    refresh.textContent = 'refresh';
    refresh.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); lookup(entry, { force: true }); });
    const search = document.createElement('a');
    search.href = r.searchUrl; search.target = '_blank'; search.rel = 'noopener noreferrer'; search.textContent = ' search ↗';
    right.append(refresh, search);
    if (r.overridden) {
      const clear = document.createElement('button');
      clear.textContent = 'forget';
      clear.title = 'Remove the manual match';
      clear.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        await browser.runtime.sendMessage({ type: 'override', query: r.query, articleId: null });
        lookup(entry, { force: false });
      });
      right.prepend(clear);
    }
    foot.append(left, right);
    p.appendChild(foot);
    return p;
  }

  async function lookup(entry, opts) {
    opts = opts || {};
    entry.requested = true;
    render(entry, { status: 'loading' });
    let r;
    try {
      r = await browser.runtime.sendMessage({ type: 'lookup', title: entry.product.title, key: entry.product.key, force: !!opts.force, priority: opts.priority || 0 });
    } catch (e) {
      r = { status: 'error', error: String(e && e.message || e) };
    }
    if (!r) r = { status: 'error', error: 'no response' };
    entry.result = r;
    if (entry.host.isConnected) render(entry, r);
  }

  function scan() {
    if (!enabled || !adapter) return;
    let products;
    try { products = adapter.findProducts(document); } catch (e) { console.warn('[thomann-companion] adapter failed', e); return; }
    for (const p of products) {
      if (!p || !p.title) continue;
      const existing = badges.get(p.key);
      if (existing) {
        if (existing.host.isConnected) continue;
        // The site re-rendered the card: move the badge to the new mount, keep the result.
        badges.delete(p.key);
        if (io) io.unobserve(existing.host);
      }
      const entry = createBadge(p);
      if (!entry) continue;
      badges.set(p.key, entry);
      if (existing && existing.result) { entry.result = existing.result; entry.requested = true; render(entry, existing.result); }
      else if (io) io.observe(entry.host); else lookup(entry);
    }
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 300);
  }

  function enable() {
    if (enabled) { scheduleScan(); return; }
    enabled = true;
    adapter = (globalThis.__thcAdapters || []).find((a) => { try { return a.matches(location); } catch (e) { return false; } }) || null;
    if (!adapter) { console.warn('[thomann-companion] no adapter'); return; }
    io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const entry = [...badges.values()].find((b) => b.host === e.target);
        if (entry && !entry.requested) lookup(entry, { priority: 1 });
        io.unobserve(e.target);
      }
    }, { rootMargin: '300px 0px' }) : null;
    scan();
    mo = new MutationObserver((muts) => {
      if (muts.some((m) => m.addedNodes.length && ![...m.addedNodes].every((n) => n.nodeType !== 1 || n.hasAttribute('data-thc-host')))) scheduleScan();
      if (location.href !== lastUrl) { lastUrl = location.href; scheduleScan(); }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('popstate', scheduleScan);
    window.addEventListener('scroll', hidePanel, { passive: true });
    window.addEventListener('resize', positionPanel);
    console.info('[thomann-companion] enabled with adapter', adapter.name);
  }

  function disable() {
    enabled = false;
    clearTimeout(scanTimer);
    if (mo) mo.disconnect(); mo = null;
    if (io) io.disconnect(); io = null;
    window.removeEventListener('popstate', scheduleScan);
    window.removeEventListener('scroll', hidePanel);
    window.removeEventListener('resize', positionPanel);
    hidePanel();
    if (overlay.host) overlay.host.remove(); overlay.host = null; overlay.shadow = null;
    for (const b of badges.values()) b.host.remove();
    badges.clear();
    console.info('[thomann-companion] disabled');
  }

  browser.runtime.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.type === 'enable') { enable(); return Promise.resolve({ ok: true, adapter: adapter && adapter.name }); }
    if (msg.type === 'disable') { disable(); return Promise.resolve({ ok: true }); }
    if (msg.type === 'ping') return Promise.resolve({ enabled, adapter: adapter && adapter.name, badges: badges.size });
  });

  globalThis.__thc = { enable, disable, scan, badges };
  enable();
})();
