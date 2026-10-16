// Shared state + helpers. Every other file in /js reads from window.Ben.
window.Ben = (() => {
  const $ = (id) => document.getElementById(id);
  const show = (el, on) => (el.hidden = !on);

  // ---------- tiny event bus ----------
  const handlers = {};
  const on = (ev, fn) => (handlers[ev] ||= []).push(fn);
  const emit = (ev, ...args) => (handlers[ev] || []).forEach((fn) => { try { fn(...args); } catch (e) { console.error(`[${ev}]`, e); } });

  // ---------- state ----------
  const S = { user: null, ALL: [], TX: [], BUDGETS: [], GOALS: [], ACCOUNTS: [] };

  // ---------- formatting ----------
  const ZERO_DECIMAL = ['THB', 'JPY', 'KRW', 'VND', 'IDR'];
  const fmtMoney = (n, cur = 'THB') => new Intl.NumberFormat('th-TH', { style: 'currency', currency: cur, maximumFractionDigits: ZERO_DECIMAL.includes(cur) ? 0 : 2 }).format(n);
  const fmtTHB = (n) => fmtMoney(n, 'THB');
  const fmtShort = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : '' + n);
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const thDate = (s) => new Date(s + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
  const thLong = (d) => d.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
  const monthStartOf = (d = new Date()) => ymd(new Date(d.getFullYear(), d.getMonth(), 1));
  const weekStartOf = (d = new Date()) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return ymd(x); }; // Monday

  // ---------- categories ----------
  const EMOJI_RULES = [[/อาหาร|กิน|ข้าว|ร้าน/, '🍜'], [/เครื่องดื่ม|กาแฟ|ชา|น้ำ(?!มัน|ไฟ)/, '🧋'], [/เดินทาง|รถ|น้ำมัน|แท็กซี่|บีทีเอส|เรือ/, '🚌'], [/ช้อป|เสื้อ|ของใช้/, '🛍️'], [/ที่อยู่|บ้าน|เช่า|ห้อง|คอนโด/, '🏠'], [/บิล|สาธารณูปโภค|ไฟ|เน็ต|โทรศัพท์/, '🧾'], [/สุขภาพ|ยา|หมอ|โรงพยาบาล|ฟิตเนส/, '💊'], [/บันเทิง|หนัง|เกม|คอนเสิร์ต/, '🎬'], [/การศึกษา|เรียน|หนังสือ|คอร์ส/, '📚'], [/ท่องเที่ยว|เที่ยว|โรงแรม|ตั๋วเครื่องบิน/, '✈️'], [/โอน/, '💌'], [/ออม|ลงทุน|หุ้น|กองทุน|เงินเก็บ|ฉุกเฉิน/, '🐷'], [/เงินเดือน|โบนัส/, '💰'], [/ฟรีแลนซ์|รายได้|ขาย/, '🤑'], [/ของขวัญ|บริจาค/, '🎁'], [/สัตว์|แมว|หมา/, '🐱']];
  const emojiFor = (cat, type) => { for (const [re, e] of EMOJI_RULES) if (re.test(cat)) return e; return type === 'income' ? '💸' : '🪙'; };
  const SAVING_CATS = ['ออมเงิน', 'เงินฉุกเฉิน', 'กองทุน/ลงทุน', 'เงินเก็บเที่ยว'];
  const SAVING_RE = /ออม|ลงทุน|กองทุน|เงินเก็บ|ฉุกเฉิน/; // keep in sync with savingCond() in src/shared.js
  const isSaving = (x) => x.type === 'expense' && SAVING_RE.test(x.category);
  const SPEND_CHIPS = ['อาหาร', 'เครื่องดื่ม', 'เดินทาง', 'ช้อปปิ้ง', 'ที่อยู่อาศัย', 'บิล/สาธารณูปโภค', 'สุขภาพ', 'บันเทิง', 'การศึกษา', 'ท่องเที่ยว', 'โอนเงิน', 'อื่นๆ'];
  const INCOME_CHIPS = ['เงินเดือน', 'โบนัส', 'ฟรีแลนซ์', 'ขายของ', 'ดอกเบี้ย/ปันผล', 'อื่นๆ'];
  const DEFAULT_CATS = [...new Set([...SPEND_CHIPS, ...SAVING_CATS, ...INCOME_CHIPS])];
  const PALETTE = ['#ff8fab', '#ffc46b', '#8b7cf6', '#5ed6a5', '#7cc4ff', '#f9a8d4', '#a3e635', '#fb923c', '#c4b5fd', '#94a3b8'];

  // ---------- accounts / currency ----------
  const acctById = (id) => (id == null ? null : S.ACCOUNTS.find((a) => a.id === id) || null);
  const currencyOf = (x) => (acctById(x.account_id) || {}).currency || 'THB';
  const thb = (x) => x.amount * ((acctById(x.account_id) || {}).rate_to_thb || 1); // every total is shown in baht
  const money = (x) => fmtMoney(x.amount, currencyOf(x));

  // ---------- network ----------
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
  async function postFile(path, blob) {
    const fd = new FormData();
    fd.append('file', blob, 'photo.jpg');
    const res = await fetch('/api' + path, { method: 'POST', body: fd, credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'อัปโหลดไม่สำเร็จ');
    return data;
  }

  // ---------- small UI helpers ----------
  const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
  }
  function openLightbox(url) { $('lightboxImg').src = url; $('lightbox').showModal(); }
  $('lightboxClose').onclick = () => $('lightbox').close();
  $('lightbox').addEventListener('click', (e) => { if (e.target === $('lightbox')) $('lightbox').close(); });

  const setMenu = (open) => { $('drawer').classList.toggle('open', open); show($('scrim'), open); };
  const setMsg = (id, text, ok) => { const e = $(id); e.textContent = text || ''; e.className = ok ? 'ok' : 'err'; show(e, !!text); };
  const todayStr = () => ymd(new Date());

  return {
    $, show, on, emit, S, api, postFile, el, toast, openLightbox, setMenu, setMsg, todayStr,
    fmtMoney, fmtTHB, fmtShort, ymd, thDate, thLong, monthStartOf, weekStartOf,
    emojiFor, SAVING_CATS, SAVING_RE, isSaving, SPEND_CHIPS, INCOME_CHIPS, DEFAULT_CATS, PALETTE,
    acctById, currencyOf, thb, money,
  };
})();
