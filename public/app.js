(() => {
  const $ = (id) => document.getElementById(id);
  const show = (el, on) => (el.hidden = !on);
  const fmtTHB = (n) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }).format(n);
  const fmtShort = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : '' + n);
  const EMOJI_RULES = [[/อาหาร|กิน|ข้าว|ร้าน/, '🍜'], [/เครื่องดื่ม|กาแฟ|ชา|น้ำ(?!มัน|ไฟ)/, '🧋'], [/เดินทาง|รถ|น้ำมัน|แท็กซี่|บีทีเอส|เรือ/, '🚌'], [/ช้อป|เสื้อ|ของใช้/, '🛍️'], [/ที่อยู่|บ้าน|เช่า|ห้อง|คอนโด/, '🏠'], [/บิล|สาธารณูปโภค|ไฟ|เน็ต|โทรศัพท์/, '🧾'], [/สุขภาพ|ยา|หมอ|โรงพยาบาล|ฟิตเนส/, '💊'], [/บันเทิง|หนัง|เกม|คอนเสิร์ต/, '🎬'], [/การศึกษา|เรียน|หนังสือ|คอร์ส/, '📚'], [/ท่องเที่ยว|เที่ยว|โรงแรม|ตั๋วเครื่องบิน/, '✈️'], [/โอน/, '💌'], [/ออม|ลงทุน|หุ้น|กองทุน/, '🐷'], [/เงินเดือน|โบนัส/, '💰'], [/ฟรีแลนซ์|รายได้|ขาย/, '🤑'], [/ของขวัญ|บริจาค/, '🎁'], [/สัตว์|แมว|หมา/, '🐱']];
  const emojiFor = (cat, type) => { for (const [re, e] of EMOJI_RULES) if (re.test(cat)) return e; return type === 'income' ? '💸' : '🪙'; };
  const DEFAULT_CATS = ['อาหาร', 'เครื่องดื่ม', 'เดินทาง', 'ช้อปปิ้ง', 'ที่อยู่อาศัย', 'บิล/สาธารณูปโภค', 'สุขภาพ', 'บันเทิง', 'การศึกษา', 'โอนเงิน', 'ท่องเที่ยว', 'ออม/ลงทุน', 'เงินเดือน', 'อื่นๆ'];
  const PALETTE = ['#ff8fab', '#ffc46b', '#8b7cf6', '#5ed6a5', '#7cc4ff', '#f9a8d4', '#a3e635', '#fb923c', '#c4b5fd', '#94a3b8'];
  const _OLD_PALETTE = ['#f87171', '#fbbf24', '#60a5fa', '#34d399', '#a78bfa', '#f472b6', '#22d3ee', '#94a3b8', '#fb923c', '#a3e635'];
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
      { label: 'รายรับ', data: [], borderColor: '#34c78f', backgroundColor: 'rgba(52,199,143,.14)', fill: true, tension: .35, pointRadius: 0, borderWidth: 2 },
      { label: 'รายจ่าย', data: [], borderColor: '#ff7a96', backgroundColor: 'rgba(255,122,150,.12)', fill: true, tension: .35, pointRadius: 0, borderWidth: 2 }] },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { usePointStyle: true, boxWidth: 8, color: '#8b95a7' } }, tooltip: { callbacks: { label: (c) => c.dataset.label + ': ' + fmtTHB(c.parsed.y) } } },
      scales: { x: { grid: { color: 'rgba(255,255,255,.06)' }, ticks: { color: '#8b95a7' } }, y: { grid: { color: 'rgba(255,255,255,.06)' }, ticks: { color: '#8b95a7', callback: fmtShort } } } },
  });
  const expChart = new Chart($('expenseChart'), {
    type: 'doughnut',
    data: { labels: [], datasets: [{ data: [], backgroundColor: PALETTE, borderWidth: 0, hoverOffset: 6, borderRadius: 6 }] },
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
    const cats = new Set([...DEFAULT_CATS, ...ALL.map((x) => x.category), ...BUDGETS.map((b) => b.category)]);
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
      const l = document.createElement('span'); l.textContent = emojiFor(b.category, 'expense') + ' ' + b.category;
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
    const root = $('txList');
    root.replaceChildren();
    $('txHint').textContent = TX.length > 100 ? `แสดง 100 จาก ${TX.length} รายการล่าสุด` : '';
    if (!TX.length) { root.append(Object.assign(document.createElement('div'), { className: 'empty-state', textContent: '🌱 ยังไม่มีรายการในช่วงนี้ กด ＋ เพื่อเริ่มจดได้เลย' })); return; }
    TX.slice(0, 100).forEach((x) => {
      const row = document.createElement('div');
      row.className = 'tx ' + x.type;
      const bubble = Object.assign(document.createElement('div'), { className: 'bubble', textContent: emojiFor(x.category, x.type) });
      const info = document.createElement('div');
      info.className = 'info';
      info.append(Object.assign(document.createElement('div'), { className: 'title', textContent: x.category }),
        Object.assign(document.createElement('div'), { className: 'meta', textContent: thDate(x.date) + (x.note ? ' · ' + x.note : '') }));
      const amt = Object.assign(document.createElement('div'), { className: 'amt', textContent: (x.type === 'income' ? '+' : '−') + fmtTHB(x.amount) });
      const acts = document.createElement('div');
      acts.className = 'acts';
      if (x.image_key) {
        const pic = Object.assign(document.createElement('button'), { className: 'row-btn', textContent: '📎', title: 'ดูรูปแนบ' });
        pic.onclick = () => openLightbox('/api/uploads/' + x.image_key);
        acts.append(pic);
      }
      const edit = Object.assign(document.createElement('button'), { className: 'row-btn', textContent: '✏️', title: 'แก้ไข' });
      edit.onclick = () => openDialog(x);
      const del = Object.assign(document.createElement('button'), { className: 'row-btn', textContent: '🗑️', title: 'ลบ' });
      del.onclick = async () => {
        if (!confirm(`ลบรายการ "${x.category}" ${fmtTHB(x.amount)}?`)) return;
        await api('/transactions/' + x.id, { method: 'DELETE' }).catch((e) => alert(e.message));
        load();
      };
      acts.append(edit, del);
      row.append(bubble, info, amt, acts);
      root.append(row);
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
    $('themeBtn').textContent = t === 'light' ? '🌙' : '☀️';
    document.querySelector('meta[name=theme-color]').content = t === 'light' ? '#faf7f2' : '#15131b';
    const muted = t === 'light' ? '#8a8397' : '#9d96ae', grid = t === 'light' ? 'rgba(70,50,100,.07)' : 'rgba(255,255,255,.06)';
    trend.options.scales.x.ticks.color = trend.options.scales.y.ticks.color = muted;
    trend.options.scales.x.grid.color = trend.options.scales.y.grid.color = grid;
    trend.options.plugins.legend.labels.color = expChart.options.plugins.legend.labels.color = muted;
    trend.update(); expChart.update();
  }
  let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  try { theme = localStorage.getItem('ben_theme') || theme; } catch {}
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

  // ---------- images: resize, upload, slip scan ----------
  const MAX_SIDE = 1400;
  async function shrink(file) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch { bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); }); }
    const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight, k = Math.min(1, MAX_SIDE / Math.max(w, h));
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * k); cv.height = Math.round(h * k);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    return new Promise((res, rej) => cv.toBlob((bl) => (bl ? res(bl) : rej(new Error('ย่อรูปไม่สำเร็จ'))), 'image/jpeg', 0.85));
  }
  async function postImage(path, blob) {
    const fd = new FormData();
    fd.append('file', blob, 'photo.jpg');
    const res = await fetch('/api' + path, { method: 'POST', body: fd, credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'อัปโหลดไม่สำเร็จ');
    return data;
  }

  // image state of the open dialog: key currently attached, the one it had on open, keys uploaded this session
  let imageKey = null, originalKey = null, sessionKeys = new Set();
  function setImage(key) {
    imageKey = key;
    show($('preview'), !!key);
    if (key) $('previewImg').src = '/api/uploads/' + key;
  }
  const dropUnsaved = (keep) => {
    sessionKeys.forEach((k) => { if (k !== keep) api('/uploads/' + k, { method: 'DELETE' }).catch(() => {}); });
    sessionKeys = new Set();
  };
  async function attach(blob) {
    const { key } = await postImage('/uploads', blob);
    sessionKeys.add(key);
    setImage(key);
  }
  const scanMsg = (t, err) => { const el = $('scanStatus'); el.textContent = t || ''; el.style.color = err ? 'var(--expense)' : ''; show(el, !!t); };

  async function handleSlip(file) {
    if (!file) return;
    const btns = [$('dlgScan'), $('dlgAttach'), $('txSave')];
    btns.forEach((x) => (x.disabled = true));
    scanMsg('✨ กำลังอ่านสลิป… (อาจใช้เวลา 5–15 วินาที)');
    try {
      const blob = await shrink(file);
      const [scan] = await Promise.all([
        postImage('/slip/scan', blob).catch((e) => ({ _err: e.message })),
        attach(blob).catch(() => {}),
      ]);
      document.querySelector('input[name=type][value=expense]').checked = true;
      if (scan._err) { scanMsg('😅 ' + scan._err + ' (แนบรูปไว้ให้แล้ว กรอกเองได้เลย)', true); return; }
      if (scan.amount) $('txAmount').value = scan.amount;
      if (scan.category) $('txCat').value = scan.category;
      if (scan.date) $('txDate').value = scan.date;
      if (scan.note) $('txNote').value = scan.note;
      const missing = [!scan.amount && 'จำนวนเงิน', !scan.date && 'วันที่'].filter(Boolean);
      scanMsg(missing.length ? `🧐 อ่านได้บางส่วน ช่วยกรอก${missing.join(' และ ')}เพิ่มนะ` : '✅ อ่านสลิปแล้ว ตรวจความถูกต้องก่อนบันทึกนะ');
    } catch (err) {
      scanMsg('😅 ' + err.message, true);
    } finally {
      btns.forEach((x) => (x.disabled = false));
    }
  }
  $('slipInput').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; handleSlip(f); };
  $('dlgScan').onclick = () => $('slipInput').click();
  $('dlgAttach').onclick = () => $('attachInput').click();
  $('attachInput').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { scanMsg('⏳ กำลังอัปโหลดรูป…'); await attach(await shrink(f)); scanMsg(''); }
    catch (err) { scanMsg('😅 ' + err.message, true); }
  };
  $('removeImg').onclick = () => {
    const k = imageKey;
    setImage(null);
    if (k && sessionKeys.has(k)) { sessionKeys.delete(k); api('/uploads/' + k, { method: 'DELETE' }).catch(() => {}); }
  };
  $('previewImg').onclick = () => imageKey && openLightbox('/api/uploads/' + imageKey);

  function openLightbox(url) { $('lightboxImg').src = url; $('lightbox').showModal(); }
  $('lightboxClose').onclick = () => $('lightbox').close();
  $('lightbox').addEventListener('click', (e) => { if (e.target === $('lightbox')) $('lightbox').close(); });

  // ---------- transaction dialog ----------
  const dlg = $('txDialog');
  function openDialog(x) {
    editingId = x ? x.id : null;
    $('txTitle').textContent = x ? '✏️ แก้ไขรายการ' : '➕ เพิ่มรายการ';
    document.querySelector(`input[name=type][value=${x ? x.type : 'expense'}]`).checked = true;
    $('txAmount').value = x ? x.amount : '';
    $('txCat').value = x ? x.category : '';
    $('txDate').value = x ? x.date : ymd(new Date());
    $('txNote').value = x ? x.note : '';
    sessionKeys = new Set();
    originalKey = x ? x.image_key || null : null;
    setImage(originalKey);
    scanMsg('');
    show($('txError'), false);
    dlg.showModal();
  }
  $('addBtn').onclick = () => { setMenu(false); openDialog(null); };
  $('scanBtn').onclick = () => { setMenu(false); openDialog(null); $('slipInput').click(); };
  const closeDialog = () => { dropUnsaved(null); dlg.close(); };
  $('txCancel').onclick = closeDialog;
  dlg.addEventListener('cancel', () => dropUnsaved(null)); // Esc key
  $('txForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      type: document.querySelector('input[name=type]:checked').value,
      amount: $('txAmount').value, category: $('txCat').value, date: $('txDate').value, note: $('txNote').value,
      image_key: imageKey,
    };
    try {
      await (editingId ? api('/transactions/' + editingId, { method: 'PUT', body }) : api('/transactions', { method: 'POST', body }));
      dropUnsaved(imageKey);
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
      const hr = new Date().getHours();
      $('greeting').textContent = `${hr < 12 ? 'อรุณสวัสดิ์' : hr < 18 ? 'สวัสดียามบ่าย' : 'สวัสดียามเย็น'} ${me.user.username} 👋`;
      await load();
      if (new URLSearchParams(location.search).get('add')) { history.replaceState(null, '', '/'); openDialog(null); }
    } catch (err) {
      $('loadingView').textContent = 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้: ' + err.message;
    }
  }
  // ---------- PWA ----------
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; show($('installBtn'), true); });
  window.addEventListener('appinstalled', () => { deferredInstall = null; show($('installBtn'), false); });
  $('installBtn').onclick = async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice.catch(() => {});
    deferredInstall = null;
    show($('installBtn'), false);
  };
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone) show($('iosHint'), true);

  boot();
  setInterval(() => {
    if (document.hidden || dlg.open || $('appView').hidden) return;
    load().catch(() => {});
  }, 30000);
})();
