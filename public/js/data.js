// Loads everything from the API, and keeps every open device in sync by polling a change counter.
(() => {
  const { $, S, api, on, emit, ymd, monthStartOf } = window.Ben;

  function range() {
    const v = $('period').value, now = new Date();
    if (v === 'all') return {};
    if (v === 'month') return { from: monthStartOf(now) };
    if (v === 'year') return { from: `${now.getFullYear()}-01-01` };
    return { from: ymd(new Date(now.getTime() - (+v - 1) * 86400000)) };
  }

  let lastVersion = null, loading = null;

  async function load() {
    if (loading) return loading; // never run two loads at once
    loading = (async () => {
      const { from } = range();
      const now = new Date();
      const twelveMonths = ymd(new Date(now.getFullYear(), now.getMonth() - 11, 1)); // monthly chart + weekly/monthly budgets
      const fetchFrom = from === undefined ? undefined : from < twelveMonths ? from : twelveMonths;
      const [t, b, g, a, sy] = await Promise.all([
        api('/transactions' + (fetchFrom ? '?from=' + fetchFrom : '')), api('/budgets'), api('/goals'), api('/accounts'), api('/sync'),
      ]);
      S.ALL = t.transactions;
      S.loadedFrom = fetchFrom || '0000-00-00';
      S.BUDGETS = b.budgets;
      S.GOALS = g.goals;
      S.ACCOUNTS = a.accounts;
      lastVersion = sy.v;
      $('lastUpdate').textContent = 'อัปเดตล่าสุด ' + new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
      render();
    })().finally(() => { loading = null; });
    return loading;
  }

  function render() {
    const { from } = range();
    S.TX = from ? S.ALL.filter((x) => x.date >= from) : S.ALL;
    emit('render');
  }

  // ---------- near-real-time sync across devices ----------
  async function poll() {
    if (document.hidden || $('appView').hidden || loading) return;
    if ($('txDialog').open || $('nlDialog').open) return; // don't redraw under an open form
    try {
      const { v } = await api('/sync');
      if (lastVersion !== null && v !== lastVersion) await load();
    } catch { /* offline or logged out: try again next tick */ }
  }
  setInterval(poll, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  window.addEventListener('online', poll);

  $('period').addEventListener('change', () => { window.Ben.setMenu(false); load(); });
  on('reload', load);
  Object.assign(window.Ben, { load, render, range });
})();
