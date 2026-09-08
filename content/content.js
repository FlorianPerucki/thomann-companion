/* Orchestrator: scans the page with the matching adapter, asks the background for prices on each
 * of the adapter's sources (Thomann, or the second-hand marketplaces on Thomann pages), renders
 * one pill per source plus a shared hover panel. */
(function () {
  'use strict';

  if (globalThis.__thc) { globalThis.__thc.enable(); return; }

  const badges = new Map(); // key -> entry { host, shadow, product, pills: { [source]: { a, result, requested } } }
  let enabled = false;
  let adapter = null;
  let sources = ['thomann'];
  let mo = null, io = null, scanTimer = null;
  let lastUrl = location.href;

  const CSS = `
    :host { all: initial; display: inline-flex; gap: 4px; vertical-align: middle; margin-left: .5em; font: 600 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; position: relative; z-index: 2147483000; }
    .b { display: inline-flex; align-items: center; gap: .35em; padding: 2px 7px; border-radius: 999px; border: 1px solid #bbb; background: #fff; color: #222; text-decoration: none; white-space: nowrap; cursor: pointer; }
    .b:hover { border-color: #666; }
    .b.loading { color: #888; font-weight: 500; }
    .b.match, .b.matches { border-color: #2e7d32; color: #1b5e20; background: #f1f8f1; }
    .b.cheaper { background: #2e7d32; color: #fff; border-color: #2e7d32; }
    .b.cheaper .logo { color: #bff; }
    .b.uncertain { border-color: #ef6c00; color: #b45309; background: #fff7ed; }
    .b.none, .b.error, .b.noPermission { border-color: #bbb; color: #555; background: #fafafa; }
    .b.skipped { border-color: #ddd; color: #999; background: transparent; font-weight: 500; }
    .b.error { border-color: #d32f2f; color: #b71c1c; }
    .b.alt { border-style: dashed; }
    .b.none.has { border-style: dashed; color: #333; border-color: #888; }
    .b.empty { opacity: .45; }
    .b.link { color: #444; }
    .b.mg { border-color: #6a1b9a; color: #4a148c; background: #f8f1fb; }
    .logo { font-weight: 800; letter-spacing: -.02em; color: #0aa; }
    .logo.leboncoin { color: #ec5a13; }
    .logo.ricardo { color: #1d4ed8; }
    .logo.anibis { color: #d42a2a; }
    .tag { font-size: 10px; padding: 0 4px; border-radius: 4px; background: #eee; color: #333; }
  `;

  // The hover panel lives in one overlay attached to <html> with position:fixed, so card
  // containers with overflow:hidden cannot clip it.
  const PANEL_CSS = `
    :host([hidden]) { display: none !important; }
    :host { all: initial; display: block; position: fixed; top: 0; left: 0; z-index: 2147483001; font: 400 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    .panel { box-sizing: border-box; min-width: 280px; max-width: min(460px, 95vw); max-height: 70vh; overflow: auto; padding: 8px; background: #fff; color: #222; border: 1px solid #ccc; border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.18); }
    .panel .q { color: #666; font-size: 11px; margin-bottom: 6px; word-break: break-word; }
    .panel h4 { margin: 8px 0 2px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #555; }
    .panel h4:first-child { margin-top: 0; }
    .panel .row { display: flex; align-items: center; gap: 6px; padding: 4px 2px; border-top: 1px solid #eee; }
    .panel .row a.n { flex: 1; color: #1a56db; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .panel .row .p { font-weight: 600; white-space: nowrap; }
    .panel .row .s { color: #999; font-size: 10px; white-space: nowrap; }
    .panel .row .s + .p { flex: 1; text-align: right; font-weight: 500; }
    .panel .empty { color: #888; font-size: 11px; padding: 2px; }
    .panel button { font: inherit; font-size: 11px; padding: 1px 6px; border: 1px solid #bbb; border-radius: 4px; background: #f6f6f6; cursor: pointer; }
    .panel .foot { display: flex; justify-content: space-between; align-items: center; margin-top: 6px; color: #888; font-size: 10px; gap: 8px; }
    .panel .foot a { color: #1a56db; text-decoration: none; }
    .preview { position: absolute; right: calc(100% + 6px); top: 0; width: 180px; min-height: 60px; padding: 4px; background: #fff; border: 1px solid #ccc; border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.18); }
    .preview img { display: block; max-width: 172px; max-height: 172px; margin: 0 auto; }
    .preview .cap { font-size: 10px; color: #666; margin-top: 4px; text-align: center; word-break: break-word; }
  `;

  const LOGO = { thomann: 't', leboncoin: 'lbc', ricardo: 'ric', anibis: 'ani', youtube: 'yt', modulargrid: 'mg' };
  const SOURCE_NAME = { thomann: 'Thomann', leboncoin: 'leboncoin', ricardo: 'ricardo.ch', anibis: 'anibis.ch', youtube: 'YouTube', modulargrid: 'ModularGrid' };
  const MARKET = { leboncoin: true, ricardo: true, anibis: true };
  const EXTRA = { youtube: true, modulargrid: true }; // link pills, shown next to the product name

  function fmtPrice(v, cur) {
    if (v == null) return '?';
    const n = Math.round(v * 100) / 100;
    const s = Number.isInteger(n) ? String(n) : n.toFixed(2);
    return s + ' ' + (cur || '');
  }

  function fmtAge(date) {
    if (!date) return '';
    const t = typeof date === 'number' ? (date < 1e12 ? date * 1000 : date) : Date.parse(String(date).replace(' ', 'T'));
    if (!isFinite(t)) return '';
    const d = Math.round((Date.now() - t) / 86400000);
    if (d <= 0) return 'today';
    if (d < 30) return d + ' d';
    if (d < 365) return Math.round(d / 30) + ' mo';
    return Math.round(d / 365) + ' y';
  }

  function convert(value, from, to, rate) {
    if (from === to || !from || !to) return value;
    if (!rate) return null;
    if (from === 'EUR' && to === 'CHF') return value * rate;
    if (from === 'CHF' && to === 'EUR') return value / rate;
    return null;
  }

  function isCheaper(product, price, currency, rate) {
    if (!product.priceValue || price == null) return false;
    const site = convert(product.priceValue, product.currency, currency, rate);
    return site != null && price < site;
  }

  // ---------- badge ----------
  function makeHost() {
    const host = document.createElement('span');
    host.setAttribute('data-thc-host', '1');
    host.tabIndex = 0;
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);
    return { host, shadow };
  }

  function createBadge(product) {
    const main = makeHost();
    const entry = { host: main.host, shadow: main.shadow, host2: null, product, pills: {} };
    // Link pills (YouTube, ModularGrid) go next to the product name when the adapter found it.
    const extraTarget = product.titleEl && product.titleEl.isConnected ? makeHost() : null;
    if (extraTarget) entry.host2 = extraTarget.host;
    for (const src of sources) {
      const a = document.createElement('a');
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.addEventListener('click', (e) => e.stopPropagation());
      // One panel per pill: hovering the lbc pill shows only leboncoin results, etc.
      a.addEventListener('mouseenter', () => showPanel(entry, src));
      a.addEventListener('focus', () => showPanel(entry, src));
      a.addEventListener('mouseleave', scheduleHidePanel);
      a.addEventListener('blur', scheduleHidePanel);
      (EXTRA[src] && extraTarget ? extraTarget.shadow : main.shadow).appendChild(a);
      entry.pills[src] = { a, result: null, requested: false };
      renderPill(entry, src, { status: 'idle' });
    }
    const m = product.mount;
    if (m && m.parentNode) {
      if (product.mountMode === 'below-right') {
        main.host.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px;margin:6px 0 0;';
        m.insertAdjacentElement('afterend', main.host);
      } else if (m.tagName === 'H1') m.appendChild(main.host);
      else m.insertAdjacentElement('afterend', main.host);
    } else return null;
    if (extraTarget) product.titleEl.appendChild(extraTarget.host);
    return entry;
  }

  function renderPill(entry, src, r) {
    const { product } = entry;
    const pill = entry.pills[src];
    const a = pill.a;
    a.textContent = '';
    a.className = 'b ' + (r.status === 'idle' ? 'loading' : r.status);
    const label = (text, tags) => {
      const logo = document.createElement('span');
      logo.className = 'logo ' + src; logo.textContent = LOGO[src] || src;
      a.append(logo, document.createTextNode(text));
      for (const t of tags || []) { const el = document.createElement('span'); el.className = 'tag'; el.textContent = t; a.append(' ', el); }
    };

    if (r.status === 'idle' || r.status === 'loading') {
      label('…');
      a.href = r.searchUrl || '#';
    } else if (r.status === 'match' || r.status === 'uncertain') {
      const b = r.best;
      if (r.status === 'match' && isCheaper(product, b.price, b.currency, r.eurChfRate)) a.classList.add('cheaper');
      a.href = b.url;
      const tags = [];
      if (b.bstock) tags.push('B');
      if (!b.inStock) tags.push('⏳');
      if (b.alternative) { tags.push('similar'); a.classList.add('alt'); }
      label((r.status === 'uncertain' ? '≈ ' : '') + fmtPrice(b.price, b.currency) + (r.status === 'uncertain' ? '?' : ''), tags);
    } else if (r.status === 'matches') {
      const b = r.best;
      if (isCheaper(product, b.price, b.currency, r.eurChfRate)) a.classList.add('cheaper');
      a.href = b.url;
      label(r.count + ' · from ' + fmtPrice(b.price, b.currency));
    } else if (r.status === 'link') {
      a.href = r.url;
      label('↗');
    } else if (r.status === 'mg') {
      a.href = r.url;
      label('↗');
    } else if (r.status === 'skipped') {
      a.href = r.searchUrl || '#';
      label('skipped');
    } else if (r.status === 'noPermission') {
      a.href = r.searchUrl || '#';
      label('grant access');
    } else if (r.status === 'error') {
      a.href = r.searchUrl || '#';
      label('error ↗');
    } else {
      a.href = r.searchUrl || '#';
      const n = r.candidateCount || 0;
      if (n > 0) { a.classList.add('has'); label('no match ↗', [n + ' similar']); }
      else if (EXTRA[src]) { a.classList.add('empty'); label('↗'); }
      else if (src !== 'thomann') { a.classList.add('empty'); label('0'); }
      else label('no match ↗');
    }
    updateMark(entry);
    if (overlay.entry === entry && overlay.src === src) showPanel(entry, src);
  }

  // A dot in front of the product name when at least one marketplace has a listing.
  function updateMark(entry) {
    const has = Object.keys(entry.pills).some((s) => MARKET[s] && entry.pills[s].result && entry.pills[s].result.status === 'matches');
    const t = entry.product.titleEl;
    if (!t || !t.isConnected) return;
    if (has && !entry.mark) {
      const m = document.createElement('span');
      m.setAttribute('data-thc-host', 'mark');
      m.style.cssText = 'display:inline-block;width:.55em;height:.55em;border-radius:50%;background:#2e7d32;margin-right:.4em;vertical-align:middle;box-shadow:0 0 0 2px #c8e6c9;';
      t.insertBefore(m, t.firstChild);
      entry.mark = m;
    } else if (!has && entry.mark) {
      entry.mark.remove();
      entry.mark = null;
    }
  }

  // ---------- hover panel overlay ----------
  const overlay = { host: null, shadow: null, entry: null, src: null, hideTimer: null };

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

  function showPanel(entry, src) {
    clearTimeout(overlay.hideTimer);
    const r = entry.pills[src] && entry.pills[src].result;
    if (!r || r.status === 'loading' || r.status === 'skipped' || r.status === 'link') return;
    if (r.status === 'mg' && r.count === 1 && !(r.specs && r.specs.length)) return;
    ensureOverlay();
    overlay.entry = entry;
    overlay.src = src;
    overlay.shadow.querySelectorAll('.panel, .preview').forEach((n) => n.remove());
    overlay.shadow.appendChild(buildPanel(entry, [src]));
    overlay.host.hidden = false;
    positionPanel();
  }

  function positionPanel() {
    if (!overlay.entry || overlay.host.hidden) return;
    const pill = overlay.entry.pills[overlay.src];
    const rect = (pill ? pill.a : overlay.entry.host).getBoundingClientRect();
    const panel = overlay.shadow.querySelector('.panel');
    const pw = panel ? panel.offsetWidth : 300, ph = panel ? panel.offsetHeight : 200;
    let left = rect.left, top = rect.bottom + 4;
    if (left + pw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - pw - 8);
    if (top + ph > window.innerHeight - 8 && rect.top - ph - 4 > 0) top = rect.top - ph - 4;
    overlay.host.style.transform = 'translate(' + Math.round(left) + 'px,' + Math.round(top) + 'px)';
  }

  function hidePanel() {
    clearTimeout(overlay.previewTimer);
    if (overlay.host) overlay.host.hidden = true;
    overlay.entry = null;
    overlay.src = null;
  }

  function scheduleHidePanel() {
    clearTimeout(overlay.hideTimer);
    overlay.hideTimer = setTimeout(hidePanel, 700);
  }

  // Image preview of a result, shown to the left of the panel after hovering a row for 300 ms.
  function attachPreview(row, image, caption) {
    if (!image) return;
    row.addEventListener('mouseenter', () => {
      clearTimeout(overlay.previewTimer);
      overlay.previewTimer = setTimeout(() => showPreview(image, caption), 300);
    });
    row.addEventListener('mouseleave', () => { clearTimeout(overlay.previewTimer); });
  }

  function showPreview(image, caption) {
    if (!overlay.shadow || overlay.host.hidden) return;
    overlay.shadow.querySelectorAll('.preview').forEach((n) => n.remove());
    const box = el('div', 'preview');
    const img = document.createElement('img');
    img.alt = caption || '';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', async () => {
      // Page CSP or hotlink protection: let the background fetch it and hand back a data: URL.
      if (img.dataset.fallback) { box.remove(); return; }
      img.dataset.fallback = '1';
      try {
        const r = await browser.runtime.sendMessage({ type: 'fetchImage', url: image });
        if (r && r.dataUrl) img.src = r.dataUrl; else box.remove();
      } catch (e) { box.remove(); }
    });
    img.src = image;
    box.appendChild(img);
    if (caption) box.appendChild(el('div', 'cap', caption));
    // Left of the panel by default; on the right when the panel sits near the left edge.
    const rect = overlay.host.getBoundingClientRect();
    if (rect.left < 200) { box.style.right = 'auto'; box.style.left = 'calc(100% + 6px)'; }
    overlay.shadow.appendChild(box);
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function buildPanel(entry, ready) {
    const p = el('div', 'panel');
    const first = entry.pills[ready[0]].result;
    p.appendChild(el('div', 'q', 'Query: ' + (first.query || entry.product.title)));
    for (const src of ready) {
      const r = entry.pills[src].result;
      if (src !== 'thomann') p.appendChild(el('h4', null, SOURCE_NAME[src] || src));
      if (src === 'thomann') thomannSection(p, entry, r);
      else if (src === 'modulargrid') mgSection(p, entry, r);
      else marketSection(p, entry, src, r);
    }
    return p;
  }

  function thomannSection(p, entry, r) {
    for (const c of (r.ranked || []).slice(0, 5)) {
      const row = el('div', 'row');
      const n = el('a', 'n', c.name + (c.bstock ? ' (B-stock)' : '') + (c.alternative ? ' ~' : ''));
      n.href = c.url; n.target = '_blank'; n.rel = 'noopener noreferrer';
      if (!c.image) n.title = c.name + (c.alternative ? ' — from "similar searches"' : ''); // native tooltip only when no photo preview
      row.append(n, el('span', 'p', fmtPrice(c.price, c.currency)), el('span', 's', c.score != null ? c.score.toFixed(2) : ''));
      attachPreview(row, c.image, c.name);
      if (!r.best || c.id !== r.best.id) {
        const btn = el('button', null, 'use');
        btn.title = 'Remember this as the correct match for this query';
        btn.addEventListener('click', async (e) => {
          e.preventDefault(); e.stopPropagation();
          await browser.runtime.sendMessage({ type: 'override', query: r.query, articleId: c.id });
          lookup(entry, 'thomann', { force: false });
        });
        row.appendChild(btn);
      }
      p.appendChild(row);
    }
    if (!(r.ranked || []).length) p.appendChild(el('div', 'empty', r.status === 'error' ? 'Error: ' + (r.error || '') : 'No candidates.'));
    p.appendChild(footer(entry, 'thomann', r, r.overridden ? async () => {
      await browser.runtime.sendMessage({ type: 'override', query: r.query, articleId: null });
      lookup(entry, 'thomann', { force: false });
    } : null));
  }

  function marketSection(p, entry, src, r) {
    for (const l of r.matches || []) {
      const row = el('div', 'row');
      const n = el('a', 'n', l.title);
      n.href = l.url; n.target = '_blank'; n.rel = 'noopener noreferrer';
      if (!l.image) n.title = l.title + (l.body ? '\n' + l.body.slice(0, 300) : ''); // native tooltip only when no photo preview
      const meta = [l.place, fmtAge(l.date)].filter(Boolean).join(' · ');
      row.append(n, el('span', 'p', fmtPrice(l.price, l.currency)), el('span', 's', meta));
      attachPreview(row, l.image, l.title);
      const hide = el('button', null, 'hide');
      hide.title = 'Not this product — hide this listing';
      hide.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        await browser.runtime.sendMessage({ type: 'hideListing', source: src, id: l.id, hidden: true });
        lookup(entry, src, { force: false });
      });
      row.appendChild(hide);
      p.appendChild(row);
    }
    if (!(r.matches || []).length) {
      p.appendChild(el('div', 'empty', r.status === 'error' ? 'Error: ' + (r.error || '') : r.status === 'noPermission' ? 'No access granted for this site (see options).' : 'No matching listing' + (r.scanned ? ' among ' + r.scanned + ' results' : '') + '.'));
    }
    p.appendChild(footer(entry, src, r, null));
  }

  function mgSection(p, entry, r) {
    if (r.count === 1 && r.specs && r.specs.length) {
      // Single module: the spec box from its ModularGrid page.
      const m = r.modules[0];
      const head = el('div', 'row');
      const n = el('a', 'n', m.name);
      n.href = m.url; n.target = '_blank'; n.rel = 'noopener noreferrer';
      head.append(n);
      attachPreview(head, m.image, m.name);
      p.appendChild(head);
      for (const sp of r.specs) {
        const row = el('div', 'row');
        row.append(el('span', 's', sp.label), el('span', 'p', sp.values.join(' · ')));
        p.appendChild(row);
      }
      p.appendChild(footer(entry, 'modulargrid', r, null));
      return;
    }
    for (const m of r.modules || []) {
      const row = el('div', 'row');
      const n = el('a', 'n', m.name);
      n.href = m.url; n.target = '_blank'; n.rel = 'noopener noreferrer';
      row.append(n);
      attachPreview(row, m.image, m.name);
      p.appendChild(row);
    }
    if (r.count > (r.modules || []).length) p.appendChild(el('div', 'empty', r.count + ' modules — see the search page.'));
    if (!(r.modules || []).length) p.appendChild(el('div', 'empty', r.status === 'error' ? 'Error: ' + (r.error || '') : r.status === 'noPermission' ? 'No access granted for modulargrid.com (see options).' : 'No module found.'));
    p.appendChild(footer(entry, 'modulargrid', r, null));
  }

  function footer(entry, src, r, onForget) {
    const foot = el('div', 'foot');
    const left = el('span', null, (r.fromCache ? 'cached ' + new Date(r.ts).toLocaleString() : 'live') + (r.searchQuery ? ' · "' + r.searchQuery + '"' : ''));
    const right = el('span');
    if (onForget) {
      const clear = el('button', null, 'forget');
      clear.title = 'Remove the manual match';
      clear.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onForget(); });
      right.append(clear, ' ');
    }
    const refresh = el('button', null, 'refresh');
    refresh.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); lookup(entry, src, { force: true }); });
    const search = el('a', null, ' search ↗');
    search.href = r.searchUrl || '#'; search.target = '_blank'; search.rel = 'noopener noreferrer';
    right.append(refresh, search);
    foot.append(left, right);
    return foot;
  }

  // ---------- lookups ----------
  async function lookup(entry, src, opts) {
    opts = opts || {};
    const pill = entry.pills[src];
    if (!pill) return;
    pill.requested = true;
    renderPill(entry, src, { status: 'loading' });
    let r;
    const msg = { type: 'lookup', source: src, title: entry.product.title, brand: entry.product.brand || '', key: entry.product.key, force: !!opts.force, priority: opts.priority || 0 };
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        r = await browser.runtime.sendMessage(msg);
        break;
      } catch (e) {
        const text = String(e && e.message || e);
        r = { status: 'error', error: text };
        // The background page was suspended or restarted mid-lookup: wake it up and retry.
        if (!/Receiving end does not exist|Could not establish connection|message manager disconnected/i.test(text)) break;
        await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
      }
    }
    if (!r) r = { status: 'error', error: 'no response' };
    pill.result = r;
    if (entry.host.isConnected) renderPill(entry, src, r);
  }

  function lookupAll(entry, opts) {
    for (const src of sources) if (!entry.pills[src].requested) lookup(entry, src, opts);
  }

  function scan() {
    if (!enabled || !adapter) return;
    let products;
    try { products = adapter.findProducts(document); } catch (e) { console.warn('[thomann-companion] adapter failed', e); return; }
    for (const p of products) {
      if (!p || !p.title) continue;
      const existing = badges.get(p.key);
      if (existing) {
        if (existing.host.isConnected && (!existing.host2 || existing.host2.isConnected)) {
          if (p.priceValue != null && existing.product.priceValue == null) { existing.product.priceValue = p.priceValue; existing.product.currency = p.currency; }
          continue;
        }
        // The site re-rendered the card: move the badge to the new mount, keep the results.
        badges.delete(p.key);
        if (existing.mark) existing.mark.remove();
        if (existing.host2) existing.host2.remove();
        if (io) io.unobserve(existing.host);
      }
      const entry = createBadge(p);
      if (!entry) continue;
      badges.set(p.key, entry);
      if (existing) {
        for (const src of sources) {
          const prev = existing.pills[src];
          if (prev && prev.result) { entry.pills[src].result = prev.result; entry.pills[src].requested = true; renderPill(entry, src, prev.result); }
        }
      }
      const pending = sources.some((s) => !entry.pills[s].requested);
      if (pending) { if (io) io.observe(entry.host); else lookupAll(entry); }
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
    const base = adapter.sources || ['thomann'];
    // Marketplace sources can be switched off in the options.
    browser.runtime.sendMessage({ type: 'getSettings' })
      .then((r) => {
        const st = (r && r.settings) || {};
        const on = st.sources || {};
        sources = base.filter((x) => x === 'thomann' || on[x] !== false);
        if (!sources.length) sources = base;
        if (st.modulargrid !== false) sources.push('modulargrid');
        if (st.youtube !== false) sources.push('youtube');
      })
      .catch(() => { sources = base; })
      .then(() => { if (enabled) start(); });
  }

  function start() {
    io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const entry = [...badges.values()].find((b) => b.host === e.target);
        if (entry) lookupAll(entry, { priority: 1 });
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
    console.info('[thomann-companion] enabled with adapter', adapter.name, 'sources', sources.join(','));
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
    for (const b of badges.values()) { b.host.remove(); if (b.host2) b.host2.remove(); if (b.mark) b.mark.remove(); }
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
