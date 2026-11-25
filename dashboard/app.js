/* Tokenless Radar: the page. It refits the model from the raw snapshot (RadarModel.run), checks every
   row against board.json, and draws; every number comes from model.js and farm.js. */
(function () {
  'use strict';
  var D = window.RADAR_DATA, Model = window.RadarModel, Farm = window.RadarFarm, usd = Farm.usd;
  var app = document.getElementById('app');
  var M = Model.run(D.snapshot);
  var S = { tab: 'board', tier: 'all', verdict: 'all', family: 'all', chain: 'all', q: '', sort: 'rank', dir: 1, open: null,
    deposit: Farm.DEFAULTS.deposit, months: Farm.DEFAULTS.months, dropShare: Farm.DEFAULTS.dropShare };
  var TIERS = { watchlist: 'Watchlist', offlist: 'Off-list', early: 'Early' };
  var GROUPS = [
    ['watchlist', 'Ranked: watchlist'], ['offlist', 'Ranked: off-list, ≥ floor'], ['early', 'Ranked: early, < floor'],
    ['trades', 'Token trades (priced comps)'], ['recorded', 'Token recorded, no cap'], ['out', 'Out by rule: bridge, LST, CEX, versioned, wrapped']
  ];

  /** checkAgainstBoard: each row recomputed here must carry board.json's own rank and implied value. */
  function checkAgainstBoard() {
    var want = {}, ok = 0;
    D.board.forEach(function (b) { want[b[0]] = b; });
    M.rows.forEach(function (r) { var b = want[r.slug]; if (b && b[1] === r.rank && b[2] === r.implied_value_usd) ok++; });
    return { ok: ok, n: D.board.length, same: ok === D.board.length && M.rows.length === D.board.length };
  }
  /** houseRule: does this file's rule rebuild the house watchlist from the ten fields alone? */
  function houseRule() {
    var wl = M.rows.filter((r) => r.group === 'watchlist'), byRule = wl.filter((r) => Model.ruleOut(r) === null && r.tvl_usd >= D.snapshot.floor_usd);
    return { wl: wl.length, byRule: byRule.length, n: D.snapshot.watchlist.length };
  }
  var CHECK = checkAgainstBoard(), RULE = houseRule();

  function settings() { return { deposit: S.deposit, months: S.months, dropShare: S.dropShare }; }
  function scoreFarms() { M.rows.forEach(function (r) { r.v = Farm.farmVerdict(Model, M, r, settings()); }); }

  // ---- small helpers
  function h(tag, attrs) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) put(el, arguments[i]);
    return el;
  }
  function put(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { put(el, x); });
    else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  function pct(x, d) { return (x * 100).toFixed(d || 0) + '%'; }
  function signed(x, d) { return (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d === undefined ? 1 : d); }
  function money(x) { return (x > 0 ? '+' : '') + usd(x); }
  function age(d) { return d === null ? 'undated' : d >= 365 ? (d / 365).toFixed(1) + ' y' : d + ' d'; }
  function chain(r) { return r.chains.length ? r.chains[0] + (r.chains.length > 1 ? ' +' + (r.chains.length - 1) : '') : 'no chain'; }
  function verdictTag(v) { return h('span', { class: 'vd vd-' + v.verdict, text: v.verdict }); }

  // ---- state in the address, so a view can be linked and reopened
  function readHash() {
    var q = new URLSearchParams(location.hash.slice(1));
    ['tab', 'tier', 'verdict', 'family', 'chain', 'q', 'sort', 'open'].forEach(function (k) { if (q.get(k)) S[k] = q.get(k); });
    ['dir', 'deposit', 'months', 'dropShare'].forEach(function (k) { if (q.get(k)) S[k] = Number(q.get(k)); });
  }
  function writeHash() {
    var q = new URLSearchParams();
    ['tab', 'tier', 'verdict', 'family', 'chain', 'q', 'sort', 'open'].forEach(function (k) { if (S[k] && S[k] !== 'all' && !(k === 'tab' && S[k] === 'board') && !(k === 'sort' && S[k] === 'rank')) q.set(k, S[k]); });
    history.replaceState(null, '', q.toString() ? '#' + q.toString() : location.pathname);
  }

  // ---- filtering, sorting, export
  var SORTS = {
    rank: (r) => r.rank, name: (r) => r.name.toLowerCase(), tier: (r) => r.group,
    tvl: (r) => r.tvl_usd, g7: (r) => r.excess_7d, age: (r) => r.age_days === null ? 1e9 : r.age_days,
    odds: (r) => r.odds_12m, ifl: (r) => r.value_if_launched, implied: (r) => r.raw,
    farm: (r) => r.v.cover
  };
  function visibleRows() {
    var q = S.q.trim().toLowerCase();
    var list = M.rows.filter(function (r) {
      if (S.tier !== 'all' && r.group !== S.tier) return false;
      if (S.verdict !== 'all' && r.v.verdict !== S.verdict) return false;
      if (S.family !== 'all' && r.family !== S.family) return false;
      if (S.chain !== 'all' && r.chains[0] !== S.chain) return false;
      return !q || (r.name + ' ' + r.slug + ' ' + r.category + ' ' + r.chains.join(' ')).toLowerCase().indexOf(q) >= 0;
    });
    var key = SORTS[S.sort] || SORTS.rank;
    return list.sort(function (a, b) { var x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : a.rank - b.rank) * S.dir; });
  }
  /** exportRows: the rows on screen, as CSV or JSON. */
  function exportRows(kind) {
    var rows = visibleRows().map(function (r) {
      return { rank: r.rank, slug: r.slug, tier: r.group, tvl_usd: r.tvl_usd, change_7d: r.change_7d, age_days: r.age_days, odds_12m: +r.odds_12m.toFixed(4),
        value_if_launched_usd: Math.round(r.value_if_launched), implied_value_usd: r.implied_value_usd, verdict: r.v.verdict, net_usd: Math.round(r.v.net) };
    });
    var body = kind === 'json' ? JSON.stringify(rows, null, 1) : [Object.keys(rows[0] || {})].concat(rows.map(function (o) { return Object.keys(o).map((k) => o[k]); })).join('\n');
    var a = h('a', { href: URL.createObjectURL(new Blob([body])), download: 'tokenless-radar.' + kind });
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ---- the page
  function header() {
    return h('header', { class: 'top' },
      h('div', { class: 'brand' }, h('span', { class: 'mark', 'aria-hidden': 'true' }),
        h('div', null, h('h1', { text: 'Tokenless Radar' }),
          h('p', { class: 'sub', text: 'Protocols that record no token, ranked by what one would be worth · DefiLlama snapshot ' + D.snapshot.as_of + ' · ' + D.snapshot.protocols.length + ' protocols' }))),
      h('p', { class: 'howto' }, h('b', { text: 'How to read it. ' }),
        'Implied value = value if launched × launch odds in 12 months. Value if launched = TVL × the cap/TVL multiple traded tokens of that size carry. ',
        'The verdict nets a modelled airdrop on your deposit against gas, fees and a risk charge. The board’s claim, not a forecast.'));
  }
  function checks() {
    var sel = M.selection, total = 0;
    Object.keys(M.ledger).forEach(function (k) { total += M.ledger[k]; });
    var items = [
      [CHECK.same, CHECK.ok + ' of ' + CHECK.n + ' rows recomputed here = board.json'],
      [RULE.wl === RULE.n, 'watchlist ' + RULE.wl + ' of ' + RULE.n + ' ranked'],
      [RULE.byRule === RULE.n, 'house rule rebuilt from the ten fields: ' + RULE.byRule + ' of ' + RULE.n],
      [total === D.snapshot.protocols.length, 'ledger ' + total + ' of ' + D.snapshot.protocols.length + ' protocols placed once'],
      [sel.loo < sel.table[0].loo, 'held-out miss ×' + sel.loo.toFixed(2) + ' (flat multiple ×' + sel.table[0].loo.toFixed(2) + ')']
    ];
    return h('div', { class: 'checks' }, items.map(function (c) { return h('span', { class: c[0] ? 'ok' : 'bad' }, h('b', { text: c[0] ? '✓' : '✗' }), c[1]); }));
  }
  function ledger() {
    var total = D.snapshot.protocols.length;
    return h('section', { class: 'ledger', 'aria-label': 'Protocol accounting' },
      h('div', { class: 'bar' }, GROUPS.map(function (g) {
        var n = M.ledger[g[0]] || 0;
        return h('button', { type: 'button', class: 'seg g-' + g[0], style: 'width:' + (100 * n / total) + '%', title: g[1] + ': ' + n, onclick: function () { pickGroup(g[0]); } }, n > 30 ? String(n) : '');
      })),
      h('div', { class: 'legend' }, GROUPS.map(function (g) {
        return h('button', { type: 'button', class: 'key', onclick: function () { pickGroup(g[0]); } }, h('i', { class: 'g-' + g[0] }), h('b', { text: M.ledger[g[0]] || 0 }), g[1]);
      })));
  }
  function pickGroup(g) {
    if (TIERS[g]) { S.tab = 'board'; S.tier = g; } else S.tab = g;
    draw();
  }
  function chip(key, value, label, n) {
    return h('button', { type: 'button', class: 'chip' + (S[key] === value ? ' on' : ''), 'aria-pressed': S[key] === value ? 'true' : 'false',
      onclick: function () { S[key] = value; draw(); } }, label, n === undefined ? null : h('small', { text: n }));
  }
  function select(key, options, label) {
    return h('label', { class: 'field' }, h('span', { text: label }),
      h('select', { onchange: function (e) { S[key] = isNaN(Number(e.target.value)) || key === 'chain' ? e.target.value : Number(e.target.value); draw(); } },
        options.map(function (o) { return h('option', { value: o[0], selected: String(S[key]) === String(o[0]) ? 'selected' : null, text: o[1] }); })));
  }
  function controls() {
    var count = function (k, v) { return M.rows.filter((r) => k === 'tier' ? r.group === v : r.v.verdict === v).length; };
    var chains = {};
    M.rows.forEach(function (r) { if (r.chains[0]) chains[r.chains[0]] = (chains[r.chains[0]] || 0) + 1; });
    var chainList = Object.keys(chains).filter((c) => chains[c] >= 3).sort((a, b) => chains[b] - chains[a] || (a < b ? -1 : 1));
    var search = h('input', { type: 'search', id: 'q', placeholder: 'Search name, category, chain', value: S.q, 'aria-label': 'Search',
      oninput: function (e) { S.q = e.target.value; drawTable(); } });
    return h('section', { class: 'controls' },
      h('div', { class: 'row' },
        h('div', { class: 'chips', role: 'group', 'aria-label': 'Tier' }, chip('tier', 'all', 'All tiers', M.rows.length),
          ['watchlist', 'offlist', 'early'].map((t) => chip('tier', t, TIERS[t], count('tier', t)))),
        h('div', { class: 'chips', role: 'group', 'aria-label': 'Verdict' }, chip('verdict', 'all', 'All verdicts'),
          ['FARM', 'MARGINAL', 'SKIP'].map((v) => chip('verdict', v, v, count('verdict', v)))),
        search),
      h('div', { class: 'row' },
        select('family', [['all', 'All families']].concat(Object.keys(Model.FAMILY_NAME).map((f) => [f, Model.FAMILY_NAME[f]])), 'Family'),
        select('chain', [['all', 'All main chains']].concat(chainList.map((c) => [c, c + ' (' + chains[c] + ')'])), 'Main chain'),
        h('span', { class: 'divider' }),
        select('deposit', [[2000, '$2K'], [10000, '$10K'], [50000, '$50K'], [250000, '$250K']], 'Deposit'),
        select('months', [[3, '3 months'], [6, '6 months'], [12, '12 months']], 'Horizon'),
        select('dropShare', [[0.05, '5% of value'], [0.1, '10% of value'], [0.2, '20% of value']], 'Airdrop share'),
        h('span', { class: 'grow' }),
        h('button', { type: 'button', class: 'ghost', text: 'CSV', onclick: function () { exportRows('csv'); } }),
        h('button', { type: 'button', class: 'ghost', text: 'JSON', onclick: function () { exportRows('json'); } })));
  }
  var COLS = [['rank', '#', 'num'], ['name', 'Protocol', ''], ['tier', 'Tier', ''], ['tvl', 'TVL', 'num'], ['g7', '7d vs mkt', 'num'], ['age', 'No token', 'num'],
    ['odds', 'Odds 12m', 'num'], ['ifl', 'If launched', 'num'], ['implied', 'Implied · P25–P75', 'num'], ['farm', 'Farm · net', 'num']];
  function rangeScale() {
    var lo = Infinity, hi = 0;
    M.rows.forEach(function (r) { lo = Math.min(lo, r.p25); hi = Math.max(hi, r.p75); });
    return (x) => 100 * (Math.log(x) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
  }
  var SCALE = rangeScale();
  function boardRow(r) {
    return h('tr', { tabindex: '0', class: S.open === r.slug ? 'sel' : null, onclick: function () { openDetail(r.slug); },
      onkeydown: function (e) { if (e.key === 'Enter') openDetail(r.slug); } },
      h('td', { class: 'num rk', text: r.rank }),
      h('td', null, h('b', { text: r.name }), h('small', { text: (r.category || 'No category') + ' · ' + chain(r) })),
      h('td', null, h('span', { class: 'tier t-' + r.group, text: TIERS[r.group] })),
      h('td', { class: 'num', text: usd(r.tvl_usd) }),
      h('td', { class: 'num ' + (r.excess_7d >= 0 ? 'up' : 'down'), title: 'Seven-day change ' + (r.change_7d === null ? 'not reported' : signed(r.change_7d, 2) + '%') }, signed(r.excess_7d) + ' pts'),
      h('td', { class: 'num', text: age(r.age_days) }),
      h('td', { class: 'num', text: pct(r.odds_12m) }),
      h('td', { class: 'num', text: usd(r.value_if_launched) }),
      h('td', { class: 'num' }, h('span', { class: 'imp' }, h('span', { class: 'range' }, h('i', { style: 'left:' + SCALE(r.p25) + '%;width:' + (SCALE(r.p75) - SCALE(r.p25)) + '%' }),
        h('em', { style: 'left:' + SCALE(r.implied_value_usd) + '%' })), h('b', { text: usd(r.implied_value_usd) }))),
      h('td', { class: 'num farm' }, verdictTag(r.v), h('span', { text: money(r.v.net) })));
  }
  function drawTable() {
    var list = visibleRows(), body = document.getElementById('rows');
    body.textContent = '';
    put(body, list.length ? list.map(boardRow) : h('tr', null, h('td', { colspan: COLS.length, class: 'empty', text: 'No protocol matches these filters.' })));
    document.getElementById('count').textContent = list.length + ' of ' + M.rows.length + ' ranked rows';
    writeHash();
  }
  function boardTable() {
    return h('div', { class: 'tablewrap' }, h('table', { class: 'board' },
      h('thead', null, h('tr', null, COLS.map(function (c) {
        var on = S.sort === c[0];
        return h('th', { class: c[2], 'aria-sort': on ? (S.dir > 0 ? 'ascending' : 'descending') : null },
          h('button', { type: 'button', onclick: function () { S.dir = on ? -S.dir : c[0] === 'rank' || c[0] === 'name' ? 1 : -1; S.sort = c[0]; draw(); } }, c[1], on ? (S.dir > 0 ? ' ↑' : ' ↓') : ''));
      }))),
      h('tbody', { id: 'rows' })));
  }
  /** groupTable: the protocols off the board, so every one of the snapshot's protocols can be looked up. */
  function groupTable(g) {
    var q = S.q.trim().toLowerCase(), trades = g === 'trades';
    var list = M.all.filter((p) => p.group === g && (p.name + ' ' + p.category).toLowerCase().indexOf(q) >= 0).sort((a, b) => b.tvl_usd - a.tvl_usd);
    return h('div', { class: 'tablewrap' }, h('table', { class: 'board' },
      h('thead', null, h('tr', null, ['Protocol', 'Category', 'TVL', trades ? 'Cap' : 'Token', trades ? 'Cap/TVL' : 'Why not ranked'].map(function (t) { return h('th', null, h('span', { text: t })); }))),
      h('tbody', null, list.map(function (p) {
        return h('tr', null, h('td', null, h('b', { text: p.name }), h('small', { text: p.chains[0] || '' })), h('td', { text: p.category || 'none' }), h('td', { class: 'num', text: usd(p.tvl_usd) }),
          h('td', { class: 'num', text: trades ? usd(p.mcap_usd) : p.symbol || p.gecko_id || 'none' }),
          h('td', { text: trades ? (p.mcap_usd / p.tvl_usd).toFixed(3) + (p.reason ? ' (not a comp: ' + p.reason + ')' : '') : p.reason || 'token recorded, no market cap' }));
      }))));
  }
  /** verdictLine: the verdicts under the current settings, and where the FARM rows sit. */
  function verdictLine() {
    var c = { FARM: 0, MARGINAL: 0, SKIP: 0 }, farmEarly = 0;
    M.rows.forEach(function (r) { c[r.v.verdict]++; if (r.v.verdict === 'FARM' && r.group === 'early') farmEarly++; });
    return h('p', { class: 'lead' }, h('b', { text: 'At ' + usd(S.deposit) + ' for ' + S.months + ' months, airdrop share ' + pct(S.dropShare) + ': ' }),
      c.FARM + ' FARM, ' + c.MARGINAL + ' MARGINAL, ' + c.SKIP + ' SKIP. ' + farmEarly + ' of the ' + c.FARM + ' FARM rows sit below the $' + D.snapshot.floor_usd / 1e6 + 'M' +
      ' floor: there a deposit buys a bigger share of TVL, and small protocols trade at a higher cap/TVL. Large protocols lead on value, not on return per dollar.');
  }
  function tabs() {
    var t = [['board', 'Pre-token board', M.rows.length], ['trades', 'Token trades', M.ledger.trades], ['recorded', 'Token recorded', M.ledger.recorded], ['out', 'Out by rule', M.ledger.out]];
    return h('nav', { class: 'tabs' }, t.map(function (x) { return h('button', { type: 'button', class: S.tab === x[0] ? 'on' : null, onclick: function () { S.tab = x[0]; draw(); } }, x[1], h('small', { text: x[2] })); }),
      h('span', { class: 'grow' }), h('span', { id: 'count', class: 'count' }));
  }

  // ---- model card: the fitted curve, the held-out tables and the range check
  /** plot: a small scatter with a fitted line, as SVG markup (numbers and fixed labels only). */
  function plot(points, line, xr, yr, xl, yl, w, ht) {
    var X = (x) => (12 + (x - xr[0]) / (xr[1] - xr[0]) * (w - 18)).toFixed(1);
    var Y = (y) => (ht - 18 - (Math.max(yr[0], Math.min(yr[1], y)) - yr[0]) / (yr[1] - yr[0]) * (ht - 26)).toFixed(1);
    var box = h('div', { class: 'plotbox' });
    box.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + ht + '" class="plot" role="img" aria-label="' + yl + ' against ' + xl + '">' +
      '<path class="axis" d="M12 8V' + (ht - 18) + 'H' + (w - 8) + '"/>' +
      points.map((p) => '<circle class="' + (p[2] || 'dot') + '" r="1.8" cx="' + X(p[0]) + '" cy="' + Y(p[1]) + '"/>').join('') +
      '<polyline class="fit" points="' + line.map((p) => X(p[0]) + ',' + Y(p[1])).join(' ') + '"/>' +
      '<text x="' + (w - 8) + '" y="' + (ht - 4) + '" text-anchor="end">' + xl + '</text><text x="16" y="14">' + yl + '</text></svg>';
    return box;
  }
  function modelCard() {
    var sel = M.selection, b = M.fit.b, odds = M.oddsSelection;
    var comps = M.comps.map((c) => [Math.log10(c.tvl_usd), Math.log10(c.mcap_usd / c.tvl_usd)]);
    var line = [6.7, 10.5].map((x) => [x, b[0] + (b[1] || 0) * (x - 8)]);
    var ages = M.rows.map((r) => [Math.min(5, (r.age_days === null ? Model.UNDATED_DAYS : r.age_days) / 365), r.odds_12m, 't-' + r.group]);
    var typical = { tvl_usd: 1e8, category: 'Lending', change_7d: M.ctx.market7d };
    var curve = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map(function (y) { typical.age = y * 365; return [y, Model.launchOdds(M.curve, typical, 365)]; });
    return h('aside', { class: 'card' },
      h('h2', { text: 'How the value is made' }),
      h('p', { class: 'eq' }, 'implied = TVL × m(TVL) × odds(12 mo)', h('br'), 'm(TVL) = ', h('b', { text: Math.pow(10, b[0]).toFixed(3) }), ' × (TVL / $100M)', h('sup', { text: (b[1] || 0).toFixed(3) })),
      h('p', { class: 'note', text: 'selectTerms fits log cap/TVL on ' + M.comps.length + ' traded comps (Huber-weighted), adding a term only if it lowers both held-out misses. fitLaunchCurve reads launch odds off ' + M.pop + ' dated peers: of those still without a token at this age, the share that record one a year later.' }),
      h('div', { class: 'plots' },
        plot(comps, line, [6.6, 10.6], [-3.2, 2.7], 'log10 TVL', 'log10 cap/TVL, 92 comps', 139, 112),
        plot(ages, curve, [0, 5], [0, 0.6], 'years, no token', 'odds 12 mo, 198 rows', 139, 112)),
      h('table', { class: 'mini' }, h('caption', { text: 'Cap/TVL multiple: median held-out miss' }),
        h('tr', null, h('th', { text: 'term' }), h('th', { text: 'leave 1 out' }), h('th', { text: 'walk fwd' }), h('th', { text: '' })),
        sel.table.map(function (t, i) {
          return h('tr', { class: t.kept ? 'kept' : 'drop' }, h('td', { text: (i ? '+ ' : '') + (t.term === 'growth' ? '7d growth' : t.term) }), h('td', { text: '×' + t.loo.toFixed(2) }), h('td', { text: '×' + t.walk.toFixed(2) }), h('td', { text: i === 0 ? 'base' : t.kept ? 'kept' : 'not kept' }));
        })),
      h('table', { class: 'mini' }, h('caption', { text: 'Launch odds: 10-fold held-out log loss' }),
        odds.table.map(function (t, i) {
          var shape = t.term.indexOf('age') === 0;
          return h('tr', { class: t.kept ? 'kept' : 'drop' }, h('td', { text: (shape || !i ? '' : '+ ') + (t.term === 'growth' ? '7d growth' : t.term) }), h('td', { text: t.loss.toFixed(3) }),
            h('td', { text: i === 0 ? 'base' : shape ? (t.kept ? 'chosen' : 'tried') : t.kept ? 'kept' : 'not kept' }));
        })),
      h('p', { class: 'note' }, h('b', { text: 'Growth. ' }), 'This week the median protocol with no token moved ' + signed(M.week.none) + '%, one with a token ' + signed(M.week.token) +
        '%, so in the life table faster growth reads as earlier and trims the odds a little.'),
      h('p', { class: 'note' }, h('b', { text: 'Range check. ' }), 'The P25–P75 range caught ' + M.coverage.hit + ' of ' + M.coverage.n + ' later caps in the walk-forward test (' + pct(M.coverage.hit / M.coverage.n) + '; 50% is calibrated), so read ranges as narrow. Values carry 3 significant figures.'));
  }

  // ---- detail view
  function openDetail(slug) { S.open = slug; drawDetail(); writeHash(); }
  function closeDetail() { S.open = null; drawDetail(); writeHash(); }
  function waterfall(r) {
    var p = r.parts, mid = r.tvl_usd * p.pool, lt = Model.lifeTable(M.curve, r, 365);
    var steps = [
      ['TVL in the snapshot', '', r.tvl_usd],
      ['× pool multiple at $100M TVL', p.pool.toFixed(3), mid],
      ['× size curve (TVL / $100M)' + '^' + (M.fit.b[1] || 0).toFixed(2), (p.size || 1).toFixed(3), r.value_if_launched],
      ['× launch odds, 12 months', pct(r.odds_12m), r.raw]
    ];
    var top = Math.log(r.tvl_usd), bottom = Math.log(r.raw) - 1;
    var atMarket = Model.launchOdds(M.curve, Object.assign({}, r, { change_7d: M.ctx.market7d }), 365);
    var inputs = [
      ['TVL', usd(r.tvl_usd), 'size curve ×' + (p.size || 1).toFixed(3) + ' against $100M'],
      ['7d growth', signed(r.excess_7d) + ' pts vs market', 'odds ' + pct(r.odds_12m, 1) + ', ' + pct(atMarket, 1) + ' at the market’s pace'],
      ['No token for', age(r.age_days), 'peers this age: ' + pct(lt.F0) + ' record a token, ' + pct(lt.F1) + ' a year on']
    ];
    return h('section', { class: 'box' }, h('h3', { text: 'How the figure is made' }),
      h('div', { class: 'fall' }, steps.map(function (s) {
        return h('div', { class: 'fstep' }, h('span', { text: s[0] }), h('em', { text: s[1] }),
          h('i', { style: 'width:' + Math.max(2, 100 * (Math.log(s[2]) - bottom) / (top - bottom)) + '%' }), h('b', { text: usd(s[2]) }));
      })),
      h('p', { class: 'total' }, 'Implied value ', h('b', { text: usd(r.implied_value_usd) }), ' (P25–P75 ' + usd(r.p25) + ' to ' + usd(r.p75) + ')'),
      h('table', { class: 'mini wide' }, h('caption', { text: 'What the three snapshot inputs do to this row' }), inputs.map(function (x) {
        return h('tr', null, h('th', { text: x[0] }), h('td', { text: x[1] }), h('td', { text: x[2] }));
      })),
      h('p', { class: 'note ' + (CHECK.same ? 'ok' : 'bad'), text: (CHECK.same ? '✓ Recomputed here: ' : '✗ Differs: ') + 'rank ' + r.rank + ', ' + r.implied_value_usd.toLocaleString('en-US') + ' USD, as board.json writes it.' }));
  }
  function peers(r) {
    var list = Model.nearestPeers(M, r, 6);
    return h('section', { class: 'box' }, h('h3', { text: 'Nearest priced peers · ' + Model.FAMILY_NAME[r.family] }),
      h('table', { class: 'mini wide' }, h('tr', null, h('th', { text: 'Token trades' }), h('th', { text: 'TVL' }), h('th', { text: 'Cap' }), h('th', { text: 'Cap/TVL' })),
        list.map(function (c) { return h('tr', null, h('td', { text: c.name + (c.symbol ? ' (' + c.symbol + ')' : '') }), h('td', { text: usd(c.tvl_usd) }), h('td', { text: usd(c.mcap_usd) }), h('td', { text: (c.mcap_usd / c.tvl_usd).toFixed(3) })); }),
        h('tr', { class: 'kept' }, h('td', { text: r.name + ' (model)' }), h('td', { text: usd(r.tvl_usd) }), h('td', { text: usd(r.value_if_launched) }), h('td', { text: r.multiple.toFixed(3) }))),
      h('p', { class: 'note', text: 'The model\u2019s multiple comes from the size curve over all ' + M.comps.length + ' comps, not from these six: family was tested and not kept.' }),
      sensitivity(r));
  }
  function verdictBox(r) {
    var v = r.v, s = settings();
    var lines = [
      ['Deposit share of TVL', pct(v.share, 4)], ['Launch odds within ' + s.months + ' mo', pct(v.odds)],
      ['Modelled drop', usd(v.drop)], ['Gas: ' + v.txs + ' tx × ' + usd(v.gasPerTx) + ' + entry', '−' + usd(v.gas)],
      ['Trading fees', v.fees ? '−' + usd(v.fees) : '$0'], ['Risk charge (' + pct(Farm.riskRate(r.age_days), 2) + ' a year)', '−' + usd(v.risk)],
      ['Net', money(v.net)], ['Hands-on time', v.hours.toFixed(1) + ' h · ' + money(v.perHour) + '/h'],
      ['Drop as yield', pct(v.dropApr, 2) + '/yr (T-bill ' + pct(Farm.TBILL, 1) + ')']
    ];
    return h('section', { class: 'box' }, h('h3', null, 'Farm verdict · ' + usd(s.deposit) + ', ' + s.months + ' mo, ' + pct(s.dropShare) + ' airdrop share ', verdictTag(v)),
      h('dl', { class: 'lines' }, lines.map(function (l) { return [h('dt', { text: l[0] }), h('dd', { text: l[1] })]; })),
      h('p', { class: 'note', text: 'FARM when the drop covers costs 2× or more (here ' + v.cover.toFixed(2) + '×), MARGINAL from 1×, else SKIP.' }),
      h('p', { class: 'note' }, h('b', { text: 'What would flip it. ' }), s.dropShare / v.cover > 1 ? 'No airdrop pays here: even 100% of the token’s value to depositors covers ' + pct(v.cover / s.dropShare) + ' of costs at this deposit.'
        : 'Break-even at an airdrop share of ' + pct(s.dropShare / v.cover, 1) + '; FARM from ' + pct(2 * s.dropShare / v.cover, 1) + '.'));
  }
  /** sensitivity: the net under other airdrop shares and deposits, same horizon. */
  function sensitivity(r) {
    var s = settings();
    return h('table', { class: 'mini sens' }, h('caption', { text: 'Net after costs, ' + s.months + ' mo: airdrop share (rows) by deposit' }),
      h('tr', null, h('th', { text: '' }), ['$2K', '$10K', '$50K', '$250K'].map(function (t) { return h('th', { text: t }); })),
      [0.05, 0.1, 0.2].map(function (ds) {
        return h('tr', null, h('th', { text: pct(ds) }), [2000, 10000, 50000, 250000].map(function (dep) {
          var x = Farm.farmVerdict(Model, M, r, { deposit: dep, months: s.months, dropShare: ds });
          return h('td', { class: 'vg-' + x.verdict, text: money(x.net) });
        }));
      }));
  }
  function plan(r) {
    var steps = Farm.farmPlan(r, r.v, settings());
    return h('section', { class: 'box plan' }, h('h3', { text: 'Farm plan: ' + steps.length + ' steps for ' + r.name + ' on ' + Farm.chainOf(r) }),
      h('table', { class: 'steps' }, h('tr', null, h('th', { text: '#' }), h('th', { text: 'Step' }), h('th', { text: 'Cost' }), h('th', { text: 'Time' })),
        steps.map(function (s, i) { return h('tr', null, h('td', { text: i + 1 }), h('td', { text: s.step }), h('td', { text: s.cost }), h('td', { text: s.time })); })));
  }
  function drawDetail() {
    var host = document.getElementById('detail');
    host.textContent = '';
    var r = M.rows.filter((x) => x.slug === S.open)[0];
    host.hidden = !r;
    document.querySelectorAll('#rows tr').forEach(function (tr) { tr.classList.remove('sel'); });
    if (!r) return;
    put(host, h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': r.name },
      h('header', { class: 'dhead' },
        h('div', null, h('p', { class: 'sub' }, 'Rank ' + r.rank + ' of ' + M.rows.length + ' · ', h('span', { class: 'tier t-' + r.group, text: TIERS[r.group] }), ' · records no token'),
          h('h2', { text: r.name }),
          h('p', { class: 'sub', text: (r.category || 'No category') + ' · ' + r.chains.join(', ') + ' · listed ' + (r.listed_at || 'undated') + ' · TVL 7d ' + (r.change_7d === null ? 'not reported' : signed(r.change_7d, 2) + '%') })),
        h('div', { class: 'big' }, h('small', { text: 'Implied value, 12-month odds' }), h('b', { text: usd(r.implied_value_usd) }), verdictTag(r.v)),
        h('button', { type: 'button', class: 'ghost', text: 'Close', onclick: closeDetail })),
      h('div', { class: 'dgrid' }, waterfall(r), peers(r), verdictBox(r)), plan(r)));
  }

  function draw() {
    scoreFarms();
    app.textContent = '';
    put(app, [header(), checks(), ledger(), controls(), verdictLine(), h('div', { class: 'work' },
      h('main', null, tabs(), S.tab === 'board' ? boardTable() : groupTable(S.tab)), modelCard()), h('div', { id: 'detail', hidden: 'hidden' })]);
    if (S.tab === 'board') drawTable(); else { document.getElementById('count').textContent = (M.ledger[S.tab] || 0) + ' protocols, largest TVL first'; writeHash(); }
    drawDetail();
    app.setAttribute('aria-busy', 'false');
  }

  readHash();
  draw();
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.open) closeDetail(); });
})();
