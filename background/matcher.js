/*
 * Query cleaning and candidate scoring. Pure functions, no browser APIs,
 * so this file is shared between the background script and the unit tests.
 */
(function (root) {
  'use strict';

  // Words that carry no product information in second-hand listing titles.
  const DEFAULT_STOP_WORDS = [
    // French
    'neuf', 'neuve', 'occasion', 'tbe', 'be', 'très', 'tres', 'bon', 'bonne', 'état', 'etat', 'comme',
    'vends', 'vend', 'vente', 'lot', 'avec', 'sans', 'garantie', 'boîte', 'boite', 'facture',
    'origine', 'complet', 'complète', 'rare', 'prix', 'urgent', 'pour', 'pièces', 'pieces',
    'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'en', 'à', 'a',
    // English
    'new', 'used', 'mint', 'condition', 'like', 'with', 'without', 'the', 'and', 'or', 'for',
    'box', 'boxed', 'original', 'rare', 'sale', 'selling', 'excellent',
    // German
    'neu', 'gebraucht', 'wie', 'mit', 'ohne', 'und', 'oder', 'für', 'fuer', 'top', 'zustand',
    'verkaufe', 'ovp', 'rechnung', 'garantie', 'der', 'die', 'das', 'im', 'inkl',
    // Domain noise
    'eurorack', 'euro', 'rack', 'module', 'modul', 'modules', 'modular', 'modulaire', 'synth',
    'synthé', 'synthe', 'synthesizer', 'synthétiseur', 'synthetiseur', 'analog', 'analogue',
    'analogique', 'hp', 'te', 'u', 'x', '+', '-', '&'
  ];

  // Qualifiers that make a Thomann candidate a *different* product unless the
  // query mentions them too.
  const QUALIFIERS = [
    'vintage', 'edition', 'se', 'b-stock', 'bstock', 'set', 'bundle', 'case', 'bag', 'stand',
    'cover', 'cable', 'kabel', 'câble', 'psu', 'netzteil', 'power', 'supply', 'kit', 'pack',
    'bracket', 'adapter', 'adaptor', 've', 'mk2', 'mkii', 'mk3', 'mkiii', 'v2', 'v3', 'ii', 'iii',
    'black', 'white', 'silver', 'red', 'blue'
  ];

  const MODEL_CODE = /^[a-z]{1,4}-\d{2,5}(?:-\d{1,3})?[a-z]?$/;

  /** "a-140-1" -> "a-140" (the "-1" suffix denotes the base model); anything else unchanged. */
  function baseCode(code) {
    return code.replace(/-1$/, '');
  }

  /**
   * Alternative queries worth trying, in order, when the query returns no direct hit:
   * Thomann ANDs every term, so "doepfer exponential vca a-131" finds nothing while
   * "doepfer a-131" does. 1) first token + model code(s), 2) the same with the base code.
   */
  function fallbackQueries(query) {
    const tokens = tokenize(normalizeModelCodes(query));
    const codes = tokens.filter((t) => MODEL_CODE.test(t));
    const out = [];
    const push = (q) => { if (q && q !== query && !out.includes(q)) out.push(q); };
    if (codes.length) {
      const brand = tokens.find((t) => !MODEL_CODE.test(t));
      const narrow = (brand ? [brand] : []).concat(codes).join(' ');
      push(narrow);
      for (const c of codes) if (baseCode(c) !== c) push(narrow.replace(c, baseCode(c)));
    }
    for (const t of codes) {
      if (baseCode(t) !== t) push(tokens.map((x) => (x === t ? baseCode(t) : x)).join(' '));
    }
    return out;
  }

  /** True when some candidate carries one of the query's model codes exactly (or its base form). */
  function hasCodeMatch(query, candidates) {
    const codes = tokenize(normalizeModelCodes(query)).filter((t) => MODEL_CODE.test(t));
    if (!codes.length) return true;
    return (candidates || []).some((c) => {
      const ct = candidateTokens(c);
      return codes.some((qc) => ct.has(qc) || ct.has(baseCode(qc)));
    });
  }

  // "A 110", "a110", "A-110-1", "a 110 1" -> "a-110", "a-110-1".
  function normalizeModelCodes(str) {
    return str
      .replace(/\b([a-z]{1,4})[\s\-_]?(\d{2,5})(?:[\s\-_](\d{1,3}))?(?=\b|[a-z]\b)/gi, (m, l, d, s) => {
        const tail = s ? '-' + s : '';
        return l.toLowerCase() + '-' + d + tail;
      });
  }

  function tokenize(str) {
    return String(str || '')
      .toLowerCase()
      .replace(/[()\[\]{}«»"“”'’`´,;:!?*#|]/g, ' ')
      .replace(/\.(?=\s|$)/g, ' ')
      .split(/\s+/)
      .map((t) => t.replace(/^[-_/.]+|[-_/.]+$/g, ''))
      .filter(Boolean);
  }

  function stripParentheses(str) {
    return String(str || '').replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, ' ');
  }

  /**
   * Turn a noisy listing title into a compact search query.
   * @param {string} title
   * @param {object} [opts]
   * @param {string[]} [opts.extraStopWords]
   * @param {number} [opts.maxTokens]
   * @returns {string}
   */
  function cleanQuery(title, opts) {
    opts = opts || {};
    const stop = new Set(DEFAULT_STOP_WORDS.concat(opts.extraStopWords || []).map((w) => w.toLowerCase()));
    const normalized = normalizeModelCodes(stripParentheses(title));
    const tokens = tokenize(normalized).filter((t) => !stop.has(t));
    // Model codes first so the search engine weighs them; keep original order otherwise.
    const codes = tokens.filter((t) => MODEL_CODE.test(t));
    const rest = tokens.filter((t) => !MODEL_CODE.test(t));
    const out = [];
    for (const t of rest.concat(codes)) if (!out.includes(t)) out.push(t);
    return out.slice(0, opts.maxTokens || 8).join(' ');
  }

  // Condition words are not part of the product identity.
  const CONDITION_TOKENS = new Set(['b-stock', 'bstock', 'b']);

  function candidateTokens(c) {
    return new Set(tokenize(normalizeModelCodes((c.manufacturer || '') + ' ' + (c.model || ''))).filter((t) => !CONDITION_TOKENS.has(t)));
  }

  /**
   * Score how well a Thomann candidate matches a cleaned query. Higher is better.
   * Roughly: 1.0 = the query names exactly this product.
   */
  function scoreCandidate(query, c) {
    const q = new Set(tokenize(normalizeModelCodes(query)));
    const ct = candidateTokens(c);
    if (!q.size || !ct.size) return 0;

    let inter = 0;
    for (const t of q) if (ct.has(t)) inter++;
    const union = new Set([...q, ...ct]).size;
    const jaccard = inter / union;
    const coverage = inter / q.size;

    let score = 0.5 * jaccard + 0.5 * coverage;

    const qCodes = [...q].filter((t) => MODEL_CODE.test(t));
    const cCodes = [...ct].filter((t) => MODEL_CODE.test(t));
    if (qCodes.length) {
      const exact = qCodes.some((t) => ct.has(t));
      if (exact) score += 0.45;
      else if (qCodes.some((qc) => cCodes.some((cc) => baseCode(qc) === cc || baseCode(cc) === qc))) {
        // "a-140-1" and "a-140" name the same module (Doepfer convention); the query token
        // itself didn't overlap, so compensate for the lost coverage too.
        score += 0.45;
      } else {
        // Other prefix relation ("a-110" vs "a-110-2") is worth something, a different code is not.
        const prefix = qCodes.some((qc) => cCodes.some((cc) => cc.startsWith(qc + '-') || qc.startsWith(cc + '-')));
        score += prefix ? 0.15 : -0.4;
      }
    }

    for (const t of ct) {
      if (QUALIFIERS.includes(t) && !q.has(t)) score -= 0.15;
    }
    if (c.inStock) score += 0.03;
    if (c.archived) score -= 0.5;
    if (c.alternative) score -= 0.02; // direct hits win ties against "similar search" results

    return Math.max(0, Math.round(score * 1000) / 1000);
  }

  /**
   * Rank candidates by *product identity*, then pick the cheapest offer of the best product.
   * B-stock articles inherit the identity (and score) of their new-condition sibling via
   * aStockId, so a cheaper B-stock of the right product wins over a full-price one, while a
   * B-stock of a different product cannot sneak in.
   * @returns {{status: 'match'|'uncertain'|'none', best: object|null, ranked: object[]}}
   */
  function pickBest(query, candidates, opts) {
    opts = opts || {};
    const matchMin = opts.matchMin ?? 0.6;
    const margin = opts.margin ?? 0.12;
    const uncertainMin = opts.uncertainMin ?? 0.3;

    const scored = (candidates || []).map((c) => Object.assign({}, c, { score: scoreCandidate(query, c) }));
    const byInternal = new Map(scored.filter((c) => c.internalId).map((c) => [c.internalId, c]));
    for (const c of scored) {
      const sibling = c.bstock && c.aStockId ? byInternal.get(c.aStockId) : null;
      c.productKey = sibling ? sibling.internalId : (c.internalId || c.id || c.name || ((c.manufacturer || '') + ' ' + (c.model || '')));
      if (sibling) c.score = sibling.score;
    }

    const groups = new Map();
    for (const c of scored) {
      if (!groups.has(c.productKey)) groups.set(c.productKey, { score: c.score, offers: [] });
      const g = groups.get(c.productKey);
      g.score = Math.max(g.score, c.score);
      g.offers.push(c);
    }
    const rankedGroups = [...groups.values()].sort((a, b) => b.score - a.score);
    for (const g of rankedGroups) g.offers.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    const ranked = rankedGroups.flatMap((g) => g.offers);

    if (!rankedGroups.length) return { status: 'none', best: null, ranked };
    const bestScore = rankedGroups[0].score;
    const second = rankedGroups[1] ? rankedGroups[1].score : 0;
    const best = rankedGroups[0].offers[0];
    if (bestScore >= matchMin && bestScore - second >= margin) return { status: 'match', best, ranked };
    if (bestScore >= uncertainMin) return { status: 'uncertain', best, ranked };
    return { status: 'none', best: null, ranked };
  }

  const api = { DEFAULT_STOP_WORDS, QUALIFIERS, normalizeModelCodes, tokenize, cleanQuery, scoreCandidate, pickBest, baseCode, fallbackQueries, hasCodeMatch };
  root.ThomannMatcher = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
