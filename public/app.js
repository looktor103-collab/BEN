(() => {
  const $ = (id) => document.getElementById(id);
  const show = (el, on) => (el.hidden = !on);
  const fmtTHB = (n) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }).format(n);
  const fmtShort = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : '' + n);
  const PALETTE = ['#f87171', '#fbbf24', '#60a5fa', '#34d399', '#a78bfa', '#f472b6', '#22d3ee', '#94a3b8', '#fb923c', '#a3e635'];
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const thDate = (s) => new Date(s + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });

  async function api(path, opts = {}) {
    const res = await fetch('/api' + path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'เกิดข้อผิดพลาด');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ---------- auth ----------
  let setupMode = false;
  function setAuthMode(setup) {
    setupMode = setup;
    $('authTitle').textContent = setup ? 'ตั้งค่าบัญชีครั้งแรก' : 'เข้าสู่ระบบ';
    $('authSub').textContent = setup ? 'ตั้ง username และรหัสผ่านของคุณเอง' : 'Ben · แดชบอร์ดการเงินส่วนบุคคล';
    $('authSubmit').textContent = setup ? 'สร้างบัญชี' : 'เข้าสู่ระบบ';
    $('password').autocomplete = setup ? 'new-password' : 'current-password';
    show($('confirmField'), setup);
    show($('pwHint'), setup);
    $('password2').required = setup;
  }
  const authError = (m) => { $('authError').textContent = m || ''; show($('authError'), !!m); };

  $('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    authError('');
    const username = $('username').value.trim();
    const password = $('password').value;
    if (setupMode && password !== $('password2').value) return authError('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
    try {
      await api(setupMode ? '/auth/setup' : '/auth/login', { method: 'POST', body: { username, password } });
      $('password').value = $('password2').value = '';
      await boot();
    } catch (err) { authError(err.message); }
  });

  $('signOutBtn').onclick = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    location.reload();
  };

  // ---------- state ----------
  let TX = [], BUDGETS = [], GOALS = [], editingId = null;
  const trend = new Chart($('trendChart'), {
    type: 'line',
    data: { labels: [], datasets: [
      { label: 'รายรับ', data: [], borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,.12)', fill: true, tension: .35, pointRadius: 0, borderWidth: 2 },
      { label: 'รายจ่าย', data: [], borderColor: '#f87171', backgroundColor: 'rgba(248,113,113,.10)', fill: true, tension: .35, pointRadius: 0, borderWidth: 2 }] },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { usePointStyle: true, boxWidth: 8, color: '#8b95a7' } }, tooltip: { callbacks: { label: (c) => c.dataset.label + ': ' + fmtTHB(c.parsed.y) } } },
      scales: { x: { grid: { color: 'rgba(255,255,255,.06)' }, ticks: { color: '#8b95a7' } }, y: { grid: { color: 'rgba(255,255,255,.06)' }, ticks: { color: '#8b95a7', callback: fmtShort } } } },
  });
  const expChart = new Chart($('expenseChart'), {
    type: 'doughnut',
    data: { labels: [], datasets: [{ data: [], backgroundColor: PALETTE, borderWidth: 0, hoverOffset: 6 }] },
    options: { maintainAspectRatio: false, cutout: '62%',
      plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, color: '#8b95a7', font: { size: 11 } } }, tooltip: { callbacks: { label: (c) => c.label + ': ' + fmtTHB(c.parsed) } } } },
  });

  function range() {
    const v = $('period').value, now = new Date();
    if (v === 'all') return {};
    if (v === 'month') return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)) };
    if (v === 'year') return { from: `${now.getFullYear()}-01-01` };
    return { from: ymd(new Date(now.getTime() - (+v - 1) * 86400000)) };
  }

  async function load() {
    const { from } = range();
    const monthStart = ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    // budgets always compare against the current month, so fetch from the earlier of the two
    const fetchFrom = from && from < monthStart ? from : from ? monthStart : undefined;
    const [t, b, g] = await Promise.all([api('/transactions' + (fetchFrom ? '?from=' + fetchFrom : '')), api('/budgets'), api('/goals')]);
    ALL = t.transactions;
    BUDGETS = b.budgets;
    GOALS = g.goals;
    $('lastUpdate').textContent = 'อัปเดตล่าสุด ' + new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    render();
  }
  let ALL = [];

  function render() {
    const { from } = range();
    TX = from ? ALL.filter((x) => x.date >= from) : ALL;
    let inc = 0, exp = 0;
    TX.forEach((x) => (x.type === 'income' ? (inc += x.amount) : (exp += x.amount)));
    const net = inc - exp;
    $('kIncome').textContent = fmtTHB(inc);
    $('kExpense').textContent = fmtTHB(exp);
    const kn = $('kNet');
    kn.textContent = (net >= 0 ? '+' : '−') + fmtTHB(Math.abs(net));
    kn.style.color = net >= 0 ? 'var(--income)' : 'var(--expense)';
    $('kRate').textContent = inc ? ((net / inc) * 100).toFixed(1) + '%' : '–';
    $('kCount').textContent = `จาก ${TX.length.toLocaleString('th-TH')} รายการ`;

    const byDay = {};
    [...TX].reverse().forEach((x) => { (byDay[x.date] ??= { i: 0, e: 0 }); x.type === 'income' ? (byDay[x.date].i += x.amount) : (byDay[x.date].e += x.amount); });
    const days = Object.keys(byDay);
    trend.data.labels = days.map((d) => new Date(d + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }));
    trend.data.datasets[0].data = days.map((d) => byDay[d].i);
    trend.data.datasets[1].data = days.map((d) => byDay[d].e);
    trend.update();

    const ex = {};
    TX.filter((x) => x.type === 'expense').forEach((x) => (ex[x.category] = (ex[x.category] || 0) + x.amount));
    expChart.data.labels = Object.keys(ex);
    expChart.data.datasets[0].data = Object.values(ex);
    expChart.update();

    renderBudgets();
    renderGoals();
    renderNotifs();
    renderTable();
    const cats = new Set([...ALL.map((x) => x.category), ...BUDGETS.map((b) => b.category)]);
    const dl = $('catList');
    dl.replaceChildren(...[...cats].map((c) => Object.assign(document.createElement('option'), { value: c })));
  }

  function renderBudgets() {
    const root = $('budgetList');
    root.replaceChildren();
    if (!BUDGETS.length) { root.append(Object.assign(document.createElement('div'), { className: 'hint', textContent: 'ยังไม่ได้ตั้งงบประมาณ' })); return; }
    const monthStart = ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    const spent = {};
    ALL.filter((x) => x.type === 'expense' && x.date >= monthStart).forEach((x) => (spent[x.category] = (spent[x.category] || 0) + x.amount));
    BUDGETS.forEach((b) => {
      const s = spent[b.category] || 0, pct = (s / b.monthly_limit) * 100;
      const wrap = document.createElement('div');
      wrap.className = 'bud';
      const head = document.createElement('div');
      head.className = 'bud-head';
      const l = document.createElement('span'); l.textContent = b.category;
      const r = document.createElement('span'); r.textContent = `${fmtTHB(s)} / ${fmtTHB(b.monthly_limit)}`;
      head.append(l, r);
      const bar = document.createElement('div');
      bar.className = 'bar' + (pct >= 100 ? ' over' : pct >= 80 ? ' warn' : '');
      const fill = document.createElement('i');
      fill.style.width = Math.min(pct, 100) + '%';
      bar.append(fill);
      wrap.append(head, bar);
      root.append(wrap);
    });
  }

  function renderTable() {
    const body = $('txBody');
    body.replaceChildren();
    $('txHint').textContent = TX.length > 100 ? `แสดง 100 จาก ${TX.length} รายการล่าสุด` : '';
    TX.slice(0, 100).forEach((x) => {
      const tr = document.createElement('tr');
      const cell = (txt, cls) => { const td = document.createElement('td'); td.textContent = txt; if (cls) td.className = cls; return td; };
      tr.append(cell(thDate(x.date)), cell(x.category), cell(x.note),
        cell((x.type === 'income' ? '+' : '−') + fmtTHB(x.amount), 'right ' + (x.type === 'income' ? 'in' : 'out')));
      const act = document.createElement('td');
      act.className = 'right';
      const edit = Object.assign(document.createElement('button'), { className: 'row-btn', textContent: '✎', title: 'แก้ไข' });
      edit.onclick = () => openDialog(x);
      const del = Object.assign(document.createElement('button'), { className: 'row-btn', textContent: '🗑', title: 'ลบ' });
      del.onclick = async () => {
        if (!confirm(`ลบรายการ "${x.category}" ${fmtTHB(x.amount)}?`)) return;
        await api('/transactions/' + x.id, { method: 'DELETE' }).catch((e) => alert(e.message));
        load();
      };
      act.append(edit, del);
      tr.append(act);
      body.append(tr);
    });
  }

  function renderGoals() {
    const root = $('goalList');
    root.replaceChildren();
    if (!GOALS.length) { root.append(Object.assign(document.createElement('div'), { className: 'hint', textContent: 'ยังไม่มีเป้าหมาย' })); return; }
    GOALS.forEach((g) => {
      const saved = Math.max(g.saved, 0), pct = Math.min((saved / g.target) * 100, 100);
      const wrap = document.createElement('div');
      wrap.className = 'goal' + (saved >= g.target ? ' done' : '');
      const head = document.createElement('div');
      head.className = 'goal-head';
      const l = document.createElement('span');
      l.textContent = (saved >= g.target ? '✅ ' : '') + g.name;
      const r = document.createElement('span');
      r.textContent = `${fmtTHB(saved)} / ${fmtTHB(g.target)} (${pct.toFixed(0)}%)`;
      const del = Object.assign(document.createElement('button'), { className: 'row-btn', textContent: '🗑', title: 'ลบเป้าหมาย' });
      del.onclick = async () => {
        if (!confirm(`ลบเป้าหมาย "${g.name}"?`)) return;
        await api('/goals/' + g.id, { method: 'DELETE' }).catch((e) => alert(e.message));
        load();
      };
      head.append(l, r, del);
      const bar = document.createElement('div');
      bar.className = 'bar';
      const fill = document.createElement('i');
      fill.style.width = pct + '%';
      bar.append(fill);
      wrap.append(head, bar);
      root.append(wrap);
    });
  }

  // ---------- notifications (budget alerts + goal progress) ----------
  function renderNotifs() {
    const items = [];
    const monthStart = ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    const spent = {};
    ALL.filter((x) => x.type === 'expense' && x.date >= monthStart).forEach((x) => (spent[x.category] = (spent[x.category] || 0) + x.amount));
    BUDGETS.forEach((b) => {
      const pct = ((spent[b.category] || 0) / b.monthly_limit) * 100;
      if (pct >= 100) items.push({ cls: 'over', text: `🚨 หมวด "${b.category}" ใช้เกินงบแล้ว (${pct.toFixed(0)}%)` });
      else if (pct >= 80) items.push({ cls: 'warn', text: `⚠️ หมวด "${b.category}" ใช้ไปแล้ว ${pct.toFixed(0)}% ของงบ` });
    });
    GOALS.forEach((g) => { if (g.saved >= g.target) items.push({ cls: 'ok', text: `🎉 ถึงเป้าหมาย "${g.name}" แล้ว` }); });
    const badge = $('bellCount');
    badge.textContent = items.length;
    show(badge, items.length > 0);
    const panel = $('notifPanel');
    panel.replaceChildren();
    if (!items.length) panel.append(Object.assign(document.createElement('div'), { className: 'empty', textContent: 'ไม่มีการแจ้งเตือน' }));
    items.forEach((i) => panel.append(Object.assign(document.createElement('div'), { className: 'item ' + i.cls, textContent: i.text })));
  }
  $('bellBtn').onclick = (e) => { e.stopPropagation(); $('notifPanel').hidden = !$('notifPanel').hidden; };
  document.addEventListener('click', (e) => { if (!$('notifPanel').contains(e.target)) $('notifPanel').hidden = true; });

  $('goalForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/goals', { method: 'POST', body: { name: $('goalName').value, target: $('goalTarget').value, start_date: $('goalStart').value } });
      $('goalName').value = $('goalTarget').value = '';
      load();
    } catch (err) { alert(err.message); }
  });
  $('goalStart').value = ymd(new Date());

  // ---------- theme ----------
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    $('themeBtn').textContent = t === 'light' ? '☀️' : '🌙';
    document.querySelector('meta[name=theme-color]').content = t === 'light' ? '#f4f6fa' : '#0e1116';
    const muted = t === 'light' ? '#667085' : '#8b95a7', grid = t === 'light' ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.06)';
    trend.options.scales.x.ticks.color = trend.options.scales.y.ticks.color = muted;
    trend.options.scales.x.grid.color = trend.options.scales.y.grid.color = grid;
    trend.options.plugins.legend.labels.color = expChart.options.plugins.legend.labels.color = muted;
    trend.update(); expChart.update();
  }
  let theme = 'dark';
  try { theme = localStorage.getItem('ben_theme') || 'dark'; } catch {}
  $('themeBtn').onclick = () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('ben_theme', theme); } catch {}
    applyTheme(theme);
  };
  applyTheme(theme);

  // ---------- mobile drawer ----------
  const setMenu = (open) => { $('drawer').classList.toggle('open', open); show($('scrim'), open); };
  $('menuBtn').onclick = () => setMenu(true);
  $('closeMenu').onclick = $('scrim').onclick = () => setMenu(false);
  $('fabBtn').onclick = () => openDialog(null);

  // ---------- transaction dialog ----------
  const dlg = $('txDialog');
  function openDialog(x) {
    editingId = x ? x.id : null;
    $('txTitle').textContent = x ? 'แก้ไขรายการ' : 'เพิ่มรายการ';
    document.querySelector(`input[name=type][value=${x ? x.type : 'expense'}]`).checked = true;
    $('txAmount').value = x ? x.amount : '';
    $('txCat').value = x ? x.category : '';
    $('txDate').value = x ? x.date : ymd(new Date());
    $('txNote').value = x ? x.note : '';
    show($('txError'), false);
    dlg.showModal();
  }
  $('addBtn').onclick = () => { setMenu(false); openDialog(null); };
  $('txCancel').onclick = () => dlg.close();
  $('txForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      type: document.querySelector('input[name=type]:checked').value,
      amount: $('txAmount').value, category: $('txCat').value, date: $('txDate').value, note: $('txNote').value,
    };
    try {
      await (editingId ? api('/transactions/' + editingId, { method: 'PUT', body }) : api('/transactions', { method: 'POST', body }));
      dlg.close();
      load();
    } catch (err) { $('txError').textContent = err.message; show($('txError'), true); }
  });

  $('budgetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/budgets', { method: 'PUT', body: { category: $('budCat').value, monthly_limit: $('budLimit').value } });
      $('budCat').value = $('budLimit').value = '';
      load();
    } catch (err) { alert(err.message); }
  });

  $('period').addEventListener('change', () => { setMenu(false); load(); });

  $('exportBtn').onclick = () => {
    const esc = (s) => {
      s = String(s);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formulas
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = [['วันที่', 'ประเภท', 'หมวดหมู่', 'โน้ต', 'จำนวน'], ...TX.map((x) => [x.date, x.type === 'income' ? 'รายรับ' : 'รายจ่าย', x.category, x.note, x.amount])];
    const blob = new Blob(['﻿' + rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `ben-${ymd(new Date())}.csv` });
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ---------- boot ----------
  async function boot() {
    try {
      const me = await api('/me');
      show($('loadingView'), false);
      if (!me.user) {
        setAuthMode(me.needsSetup);
        show($('appView'), false);
        show($('loginView'), true);
        return;
      }
      show($('loginView'), false);
      show($('appView'), true);
      $('userName').textContent = me.user.username;
      await load();
    } catch (err) {
      $('loadingView').textContent = 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้: ' + err.message;
    }
  }
  boot();
  setInterval(() => {
    if (document.hidden || dlg.open || $('appView').hidden) return;
    load().catch(() => {});
  }, 30000);
})();
