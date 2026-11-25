/* Tokenless Radar: the value model. The page and main.ts load this same file, so a number on the
   screen and a number in board.json come from one function. It reads only the snapshot's ten fields;
   no protocol name or slug appears below. Implied value is this board's claim, never a forecast. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RadarModel = factory();
})(this, function () {
  'use strict';

  // The house's watchlist rule, as far as the ten fields can test it (parentProtocol is not one).
  var OUT_CATEGORY = ['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX'];
  var VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
  var WRAPPED = /\b(wrapped|staked|staking)\b/i;
  var EXCHANGE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

  // Category families: few enough that each holds several priced comps.
  var FAMILIES = ['lend', 'trade', 'vault', 'stable', 'infra'];
  var FAMILY_NAME = { lend: 'Lending & CDP', trade: 'Trading venues', vault: 'Vaults & curators', stable: 'Yield dollars & RWA', infra: 'Infra & other' };
  var UNDATED_DAYS = 1826; // no listed_at: DefiLlama's undated records are its oldest (88% record a token, like the 4y+ cohort)
  var MIN_TRAIN = 30;      // walk-forward starts once 30 dated comps are listed
  var CANDIDATES = ['size', 'family', 'age', 'growth'];

  function familyOf(category) {
    var c = category || '';
    if (/Lending|CDP|Collateral/.test(c)) return 'lend';
    if (/Curator|Allocator|Yield|Farm|Options Vault|Indexes|Governance/.test(c)) return 'vault';
    if (/Dexs|Derivatives|Options|Prediction|OTC|NFT|Liquidity Manager|Launchpad/.test(c)) return 'trade';
    if (/RWA|Basis|Stable|CeDeFi|DOR|Reserve/.test(c)) return 'stable';
    return 'infra';
  }
  function recordsToken(p) { return p.gecko_id !== null || p.symbol !== null || (p.mcap_usd || 0) > 0; }
  function ruleOut(p) {
    if (p.category !== null && OUT_CATEGORY.indexOf(p.category) >= 0) return p.category;
    if (VERSIONED.test(p.name)) return 'versioned name';
    if (WRAPPED.test(p.name)) return 'wrapped/staked name';
    if (EXCHANGE.test(p.name)) return 'exchange name';
    return null;
  }
  function ageDays(asOf, listedAt) {
    if (!listedAt) return null;
    var d = Math.floor((Date.parse(asOf + 'T00:00:00Z') - Date.parse(listedAt + 'T00:00:00Z')) / 86400000);
    return isFinite(d) ? Math.max(0, d) : null;
  }
  function median(xs) {
    var s = xs.slice().sort(function (a, b) { return a - b; }), n = s.length;
    return n === 0 ? 0 : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }
  function quantile(xs, q) {
    var s = xs.slice().sort(function (a, b) { return a - b; }), i = (s.length - 1) * q, lo = Math.floor(i);
    return lo + 1 < s.length ? s[lo] + (s[lo + 1] - s[lo]) * (i - lo) : s[lo];
  }
  function dot(x, b) { var s = 0; for (var i = 0; i < x.length; i++) s += x[i] * b[i]; return s; }
  function bySlug(a, b) { return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0; }

  /** Every protocol in exactly one group of the ledger. */
  function ledgerGroup(p, watch, floor) {
    if (watch[p.slug]) return 'watchlist';
    if (recordsToken(p)) return (p.mcap_usd || 0) > 0 ? 'trades' : 'recorded';
    if (ruleOut(p) !== null) return 'out';
    return p.tvl_usd >= floor ? 'offlist' : 'early';
  }

  /** Weighted ridge least squares by the normal equations: min sum w(y - xb)^2 + sum lam b^2. */
  function solveRidge(X, y, w, lam) {
    var k = X[0].length, A = [], c = [], i, j, r;
    for (i = 0; i < k; i++) { A.push([]); c.push(0); for (j = 0; j < k; j++) A[i].push(i === j ? lam[i] : 0); }
    for (r = 0; r < X.length; r++) {
      for (i = 0; i < k; i++) {
        c[i] += w[r] * X[r][i] * y[r];
        for (j = 0; j < k; j++) A[i][j] += w[r] * X[r][i] * X[r][j];
      }
    }
    for (i = 0; i < k; i++) { // Gaussian elimination, partial pivoting
      var p = i;
      for (j = i + 1; j < k; j++) if (Math.abs(A[j][i]) > Math.abs(A[p][i])) p = j;
      var t = A[i]; A[i] = A[p]; A[p] = t; t = c[i]; c[i] = c[p]; c[p] = t;
      for (j = i + 1; j < k; j++) {
        var f = A[j][i] / A[i][i];
        for (r = i; r < k; r++) A[j][r] -= f * A[i][r];
        c[j] -= f * c[i];
      }
    }
    var b = new Array(k);
    for (i = k - 1; i >= 0; i--) { var s = c[i]; for (j = i + 1; j < k; j++) s -= A[i][j] * b[j]; b[i] = s / A[i][i]; }
    return b;
  }

  /** The design row: intercept, then each kept term. Family dummies are ridge-shrunk toward the pool. */
  function features(p, terms, ctx) {
    var x = [1];
    if (terms.size) x.push(Math.log10(p.tvl_usd) - 8);
    if (terms.family) FAMILIES.forEach(function (f) { x.push(familyOf(p.category) === f ? 1 : 0); });
    if (terms.age) x.push(Math.log2(Math.max(30, p.age === null ? UNDATED_DAYS : p.age) / 365));
    if (terms.growth) x.push(excessGrowth(p, ctx) / 100);
    return x;
  }
  function penalties(terms) {
    var lam = [0];
    if (terms.size) lam.push(0.01);
    if (terms.family) FAMILIES.forEach(function () { lam.push(4); });
    if (terms.age) lam.push(0.01);
    if (terms.growth) lam.push(0.01);
    return lam;
  }
  /** Seven-day TVL change against the snapshot's median change, clamped to +/-40 points. */
  function excessGrowth(p, ctx) {
    var g = p.change_7d === null ? ctx.market7d : p.change_7d;
    return Math.max(-40, Math.min(40, g - ctx.market7d));
  }
  function logMultiple(p) { return Math.log10(p.mcap_usd / p.tvl_usd); }

  /** fitMultiple: log10(mcap/TVL) of traded comps on the terms, Huber-weighted so one wild cap cannot steer it. */
  function fitMultiple(comps, terms, ctx) {
    var X = comps.map(function (p) { return features(p, terms, ctx); });
    var y = comps.map(logMultiple), w = y.map(function () { return 1; }), lam = penalties(terms), b;
    for (var it = 0; it < 8; it++) {
      b = solveRidge(X, y, w, lam);
      w = X.map(function (x, i) { var r = Math.abs(y[i] - dot(x, b)); return r <= 0.5 ? 1 : 0.5 / r; });
    }
    return { terms: terms, b: b };
  }
  function predictLog(fit, p, ctx) { return dot(features(p, fit.terms, ctx), fit.b); }

  /** Held-out residuals: leave-one-out, and walk-forward (fit only on comps listed earlier). */
  function looResiduals(comps, terms, ctx) {
    return comps.map(function (p, i) {
      var fit = fitMultiple(comps.filter(function (_, j) { return j !== i; }), terms, ctx);
      return logMultiple(p) - predictLog(fit, p, ctx);
    });
  }
  function walkResiduals(comps, terms, ctx) {
    var undated = comps.filter(function (p) { return p.age === null; });
    var dated = comps.filter(function (p) { return p.age !== null; }).sort(function (a, b) { return a.listed_at < b.listed_at ? -1 : a.listed_at > b.listed_at ? 1 : bySlug(a, b); });
    var out = [];
    for (var i = MIN_TRAIN; i < dated.length; i++) {
      var fit = fitMultiple(undated.concat(dated.slice(0, i)), terms, ctx);
      out.push(logMultiple(dated[i]) - predictLog(fit, dated[i], ctx));
    }
    return out;
  }
  function miss(res) { return Math.pow(10, median(res.map(Math.abs))); }

  /** selectTerms: add each candidate in turn; keep it only if it lowers BOTH held-out misses. */
  function selectTerms(comps, ctx) {
    var terms = {}, table = [];
    var best = { loo: miss(looResiduals(comps, terms, ctx)), walk: miss(walkResiduals(comps, terms, ctx)) };
    table.push({ term: 'flat', loo: best.loo, walk: best.walk, kept: true });
    CANDIDATES.forEach(function (t) {
      var trial = Object.assign({}, terms); trial[t] = true;
      var s = { loo: miss(looResiduals(comps, trial, ctx)), walk: miss(walkResiduals(comps, trial, ctx)) };
      var kept = s.loo < best.loo && s.walk < best.walk;
      table.push({ term: t, loo: s.loo, walk: s.walk, kept: kept });
      if (kept) { terms = trial; best = s; }
    });
    return { terms: terms, table: table, loo: best.loo, walk: best.walk };
  }

  /** Coverage check: how often a later comp's real cap lands inside the P25-P75 range set by earlier misses. */
  function rangeCoverage(walk) {
    var hit = 0, n = 0;
    for (var i = 12; i < walk.length; i++) {
      var prior = walk.slice(0, i), lo = quantile(prior, 0.25), hi = quantile(prior, 0.75);
      n++; if (walk[i] >= lo && walk[i] <= hi) hit++;
    }
    return { hit: hit, n: n };
  }

  // ---- launch odds: a life table read off the snapshot's own cross-section
  function oddsFeatures(p, days, terms) {
    var d = Math.min(days, terms.cap || Infinity);
    var x = [1, terms.shape === 'log' ? Math.log2(Math.max(30, d) / 365) : d / 365];
    if (terms.size) x.push(Math.log10(p.tvl_usd) - 8);
    if (terms.growth) x.push(excessGrowth(p, terms.ctx) / 100);
    if (terms.family) FAMILIES.forEach(function (f) { x.push(familyOf(p.category) === f ? 1 : 0); });
    return x;
  }
  function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }
  /** fitLaunchCurve: logistic P(records a token | age, ...) by iteratively reweighted least squares. */
  function fitLaunchCurve(pop, terms) {
    var X = pop.map(function (p) { return oddsFeatures(p, p.age, terms); });
    var y = pop.map(function (p) { return p.tok ? 1 : 0; });
    var lam = X[0].map(function (_, j) { return j === 0 ? 0 : 1; }), b = X[0].map(function () { return 0; });
    for (var it = 0; it < 25; it++) {
      var w = [], z = [];
      X.forEach(function (x, i) {
        var eta = dot(x, b), m = sigmoid(eta), v = Math.max(1e-6, m * (1 - m));
        w.push(v); z.push(eta + (y[i] - m) / v);
      });
      b = solveRidge(X, z, w, lam);
    }
    return { terms: terms, b: b };
  }
  /** Held-out log loss, 10 folds in slug order: the odds terms are kept only if they lower it. */
  function oddsLogLoss(pop, terms) {
    var loss = 0;
    for (var k = 0; k < 10; k++) {
      var train = pop.filter(function (_, i) { return i % 10 !== k; });
      var fit = terms === null ? null : fitLaunchCurve(train, terms);
      var base = train.filter(function (p) { return p.tok; }).length / train.length;
      pop.forEach(function (p, i) {
        if (i % 10 !== k) return;
        var q = fit === null ? base : sigmoid(dot(oddsFeatures(p, p.age, terms), fit.b));
        q = Math.min(1 - 1e-6, Math.max(1e-6, q));
        loss -= p.tok ? Math.log(q) : Math.log(1 - q);
      });
    }
    return loss / pop.length;
  }
  /** selectOdds: a life table needs a share that rises with age and may level off, so the age shapes
      tried are rising lines in days or log days, flat after a cap; held-out log loss picks one. */
  function selectOdds(pop, ctx) {
    var table = [{ term: 'base rate', loss: oddsLogLoss(pop, null), kept: false }], terms = null, best = Infinity;
    [['log', 0], ['linear', 0], ['linear', 1095], ['linear', 1460]].forEach(function (s) {
      var trial = { ctx: ctx, shape: s[0], cap: s[1] }, l = oddsLogLoss(pop, trial);
      table.push({ term: 'age (' + (s[0] === 'log' ? 'log days' : 'days') + (s[1] ? ', flat after ' + s[1] / 365 + ' y' : '') + ')', loss: l, kept: false });
      if (l < best) { best = l; terms = trial; table.forEach(function (t, i) { t.kept = i === table.length - 1; }); }
    });
    ['size', 'family', 'growth'].forEach(function (t) {
      var trial = Object.assign({}, terms); trial[t] = true;
      var l = oddsLogLoss(pop, trial), kept = l < best;
      table.push({ term: t, loss: l, kept: kept });
      if (kept) { terms = trial; best = l; }
    });
    return { terms: terms, table: table };
  }
  /** lifeTable: F(A), the share of peers of this age that record a token, now and a horizon later. */
  function lifeTable(curve, p, horizonDays) {
    var a = p.age === null ? UNDATED_DAYS : p.age;
    var F0 = sigmoid(dot(oddsFeatures(p, a, curve.terms), curve.b));
    var F1 = sigmoid(dot(oddsFeatures(p, a + horizonDays, curve.terms), curve.b));
    return { F0: F0, F1: F1, odds: Math.max(0.02, Math.min(0.9, (F1 - F0) / (1 - F0))) };
  }
  /** launchOdds: of the peers still without a token at this age, the share that record one within the horizon. */
  function launchOdds(curve, p, horizonDays) { return lifeTable(curve, p, horizonDays).odds; }

  /** Three significant figures: the model misses by a multiple, so more digits would be false precision. */
  function sig3(x) { return Math.max(1, Math.round(Number(x.toPrecision(3)))); }

  /** valueRow: value if launched = TVL x fitted multiple; implied value = that x the 12-month launch odds. */
  function valueRow(m, p) {
    var logM = predictLog(m.fit, p, m.ctx), multiple = Math.pow(10, logM);
    var ifLaunched = p.tvl_usd * multiple, odds = launchOdds(m.curve, p, 365);
    var parts = { pool: Math.pow(10, m.fit.b[0]) }, j = 1;
    if (m.fit.terms.size) parts.size = Math.pow(10, m.fit.b[j++] * (Math.log10(p.tvl_usd) - 8));
    if (m.fit.terms.family) { parts.family = Math.pow(10, m.fit.b[j + FAMILIES.indexOf(familyOf(p.category))]); j += FAMILIES.length; }
    if (m.fit.terms.age) parts.age = Math.pow(10, m.fit.b[j++] * features(p, { age: true }, m.ctx)[1]);
    if (m.fit.terms.growth) parts.growth = Math.pow(10, m.fit.b[j++] * excessGrowth(p, m.ctx) / 100);
    return {
      slug: p.slug, name: p.name, category: p.category, family: familyOf(p.category), chains: p.chains, group: p.group,
      tvl_usd: p.tvl_usd, change_7d: p.change_7d, excess_7d: excessGrowth(p, m.ctx), age: p.age, age_days: p.age, listed_at: p.listed_at,
      multiple: multiple, parts: parts, value_if_launched: ifLaunched, odds_12m: odds,
      p25: ifLaunched * Math.pow(10, m.q25) * odds, p75: ifLaunched * Math.pow(10, m.q75) * odds,
      raw: ifLaunched * odds, implied_value_usd: sig3(ifLaunched * odds)
    };
  }

  /** nearestPeers: the priced comps of the same family closest in TVL, the cap/TVL each trades at. */
  function nearestPeers(m, row, n) {
    var same = m.comps.filter(function (c) { return familyOf(c.category) === row.family; });
    var pool = same.length >= n ? same : m.comps;
    return pool.slice().sort(function (a, b) {
      return Math.abs(Math.log10(a.tvl_usd / row.tvl_usd)) - Math.abs(Math.log10(b.tvl_usd / row.tvl_usd)) || bySlug(a, b);
    }).slice(0, n);
  }

  /** run: the whole model from the snapshot, deterministic; main.ts and the page call this alone. */
  function run(snapshot) {
    var watch = {};
    snapshot.watchlist.forEach(function (s) { watch[s] = true; });
    var all = snapshot.protocols.slice().sort(bySlug).map(function (p) {
      var q = Object.assign({}, p);
      q.age = ageDays(snapshot.as_of, p.listed_at); q.tok = recordsToken(p);
      q.group = ledgerGroup(p, watch, snapshot.floor_usd); q.reason = ruleOut(p);
      return q;
    });
    var ctx = { market7d: median(all.filter(function (p) { return p.change_7d !== null; }).map(function (p) { return p.change_7d; })) };
    var comps = all.filter(function (p) { return p.group === 'trades' && p.reason === null; });
    var sel = selectTerms(comps, ctx);
    var loo = looResiduals(comps, sel.terms, ctx), walk = walkResiduals(comps, sel.terms, ctx);
    var pop = all.filter(function (p) { return p.reason === null && p.age !== null; });
    var oddsSel = selectOdds(pop, ctx);
    var m = {
      ctx: ctx, comps: comps, fit: fitMultiple(comps, sel.terms, ctx), curve: fitLaunchCurve(pop, oddsSel.terms),
      selection: sel, oddsSelection: oddsSel, q25: quantile(loo, 0.25), q75: quantile(loo, 0.75),
      coverage: rangeCoverage(walk), pop: pop.length, all: all
    };
    var ranked = all.filter(function (p) { return p.group === 'watchlist' || p.group === 'offlist' || p.group === 'early'; })
      .map(function (p) { return valueRow(m, p); })
      .sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || b.raw - a.raw || bySlug(a, b); });
    ranked.forEach(function (r, i) { r.rank = i + 1; });
    m.rows = ranked;
    m.ledger = {};
    all.forEach(function (p) { m.ledger[p.group] = (m.ledger[p.group] || 0) + 1; });
    return m;
  }

  return {
    run: run, valueRow: valueRow, launchOdds: launchOdds, lifeTable: lifeTable, nearestPeers: nearestPeers, familyOf: familyOf,
    FAMILY_NAME: FAMILY_NAME, ruleOut: ruleOut, sig3: sig3, UNDATED_DAYS: UNDATED_DAYS
  };
});
