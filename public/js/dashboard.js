// Everything that draws the main dashboard from window.Ben.S.
(() => {
  const B = window.Ben;
  const { $, show, S, api, el, on, emit, fmtTHB, fmtShort, fmtMoney, ymd, thDate, emojiFor, isSaving, thb, money, currencyOf, acctById, PALETTE } = B;

  // ---------- charts ----------
  const MUTED = '#8a8397', GRID = 'rgba(70,50,100,.07)';
  const lineDs = (label, color, bg, extra = {}) => ({ label, data: [], borderColor: color, backgroundColor: bg, fill: true, tension: .35, pointRadius: 0, borderWidth: 2, ...extra });
  const tipTHB = (c) => c.dataset.label + ': ' + fmtTHB(c.parsed.y);
  const scalesCfg = (stacked) => ({
    x: { stacked, grid: { color: GRID }, ticks: { color: MUTED } },
    y: { stacked, grid: { color: GRID }, ticks: { color: MUTED, callback: fmtShort } },
  });
  const trend = new Chart($('trendChart'), {
    type: 'line',
    data: { labels: [], datasets: [
      lineDs('รายรับ', '#34c78f', 'rgba(52,199,143,.14)'),
      lineDs('รายจ่าย', '#ff7a96', 'rgba(255,122,150,.12)'),
      lineDs('ออม', '#8b7cf6', 'rgba(139,124,246,.10)', { fill: false, borderDash: [5, 4] })] },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { usePointStyle: true, boxWidth: 8, color: MUTED } }, tooltip: { callbacks: { label: tipTHB } } }, scales: scalesCfg(false) },
  });
  const expChart = new Chart($('expenseChart'), {
    type: 'doughnut',
    data: { labels: [], datasets: [{ data: [], backgroundColor: PALETTE, borderWidth: 0, hoverOffset: 6, borderRadius: 6 }] },
    options: { maintainAspectRatio: false, cutout: '62%',
      plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, color: MUTED, font: { size: 11 } } }, tooltip: { callbacks: { label: (c) => c.label + ': ' + fmtTHB(c.parsed) } } } },
  });
  const monthChart = new Chart($('monthChart'), {
    type: 'bar',
    data: { labels: [], datasets: [
      { label: 'รายรับ', data: [], backgroundColor: '#5ed6a5', borderRadius: 6 },
      { label: 'รายจ่าย', data: [], backgroundColor: '#ff8fab', borderRadius: 6 },
      { label: 'ออม', data: [], backgroundColor: '#8b7cf6', borderRadius: 6 }] },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { usePointStyle: true, boxWidth: 8, color: MUTED } }, tooltip: { callbacks: { label: tipTHB } } }, scales: scalesCfg(false) },
  });

  on('theme', (t) => {
    const muted = t === 'light' ? '#8a8397' : '#9d96ae', grid = t === 'light' ? 'rgba(70,50,100,.07)' : 'rgba(255,255,255,.06)';
    for (const ch of [trend, monthChart]) {
      ch.options.scales.x.ticks.color = ch.options.scales.y.ticks.color = muted;
      ch.options.scales.x.grid.color = ch.options.scales.y.grid.color = grid;
      ch.options.plugins.legend.labels.color = muted;
      ch.update();
    }
    expChart.options.plugins.legend.labels.color = muted;
    expChart.update();
  });

  // ---------- numbers ----------
  function totals(list) {
    let inc = 0, exp = 0, saved = 0; // exp = spending only; saved = money moved into savings categories
    list.forEach((x) => (x.type === 'income' ? (inc += thb(x)) : isSaving(x) ? (saved += thb(x)) : (exp += thb(x))));
    return { inc, exp, saved, net: inc - exp - saved };
  }

  function renderKpis() {
    const { inc, exp, saved, net } = totals(S.TX);
    $('kIncome').textContent = fmtTHB(inc);
    $('kExpense').textContent = fmtTHB(exp);
    $('kSaved').textContent = fmtTHB(saved);
    const kn = $('kNet');
    kn.textContent = (net >= 0 ? '+' : '−') + fmtTHB(Math.abs(net));
    kn.style.color = net >= 0 ? 'var(--income)' : 'var(--expense)';
    $('kCount').textContent = inc ? `อัตราการออม ${(((inc - exp) / inc) * 100).toFixed(1)}%` : `${S.TX.length.toLocaleString('th-TH')} รายการ`;

    // where did the income go: spending / savings / left over
    const box = $('flowBox');
    show(box, inc > 0);
    if (inc > 0) {
      const pct = (v) => Math.max(0, (v / inc) * 100);
      const left = Math.max(0, inc - exp - saved);
      const total = Math.max(inc, exp + saved);
      $('flowSpend').style.width = (exp / total) * 100 + '%';
      $('flowSaved').style.width = (saved / total) * 100 + '%';
      $('flowLeft').style.width = (left / total) * 100 + '%';
      $('flowLegend').textContent = `💸 ใช้จ่าย ${pct(exp).toFixed(0)}% · 🐷 ออม ${pct(saved).toFixed(0)}% · 🪙 เหลือ ${pct(left).toFixed(0)}%` + (exp + saved > inc ? ' · ⚠️ ใช้เกินรายรับ' : '');
    }
  }

  function renderCharts() {
    const byDay = {};
    [...S.TX].reverse().forEach((x) => {
      const d = (byDay[x.date] ??= { i: 0, e: 0, s: 0 });
      x.type === 'income' ? (d.i += thb(x)) : isSaving(x) ? (d.s += thb(x)) : (d.e += thb(x));
    });
    const days = Object.keys(byDay);
    trend.data.labels = days.map((d) => new Date(d + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }));
    trend.data.datasets[0].data = days.map((d) => byDay[d].i);
    trend.data.datasets[1].data = days.map((d) => byDay[d].e);
    trend.data.datasets[2].data = days.map((d) => byDay[d].s);
    trend.data.datasets.forEach((ds) => (ds.pointRadius = days.length < 4 ? 4 : 0));
    trend.update();

    const ex = {};
    S.TX.filter((x) => x.type === 'expense' && !isSaving(x)).forEach((x) => (ex[x.category] = (ex[x.category] || 0) + thb(x)));
    expChart.data.labels = Object.keys(ex);
    expChart.data.datasets[0].data = Object.values(ex);
    expChart.update();

    // last 12 months, always (independent of the period picker)
    const now = new Date(), months = [];
    for (let i = 11; i >= 0; i--) months.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
    const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const m = Object.fromEntries(months.map((d) => [key(d), { i: 0, e: 0, s: 0 }]));
    S.ALL.forEach((x) => { const r = m[x.date.slice(0, 7)]; if (r) x.type === 'income' ? (r.i += thb(x)) : isSaving(x) ? (r.s += thb(x)) : (r.e += thb(x)); });
    monthChart.data.labels = months.map((d) => d.toLocaleDateString('th-TH', { month: 'short', year: '2-digit' }));
    monthChart.data.datasets[0].data = months.map((d) => m[key(d)].i);
    monthChart.data.datasets[1].data = months.map((d) => m[key(d)].e);
    monthChart.data.datasets[2].data = months.map((d) => m[key(d)].s);
    monthChart.update();
  }

  // ---------- budgets ----------
  const periodStart = (b) => (b.period === 'week' ? B.weekStartOf() : B.monthStartOf());
  function budgetSpent(b) {
    const from = periodStart(b);
    return S.ALL.filter((x) => x.type === 'expense' && x.category === b.category && x.date >= from).reduce((s, x) => s + thb(x), 0);
  }

  function renderBudgets() {
    const root = $('budgetList');
    root.replaceChildren();
    if (!S.BUDGETS.length) { root.append(el('div', { className: 'hint', textContent: 'ยังไม่ได้ตั้งงบประมาณ' })); return; }
    S.BUDGETS.forEach((b) => {
      const s = budgetSpent(b), pct = (s / b.limit) * 100;
      const del = el('button', { className: 'row-btn', textContent: '🗑', title: 'ลบงบนี้' });
      del.onclick = async () => {
        await api('/budgets', { method: 'PUT', body: { category: b.category, period: b.period, limit: 0 } }).catch((e) => alert(e.message));
        emit('reload');
      };
      const tag = el('span', { className: 'tag', textContent: b.period === 'week' ? 'สัปดาห์' : 'เดือน' });
      const fill = el('i');
      fill.style.width = Math.min(pct, 100) + '%';
      root.append(el('div', { className: 'bud' },
        el('div', { className: 'bud-head' }, el('span', { textContent: emojiFor(b.category, 'expense') + ' ' + b.category + ' ' }, tag),
          el('span', { textContent: `${fmtTHB(s)} / ${fmtTHB(b.limit)}` }), del),
        el('div', { className: 'bar' + (pct >= 100 ? ' over' : pct >= 80 ? ' warn' : '') }, fill)));
    });
  }

  $('budgetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/budgets', { method: 'PUT', body: { category: $('budCat').value, period: $('budPeriod').value, limit: $('budLimit').value } });
      $('budCat').value = $('budLimit').value = '';
      B.toast('บันทึกงบแล้ว ✨');
      emit('reload');
    } catch (err) { alert(err.message); }
  });

  // ---------- goals ----------
  function renderGoals() {
    const root = $('goalList');
    root.replaceChildren();
    if (!S.GOALS.length) { root.append(el('div', { className: 'hint', textContent: 'ยังไม่มีเป้าหมาย' })); return; }
    S.GOALS.forEach((g) => {
      const saved = Math.max(g.saved, 0), pct = Math.min((saved / g.target) * 100, 100);
      const del = el('button', { className: 'row-btn', textContent: '🗑', title: 'ลบเป้าหมาย' });
      del.onclick = async () => {
        if (!confirm(`ลบเป้าหมาย "${g.name}"?`)) return;
        await api('/goals/' + g.id, { method: 'DELETE' }).catch((e) => alert(e.message));
        emit('reload');
      };
      const fill = el('i');
      fill.style.width = pct + '%';
      root.append(el('div', { className: 'goal' + (saved >= g.target ? ' done' : '') },
        el('div', { className: 'goal-head' }, el('span', { textContent: (saved >= g.target ? '🎉 ' : '🎯 ') + g.name }),
          el('span', { textContent: `${fmtTHB(saved)} / ${fmtTHB(g.target)} (${pct.toFixed(0)}%)` }), del),
        el('div', { className: 'bar' }, fill)));
    });
  }
  $('goalForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/goals', { method: 'POST', body: { name: $('goalName').value, target: $('goalTarget').value, start_date: $('goalStart').value } });
      $('goalName').value = $('goalTarget').value = '';
      B.toast('เพิ่มเป้าหมายแล้ว 🎯');
      emit('reload');
    } catch (err) { alert(err.message); }
  });
  $('goalStart').value = B.todayStr();

  // ---------- notifications: in-app bell, plus an OS notification when permitted ----------
  let alerted = new Set();
  try { alerted = new Set(JSON.parse(localStorage.getItem('ben_alerted') || '[]')); } catch { /* private mode */ }
  function osNotify(key, title, body) {
    if (alerted.has(key)) return;
    alerted.add(key);
    try { localStorage.setItem('ben_alerted', JSON.stringify([...alerted].slice(-100))); } catch { /* ignore */ }
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const opts = { body, icon: '/icons/icon-192.png', tag: key };
    if (navigator.serviceWorker && navigator.serviceWorker.ready) navigator.serviceWorker.ready.then((r) => r.showNotification(title, opts)).catch(() => new Notification(title, opts));
    else new Notification(title, opts);
  }

  function renderNotifs() {
    const items = [];
    S.BUDGETS.forEach((b) => {
      const pct = (budgetSpent(b) / b.limit) * 100, per = b.period === 'week' ? 'สัปดาห์นี้' : 'เดือนนี้', start = periodStart(b);
      if (pct >= 100) { items.push({ cls: 'over', text: `🚨 หมวด "${b.category}" ใช้เกินงบ${per}แล้ว (${pct.toFixed(0)}%)` }); osNotify(`${b.category}|${b.period}|${start}|100`, 'ใช้เกินงบแล้ว 🚨', `หมวด "${b.category}" ใช้ไป ${pct.toFixed(0)}% ของงบ${per}`); }
      else if (pct >= 80) { items.push({ cls: 'warn', text: `⚠️ หมวด "${b.category}" ใช้ไปแล้ว ${pct.toFixed(0)}% ของงบ${per}` }); osNotify(`${b.category}|${b.period}|${start}|80`, 'ใกล้ถึงงบแล้ว ⚠️', `หมวด "${b.category}" ใช้ไป ${pct.toFixed(0)}% ของงบ${per}`); }
    });
    S.GOALS.forEach((g) => { if (g.saved >= g.target) items.push({ cls: 'ok', text: `🎉 ถึงเป้าหมาย "${g.name}" แล้ว` }); });
    const badge = $('bellCount');
    badge.textContent = items.length;
    show(badge, items.length > 0);
    const panel = $('notifPanel');
    panel.replaceChildren();
    if (!items.length) panel.append(el('div', { className: 'empty', textContent: 'ไม่มีการแจ้งเตือน' }));
    items.forEach((i) => panel.append(el('div', { className: 'item ' + i.cls, textContent: i.text })));
    if ('Notification' in window && Notification.permission === 'default') {
      const btn = el('button', { className: 'btn-sm soft', textContent: '🔔 เปิดแจ้งเตือนบนอุปกรณ์นี้', type: 'button' });
      btn.onclick = async () => { await Notification.requestPermission(); renderNotifs(); };
      panel.append(el('div', { className: 'notif-foot' }, btn));
    }
  }
  $('bellBtn').onclick = (e) => { e.stopPropagation(); $('notifPanel').hidden = !$('notifPanel').hidden; };
  document.addEventListener('click', (e) => { if (!$('notifPanel').contains(e.target)) $('notifPanel').hidden = true; });

  // ---------- transaction rows (also used by the calendar) ----------
  function txRow(x) {
    const cur = currencyOf(x), acct = acctById(x.account_id);
    const meta = [thDate(x.date), acct && acct.name, x.note].filter(Boolean).join(' · ');
    const amtText = (x.type === 'income' ? '+' : isSaving(x) ? '' : '−') + money(x);
    const amt = el('div', { className: 'amt' }, amtText);
    if (cur !== 'THB') amt.append(el('small', { textContent: '≈ ' + fmtTHB(thb(x)) }));
    const acts = el('div', { className: 'acts' });
    if (x.image_key) {
      const pic = el('button', { className: 'row-btn', textContent: '📎', title: 'ดูรูปแนบ' });
      pic.onclick = () => B.openLightbox('/api/uploads/' + x.image_key);
      acts.append(pic);
    }
    const edit = el('button', { className: 'row-btn', textContent: '✏️', title: 'แก้ไข' });
    edit.onclick = () => emit('edit-tx', x);
    const del = el('button', { className: 'row-btn', textContent: '🗑️', title: 'ลบ' });
    del.onclick = async () => {
      if (!confirm(`ลบรายการ "${x.category}" ${money(x)}?`)) return;
      await api('/transactions/' + x.id, { method: 'DELETE' }).catch((e) => alert(e.message));
      emit('reload');
    };
    acts.append(edit, del);
    return el('div', { className: 'tx ' + (isSaving(x) ? 'saving' : x.type) },
      el('div', { className: 'bubble', textContent: emojiFor(x.category, x.type) }),
      el('div', { className: 'info' }, el('div', { className: 'title', textContent: x.category }), el('div', { className: 'meta', textContent: meta })),
      amt, acts);
  }

  function renderList() {
    const root = $('txList');
    root.replaceChildren();
    $('txHint').textContent = S.TX.length > 100 ? `แสดง 100 จาก ${S.TX.length} รายการล่าสุด` : '';
    if (!S.TX.length) { root.append(el('div', { className: 'empty-state', textContent: '🌱 ยังไม่มีรายการในช่วงนี้ กด ＋ เพื่อเริ่มจดได้เลย' })); return; }
    S.TX.slice(0, 100).forEach((x) => root.append(txRow(x)));
  }

  function renderCatList() {
    const cats = new Set([...B.DEFAULT_CATS, ...S.ALL.map((x) => x.category), ...S.BUDGETS.map((b) => b.category)]);
    $('catList').replaceChildren(...[...cats].map((c) => el('option', { value: c })));
  }

  on('render', () => { renderKpis(); renderCharts(); renderBudgets(); renderGoals(); renderNotifs(); renderList(); renderCatList(); });
  Object.assign(B, { txRow, totals });
})();
