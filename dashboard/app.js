// Token Radar dashboard: renders window.RADAR (written by main.ts as data.js) as a sortable,
// filterable board with a detail view per protocol. No framework, no network: the page reads only
// the data.js beside it. Deep links, for the three views the entry is captured in:
//   dashboard/index.html            the board
//   dashboard/index.html#detail=<slug>   one protocol's detail view
//   dashboard/index.html#filter=<category>  a filtered view (or #q=<text>, #watch, #live)

(function () {
  'use strict';

  var R = window.RADAR;
  var rowsEl = document.getElementById('rows');
  var liveRowsEl = document.getElementById('liverows');
  var gridEl = document.getElementById('grid');
  var liveGridEl = document.getElementById('livegrid');
  var countEl = document.getElementById('count');
  var hintEl = document.getElementById('hint');
  var qEl = document.getElementById('q');
  var catEl = document.getElementById('cat');
  var watchEl = document.getElementById('watch');
  var detailEl = document.getElementById('detail');
  var dcontentEl = document.getElementById('dcontent');
  var dcloseEl = document.getElementById('dclose');

  if (!R || !Array.isArray(R.rows)) {
    rowsEl.innerHTML = '<tr><td colspan="8">No radar data: data.js did not load.</td></tr>';
    return;
  }

  var state = { tab: 'board', sort: 'rank', dir: 1, q: '', cat: '', watch: false };
  var applyingHash = false;
  var openSlug = null;

  // ------------------------------------------------------------ formatting

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function money(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return '$' + Math.round(n);
  }

  function moneyFull(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function pct(n) {
    if (n == null) return { t: '—', c: 'flat' };
    var s = (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
    return { t: s, c: n > 0 ? 'up' : n < 0 ? 'down' : 'flat' };
  }

  function ageStr(days) {
    if (days == null) return '—';
    if (days >= 365) {
      var y = Math.floor(days / 365);
      var m = Math.floor((days % 365) / 30);
      return m > 0 ? y + 'y ' + m + 'm' : y + 'y';
    }
    return days + 'd';
  }

  // ------------------------------------------------------------ filtering and sorting

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return R.rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (!q) return true;
      var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  function sortRows(rows) {
    var key = state.sort;
    var dir = state.dir;
    return rows.slice().sort(function (a, b) {
      var x = a[key];
      var y = b[key];
      if (key === 'name') {
        x = String(x).toLowerCase();
        y = String(y).toLowerCase();
      }
      if (key === 'category') {
        x = String(x || '').toLowerCase();
        y = String(y || '').toLowerCase();
      }
      if (key === 'chains') {
        x = a.chains.length;
        y = b.chains.length;
      }
      if (x == null && y == null) return a.rank - b.rank;
      if (x == null) return 1;
      if (y == null) return -1;
      var d = x < y ? -1 : x > y ? 1 : 0;
      return d * dir || (a.rank - b.rank);
    });
  }

  // ------------------------------------------------------------ rendering

  function rowHtml(r) {
    var g = pct(r.change_7d);
    var wc = r.watchlist ? '<span class="badge">Watchlist</span>' : '';
    return '<tr data-slug="' + esc(r.slug) + '">' +
      '<td class="rank' + (r.rank <= 10 ? ' top' : '') + '">' + r.rank + '</td>' +
      '<td><span class="pname">' + esc(r.name) + '</span>' + wc + '<span class="pslug">' + esc(r.slug) + '</span></td>' +
      '<td class="cat">' + esc(r.category || '—') + '</td>' +
      '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ') || '—') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td class="num ' + g.c + '">' + g.t + '</td>' +
      '<td class="num">' + ageStr(r.age_days) + '</td>' +
      '<td class="num val">' + money(r.implied_value_usd) + '</td>' +
      '</tr>';
  }

  function renderBoard() {
    var rows = sortRows(filteredRows());
    rowsEl.innerHTML = rows.map(rowHtml).join('') || '<tr><td colspan="8">Nothing matches the filter.</td></tr>';
    var total = R.rows.length;
    countEl.textContent = 'Showing ' + rows.length + ' of ' + total + ' rows · ' +
      R.watchlist_size + ' on the watchlist · sorted by ' + state.sort + (state.dir < 0 ? ' (descending)' : ' (ascending)');
    var bits = [];
    if (state.cat) bits.push('category ' + state.cat);
    if (state.watch) bits.push('watchlist only');
    if (state.q.trim()) bits.push('matching "' + state.q.trim() + '"');
    hintEl.textContent = bits.length ? 'Filtered view: ' + bits.join(' · ') + '.' : 'The full board, ranked by implied value. Click a row for its farm plan.';
  }

  function renderLive() {
    liveRowsEl.innerHTML = R.live.map(function (p) {
      var g = pct(p.change_7d);
      return '<tr data-slug="' + esc(p.slug) + '">' +
        '<td><span class="pname">' + esc(p.name) + '</span><span class="pslug">' + esc(p.slug) + '</span></td>' +
        '<td class="cat">' + esc(p.category || '—') + '</td>' +
        '<td class="chains">' + esc(p.chains.slice(0, 3).join(', ') || '—') + '</td>' +
        '<td class="num">' + money(p.tvl_usd) + '</td>' +
        '<td class="num val">' + money(p.mcap_usd) + '</td>' +
        '<td class="num ' + g.c + '">' + g.t + '</td>' +
        '</tr>';
    }).join('');
    countEl.textContent = 'The ' + R.live.length + ' largest live-token protocols by market cap, set aside at the market’s own values.';
    hintEl.textContent = 'These already trade — they are not tokens still to come, so they are never ranked on the board.';
  }

  function renderStats() {
    var top = R.rows[0];
    document.getElementById('stats').innerHTML =
      '<div><dt>Board rows</dt><dd>' + R.board_size + '</dd></div>' +
      '<div><dt>On the watchlist</dt><dd>' + R.watchlist_size + '</dd></div>' +
      '<div><dt>Early radar</dt><dd>' + R.early_size + '</dd></div>' +
      '<div><dt>Top implied value</dt><dd><b>' + money(top ? top.implied_value_usd : 0) + '</b></dd></div>' +
      '<div><dt>Snapshot</dt><dd>' + esc(R.as_of) + '</dd></div>';
  }

  function renderCats() {
    var cats = {};
    R.rows.forEach(function (r) { if (r.category) cats[r.category] = true; });
    var names = Object.keys(cats).sort();
    catEl.innerHTML = '<option value="">All categories</option>' +
      names.map(function (c) { return '<option value="' + esc(c) + '"' + (state.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
  }

  function renderSortMarks() {
    var ths = gridEl.querySelectorAll('th[data-sort]');
    ths.forEach(function (th) {
      if (th.getAttribute('data-sort') === state.sort) {
        th.setAttribute('aria-sort', state.dir > 0 ? 'ascending' : 'descending');
      } else {
        th.removeAttribute('aria-sort');
      }
    });
  }

  function renderTabs() {
    var board = state.tab === 'board';
    document.getElementById('tab-board').classList.toggle('active', board);
    document.getElementById('tab-live').classList.toggle('active', !board);
    document.getElementById('tab-board').setAttribute('aria-selected', String(board));
    document.getElementById('tab-live').setAttribute('aria-selected', String(!board));
    gridEl.hidden = !board;
    liveGridEl.hidden = board;
    if (board) renderBoard(); else renderLive();
    renderSortMarks();
  }

  function renderAll() {
    qEl.value = state.q;
    catEl.value = state.cat || '';
    watchEl.checked = state.watch;
    renderTabs();
  }

  // ------------------------------------------------------------ detail view

  function splitStep(s) {
    var i = s.lastIndexOf(' Cost: ');
    if (i < 0) return { action: s, ct: '' };
    return { action: s.slice(0, i), ct: s.slice(i + 1) };
  }

  function openDetail(slug) {
    var r = null;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) { r = R.rows[i]; break; }
    if (!r) return;
    openSlug = slug;
    var g = pct(r.change_7d);
    var m = r.model;
    var calSrc = m.calibration_source === 'category'
      ? 'category median, ' + m.calibration_n + ' live protocol' + (m.calibration_n === 1 ? '' : 's')
      : 'global median fallback, ' + m.calibration_n + ' live protocols';
    var modelLines = [
      'base       = TVL ' + moneyFull(r.tvl_usd) + ' × ' + m.base_multiple + ' = ' + moneyFull(r.tvl_usd * m.base_multiple) + '  (' + calSrc + ')',
      'growth     = ' + (r.change_7d == null ? 'no 7d change' : m.growth_pct + '%') + ' → ×' + m.growth_multiplier,
      'maturity   = ' + (m.age_days == null ? 'age unknown (365d)' : m.age_days + ' days') + ' → ×' + m.maturity_multiplier,
      'watchlist  = ' + (r.watchlist ? 'on the watchlist' : 'below the floor') + ' → ×' + m.watchlist_multiplier,
      'chains     = ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ' → ×' + m.chain_multiplier,
      'implied    = ' + moneyFull(r.implied_value_usd),
    ].join('\n');
    var steps = r.farm_steps.map(function (s) {
      var p = splitStep(s);
      return '<li><p>' + esc(p.action) + '</p>' + (p.ct ? '<p class="ct">' + esc(p.ct) + '</p>' : '') + '</li>';
    }).join('');
    dcontentEl.innerHTML =
      '<h2 id="dname">' + esc(r.name) + (r.watchlist ? '<span class="badge">Watchlist</span>' : '') + '</h2>' +
      '<p class="meta">Rank #' + r.rank + ' · ' + esc(r.slug) + ' · ' + esc(r.category || 'uncategorised') + ' · ' + esc(r.chains.join(', ') || 'no chain listed') + '</p>' +
      '<dl class="kv">' +
      '<div><dt>Implied value</dt><dd>' + moneyFull(r.implied_value_usd) + '</dd></div>' +
      '<div><dt>TVL</dt><dd>' + moneyFull(r.tvl_usd) + '</dd></div>' +
      '<div><dt>7-day change</dt><dd class="' + g.c + '">' + g.t + '</dd></div>' +
      '<div><dt>Age</dt><dd>' + ageStr(r.age_days) + '</dd></div>' +
      '</dl>' +
      '<h3>Why this value</h3>' +
      '<div class="modelbox">' + esc(modelLines) + '</div>' +
      '<h3>Farm plan — ' + r.farm_steps.length + ' steps</h3>' +
      '<ol class="steps">' + steps + '</ol>' +
      '<p class="fine" style="margin-top:14px">A reader’s checklist, not financial advice. Check the protocol’s own page before you send it money, and never pay to claim.</p>';
    detailEl.hidden = false;
    document.body.style.overflow = 'hidden';
    if (location.hash !== '#detail=' + slug) {
      applyingHash = true;
      location.hash = 'detail=' + slug;
      applyingHash = false;
    }
    dcloseEl.focus();
  }

  function closeDetail() {
    if (openSlug === null) return;
    openSlug = null;
    detailEl.hidden = true;
    document.body.style.overflow = '';
    if (location.hash.indexOf('#detail=') === 0) {
      applyingHash = true;
      history.replaceState(null, '', location.pathname + location.search);
      applyingHash = false;
    }
  }

  // ------------------------------------------------------------ hash routing

  function readHash() {
    var h = location.hash.replace(/^#/, '');
    var params = {};
    h.split('&').forEach(function (part) {
      var kv = part.split('=');
      if (kv[0]) params[kv[0]] = decodeURIComponent(kv[1] || '');
    });
    return params;
  }

  function applyHash() {
    var p = readHash();
    if (p.detail) {
      state.tab = 'board';
      if (p.filter) state.cat = p.filter;
      if (p.q) state.q = p.q;
      if (p.watch) state.watch = true;
      renderAll();
      openDetail(p.detail);
      return;
    }
    state.tab = p.live !== undefined ? 'live' : 'board';
    state.cat = p.filter || '';
    state.q = p.q || '';
    state.watch = p.watch !== undefined;
    renderAll();
    closeDetail();
  }

  function writeHash() {
    var parts = [];
    if (state.tab === 'live') parts.push('live');
    if (state.cat) parts.push('filter=' + encodeURIComponent(state.cat));
    if (state.q.trim()) parts.push('q=' + encodeURIComponent(state.q.trim()));
    if (state.watch) parts.push('watch');
    var next = parts.length ? '#' + parts.join('&') : '';
    if (location.hash !== next) {
      applyingHash = true;
      history.replaceState(null, '', location.pathname + location.search + next);
      applyingHash = false;
    }
  }

  // ------------------------------------------------------------ events

  qEl.addEventListener('input', function () {
    state.q = qEl.value;
    if (state.tab === 'board') renderBoard();
  });
  qEl.addEventListener('change', writeHash);
  catEl.addEventListener('change', function () {
    state.cat = catEl.value;
    if (state.tab === 'board') renderBoard();
    writeHash();
  });
  watchEl.addEventListener('change', function () {
    state.watch = watchEl.checked;
    if (state.tab === 'board') renderBoard();
    writeHash();
  });
  gridEl.querySelectorAll('th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sort === key) {
        state.dir = -state.dir;
      } else {
        state.sort = key;
        state.dir = key === 'rank' || key === 'name' || key === 'category' ? 1 : -1;
      }
      renderBoard();
      renderSortMarks();
    });
  });
  rowsEl.addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });
  document.getElementById('tab-board').addEventListener('click', function () {
    state.tab = 'board';
    renderTabs();
    writeHash();
  });
  document.getElementById('tab-live').addEventListener('click', function () {
    state.tab = 'live';
    renderTabs();
    writeHash();
  });
  dcloseEl.addEventListener('click', closeDetail);
  detailEl.addEventListener('click', function (e) { if (e.target === detailEl) closeDetail(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });
  window.addEventListener('hashchange', function () { if (!applyingHash) applyHash(); });

  function renderCalib() {
    var cal = R.calibration;
    if (!cal) return;
    var onBoard = {};
    R.rows.forEach(function (r) { if (r.category) onBoard[r.category] = true; });
    var entries = cal.categories.filter(function (e) { return onBoard[e.category]; })
      .sort(function (a, b) { return b.multiple - a.multiple; });
    document.getElementById('calibnote').textContent =
      'Calibrated from the snapshot’s own live tokens: each category’s base multiple is the median ' +
      'market-cap-to-TVL ratio of its live-token protocols (a recorded market cap of zero is no price ' +
      'at all, so it is left out). A category needs at least ' + cal.min_live_count + ' live protocols; ' +
      'the global median ' + cal.global_median + ' across ' + cal.global_live_count + ' live protocols ' +
      'is the fallback for every other category. Every multiple is capped to ' + cal.multiple_floor + '–' + cal.multiple_cap + ' ' +
      'so one outlier cannot dominate. The table lists the categories on this board; the rest take the global fallback.';
    var rows = entries.map(function (e) {
      return '<tr><td>' + esc(e.category) + '</td>' +
        '<td class="num">' + e.live_count + '</td>' +
        '<td class="num">' + e.median.toFixed(4) + '</td>' +
        '<td class="num"><b>' + e.multiple.toFixed(4) + '</b></td></tr>';
    }).join('');
    rows += '<tr><td>Global fallback (every other category)</td>' +
      '<td class="num">' + cal.global_live_count + '</td>' +
      '<td class="num">' + cal.global_median.toFixed(4) + '</td>' +
      '<td class="num"><b>' + cal.global_multiple.toFixed(4) + '</b></td></tr>';
    document.getElementById('calibtable').innerHTML =
      '<thead><tr><th>Category</th><th class="num">Live protocols</th><th class="num">Median mcap / TVL</th><th class="num">Base multiple</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>';
  }

  // ------------------------------------------------------------ model notes and boot

  document.getElementById('formula').textContent =
    'implied = TVL × base multiple × growth × maturity × watchlist × chains\n' +
    '  base multiple = median market-cap / TVL of the live-token protocols in the\n' +
    '                  protocol’s category (at least 2 live, else the global median),\n' +
    '                  capped to 0.05–2.00; it carries the category effect, so there\n' +
    '                  is no separate category multiplier\n' +
    '  growth    = 1 + clamp(7d change, −50%, +150%) × 0.55\n' +
    '  maturity  = 0.55 + min(age, 1460 days) / 1460 × 0.55   (unknown age: 365 days)\n' +
    '  watchlist = ×1.30 on the watchlist, ×1.00 below it\n' +
    '  chains    = 1 + min(chains − 1, 4) × 0.03';
  document.getElementById('modelnote').textContent =
    'The watchlist is the snapshot’s own floor: at least $50M of TVL, no token, and not a wrapped, ' +
    'staked or bridged product of a token that trades. The board ranks the watchlist plus the ' +
    R.early_size + ' strongest pre-token protocols below it, by implied value. The base multiple is ' +
    'recomputed from the snapshot’s live tokens on every run — no protocol and no category is priced ' +
    'by a hand-written number. Live-token protocols are set aside at the market’s own values.';
  document.getElementById('source').textContent =
    'Source: DefiLlama protocol snapshot, ' + R.as_of + '. ' + R.rows.length + ' protocols on the board ' +
    'from ' + R.watchlist_size + ' watchlist slugs and ' + R.early_size + ' early rows; ' +
    R.live_size + ' live-token protocols set aside.';

  renderStats();
  renderCats();
  renderCalib();
  if (location.hash) applyHash(); else renderAll();
})();
