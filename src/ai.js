import { CATEGORIES } from './slip.js';
import { AMT_THB, JOIN_ACCT, savingCond, extractJsonValue, validDate } from './shared.js';
import { goalsWithProgress, accountsWithBalance } from './queries.js';

const TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const DAILY_AI_LIMIT = 150;
const SPEND_CATS = [...CATEGORIES, 'ท่องเที่ยว', 'ออมเงิน', 'เงินฉุกเฉิน', 'กองทุน/ลงทุน', 'เงินเก็บเที่ยว'];
const INCOME_CATS = ['เงินเดือน', 'โบนัส', 'ฟรีแลนซ์', 'ขายของ', 'ดอกเบี้ย/ปันผล', 'อื่นๆ'];

// Cap AI usage per user per day so a bug or a stolen session can't run up the bill
export async function aiAllowed(env, uid) {
  const day = new Date().toISOString().slice(0, 10);
  const r = await env.DB.prepare(
    'INSERT INTO ai_usage (user_id, day, n) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET n = n + 1 RETURNING n'
  ).bind(uid, day).first();
  return r.n <= DAILY_AI_LIMIT;
}

// Smart categorisation: the category the user most often gave to notes containing this text
export async function learnCategory(env, uid, text, type = 'expense') {
  const q = String(text || '').split('·')[0].trim().toLowerCase();
  if (q.length < 2) return null;
  const esc = q.replace(/[\\%_]/g, (m) => '\\' + m);
  const sql = (like) => `SELECT category, COUNT(*) AS n FROM transactions WHERE user_id = ? AND type = ? AND LOWER(note) LIKE ? ESCAPE '\\' GROUP BY category ORDER BY n DESC, MAX(date) DESC LIMIT 1`;
  const prefix = await env.DB.prepare(sql()).bind(uid, type, esc + '%').first();
  if (prefix) return { category: prefix.category, count: prefix.n, tier: 'prefix' };
  const contains = await env.DB.prepare(sql()).bind(uid, type, '%' + esc + '%').first();
  return contains ? { category: contains.category, count: contains.n, tier: 'contains' } : null;
}

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (isoDate, n) => { const d = new Date(isoDate + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const todayOr = (s) => (validDate(s) ? s : iso(new Date(Date.now() + 7 * 3600e3))); // default: Thailand time

const NL_PROMPT = (text, accounts) => `คุณคือผู้ช่วยจดรายรับรายจ่ายภาษาไทย แยกข้อความของผู้ใช้เป็นรายการธุรกรรมทีละรายการ
ตอบเป็น JSON array เท่านั้น ห้ามมีข้อความอื่น แต่ละรายการมีคีย์:
- "type": "expense" หรือ "income"
- "amount": จำนวนเงินเป็นตัวเลข
- "category": เลือกจากรายการเท่านั้น
- "note": คำอธิบายสั้นๆ เช่น ชื่อร้านหรือสิ่งที่ซื้อ (ไม่ต้องใส่จำนวนเงิน)
- "days_ago": กี่วันที่ผ่านมา (วันนี้/เมื่อเช้า/เมื่อกี้ = 0, เมื่อวาน/เมื่อคืน = 1, เมื่อวานซืน = 2, ไม่ระบุ = 0)
- "day": วันที่ในเดือนถ้าผู้ใช้ระบุชัดเจน ไม่งั้น null
- "month": เดือน 1-12 ถ้าระบุ ไม่งั้น null
- "account": ชื่อบัญชีที่ผู้ใช้พูดถึง (ถ้ามี) ไม่งั้น ""

หมวดรายจ่าย: ${SPEND_CATS.join(', ')}
หมวดรายรับ: ${INCOME_CATS.join(', ')}
บัญชีของผู้ใช้: ${accounts.length ? accounts.join(', ') : '(ไม่มี)'}

กฎ: จ่าย/ซื้อ/กิน/ค่า... = expense, ได้รับ/เงินเดือน/โอนเข้า/ขายได้ = income, ออมเงิน/ฝากเก็บ = หมวด ออมเงิน
ห้ามแต่งรายการที่ไม่มีในข้อความ ถ้ารายการไหนไม่มีจำนวนเงินให้ข้าม
ระวัง: "เมื่อวานซื้อ" = เมื่อวาน + ซื้อ (days_ago = 1) ส่วน "เมื่อวานซืน" สะกดด้วย ซืน เท่านั้นถึงเป็น 2 วันก่อน

ตัวอย่าง
ข้อความ: กินข้าวแกง 50 บาท ค่ารถไฟฟ้า 40 บาทเมื่อเช้า
คำตอบ: [{"type":"expense","amount":50,"category":"อาหาร","note":"ข้าวแกง","days_ago":0,"day":null,"month":null,"account":""},{"type":"expense","amount":40,"category":"เดินทาง","note":"รถไฟฟ้า","days_ago":0,"day":null,"month":null,"account":""}]

ข้อความ: เมื่อวานซื้อกาแฟ 65 รูดบัตรเครดิต เงินเดือนเข้า 30000
คำตอบ: [{"type":"expense","amount":65,"category":"เครื่องดื่ม","note":"กาแฟ","days_ago":1,"day":null,"month":null,"account":"บัตรเครดิต"},{"type":"income","amount":30000,"category":"เงินเดือน","note":"เงินเดือน","days_ago":0,"day":null,"month":null,"account":""}]

ข้อความ: """${text}"""
คำตอบ:`;

export async function parseNaturalLanguage(env, uid, text, today, accounts) {
  const res = await env.AI.run(TEXT_MODEL, { prompt: NL_PROMPT(text, accounts.map((a) => a.name)), max_tokens: 700, temperature: 0.1 });
  const raw = extractJsonValue(typeof res?.response === 'string' ? res.response : JSON.stringify(res?.response ?? ''), '[');
  if (!Array.isArray(raw)) throw new Error('AI แปลงข้อความไม่สำเร็จ ลองเขียนให้ชัดขึ้น เช่น "กินข้าว 50 บาท"');

  const base = todayOr(today);
  const items = [];
  for (const r of raw.slice(0, 15)) {
    const amount = Number(typeof r.amount === 'string' ? r.amount.replace(/[,฿\s]/g, '') : r.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) continue;
    const type = r.type === 'income' ? 'income' : 'expense';
    let category = String(r.category || '').trim();
    if (!(type === 'income' ? INCOME_CATS : SPEND_CATS).includes(category)) category = 'อื่นๆ';
    const note = String(r.note || '').trim().slice(0, 80);

    let daysAgo = Math.min(Math.max(parseInt(r.days_ago, 10) || 0, 0), 366);
    // Thai has no spaces: "เมื่อวานซื้อ" (yesterday I bought) is easily misread as "เมื่อวานซืน" (day before yesterday)
    if (daysAgo === 2 && /เมื่อวาน/.test(text) && !/ซืน|2 วัน|สองวัน|วันก่อน/.test(text)) daysAgo = 1;
    let date = addDays(base, -daysAgo);
    const day = parseInt(r.day, 10), month = parseInt(r.month, 10);
    if (day >= 1 && day <= 31) {
      const m = month >= 1 && month <= 12 ? month : Number(base.slice(5, 7));
      let y = Number(base.slice(0, 4));
      let cand = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (cand > base) cand = `${y - 1}-${cand.slice(5)}`; // a date in the future means last year
      if (validDate(cand)) date = cand;
    }

    let learned = null;
    if (type === 'expense' && note) {
      const l = await learnCategory(env, uid, note, 'expense');
      if (l && l.count >= 2) { category = l.category; learned = l.count; }
    }
    const want = String(r.account || '').trim().toLowerCase();
    const acct = want ? accounts.find((a) => a.name.toLowerCase().includes(want) || want.includes(a.name.toLowerCase())) : null;
    items.push({ type, amount, category, note, date, account_id: acct ? acct.id : null, learned });
  }
  if (!items.length) throw new Error('ไม่พบรายการที่มีจำนวนเงินในข้อความ ลองใส่ตัวเลขด้วย เช่น "กาแฟ 65"');
  return items;
}

// ---------- chat: ground the model in the user's own numbers ----------
const baht = (n) => '฿' + Math.round(n).toLocaleString('en-US');

async function keywordHits(env, uid, question, from) {
  const { results } = await env.DB.prepare(
    `SELECT t.note, t.category, t.type, SUM(${AMT_THB}) AS total, COUNT(*) AS n, substr(t.date,1,7) AS ym
     FROM transactions t ${JOIN_ACCT} WHERE t.user_id = ? AND t.date >= ? AND t.type = 'expense'
     GROUP BY t.note, t.category, ym LIMIT 600`
  ).bind(uid, from).all();
  const words = question.replace(/[^฀-๿a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const grams = new Set();
  for (const w of words) {
    if (w.length >= 3 && w.length <= 12) grams.add(w.toLowerCase());
    for (let len = 3; len <= Math.min(7, w.length); len++) for (let i = 0; i + len <= w.length; i++) grams.add(w.slice(i, i + len).toLowerCase());
  }
  const found = [];
  for (const g of [...grams].sort((a, b) => b.length - a.length)) {
    const hit = results.filter((r) => (r.note || '').toLowerCase().includes(g) || (r.category || '').toLowerCase().includes(g));
    if (!hit.length || hit.length > results.length * 0.7) continue;
    if (found.some((f) => f.word.includes(g) || g.includes(f.word))) continue;
    const byMonth = {};
    hit.forEach((r) => { byMonth[r.ym] = (byMonth[r.ym] || 0) + r.total; });
    found.push({ word: g, count: hit.reduce((s, r) => s + r.n, 0), byMonth });
    if (found.length >= 4) break;
  }
  return found;
}

async function buildContext(env, uid, today, question) {
  const monthStart = today.slice(0, 8) + '01';
  const prevEnd = addDays(monthStart, -1);
  const prevStart = prevEnd.slice(0, 8) + '01';
  const q = (sql, ...args) => env.DB.prepare(sql).bind(uid, ...args).all().then((r) => r.results);
  const sav = savingCond('t.category');

  const [monthly, catNow, catPrev, notesNow, budgets, goals, accounts, recent, hits] = await Promise.all([
    q(`SELECT substr(t.date,1,7) AS ym,
         SUM(CASE WHEN t.type='income' THEN ${AMT_THB} ELSE 0 END) AS income,
         SUM(CASE WHEN t.type='expense' AND NOT ${sav} THEN ${AMT_THB} ELSE 0 END) AS spend,
         SUM(CASE WHEN t.type='expense' AND ${sav} THEN ${AMT_THB} ELSE 0 END) AS saved
       FROM transactions t ${JOIN_ACCT} WHERE t.user_id = ? AND t.date >= ? AND t.date <= ? GROUP BY ym ORDER BY ym`, prevStart, today),
    q(`SELECT t.category, SUM(${AMT_THB}) AS total FROM transactions t ${JOIN_ACCT} WHERE t.user_id = ? AND t.type='expense' AND t.date >= ? AND t.date <= ? GROUP BY t.category ORDER BY total DESC LIMIT 15`, monthStart, today),
    q(`SELECT t.category, SUM(${AMT_THB}) AS total FROM transactions t ${JOIN_ACCT} WHERE t.user_id = ? AND t.type='expense' AND t.date >= ? AND t.date <= ? GROUP BY t.category ORDER BY total DESC LIMIT 15`, prevStart, prevEnd),
    q(`SELECT t.note, SUM(${AMT_THB}) AS total, COUNT(*) AS n FROM transactions t ${JOIN_ACCT} WHERE t.user_id = ? AND t.type='expense' AND t.date >= ? AND t.date <= ? AND t.note != '' GROUP BY t.note ORDER BY total DESC LIMIT 25`, monthStart, today),
    q('SELECT category, period, limit_amount FROM budgets WHERE user_id = ?'),
    goalsWithProgress(env, uid),
    accountsWithBalance(env, uid),
    q(`SELECT t.date, t.type, t.category, t.note, ${AMT_THB} AS thb FROM transactions t ${JOIN_ACCT} WHERE t.user_id = ? ORDER BY t.date DESC, t.id DESC LIMIT 15`),
    keywordHits(env, uid, question, prevStart),
  ]);

  const lines = [`วันนี้: ${today} (ตัวเลขทั้งหมดเป็นบาท)`];
  lines.push('สรุปรายเดือน (รายรับ / ใช้จ่าย(ไม่รวมออม) / ออมไว้):');
  monthly.forEach((m) => lines.push(`- ${m.ym}: ${baht(m.income)} / ${baht(m.spend)} / ${baht(m.saved)}`));
  if (!monthly.length) lines.push('- (ยังไม่มีข้อมูล)');
  const fmtCats = (rows) => rows.map((r) => `${r.category} ${baht(r.total)}`).join(', ') || '-';
  lines.push(`หมวดรายจ่ายเดือนนี้: ${fmtCats(catNow)}`);
  lines.push(`หมวดรายจ่ายเดือนก่อน: ${fmtCats(catPrev)}`);
  lines.push('รายการที่ใช้จ่ายสูงสุดเดือนนี้ (ตามโน้ต): ' + (notesNow.map((r) => `${r.note} ${baht(r.total)} (${r.n} ครั้ง)`).join(', ') || '-'));
  if (hits.length) {
    lines.push('ผลค้นหาตามคำในคำถาม (รวมยอดที่ตรง):');
    hits.forEach((h) => lines.push(`- "${h.word}": ${h.count} รายการ ` + Object.entries(h.byMonth).map(([ym, t]) => `${ym}=${baht(t)}`).join(', ')));
  }
  lines.push('งบประมาณ: ' + (budgets.map((b) => `${b.category} ${b.period === 'week' ? 'รายสัปดาห์' : 'รายเดือน'} ${baht(b.limit_amount)}`).join(', ') || 'ยังไม่ได้ตั้ง'));
  lines.push('เป้าหมายการออม: ' + (goals.map((g) => `${g.name} ${baht(Math.max(g.saved, 0))}/${baht(g.target)}`).join(', ') || 'ยังไม่มี'));
  lines.push('บัญชี: ' + (accounts.map((a) => `${a.name} (${a.currency}) ยอด ${Math.round(a.balance).toLocaleString('en-US')}`).join(', ') || 'ยังไม่ได้เพิ่มบัญชี'));
  lines.push('รายการล่าสุด: ' + (recent.map((r) => `${r.date} ${r.type === 'income' ? '+' : '-'}${baht(r.thb)} ${r.category}${r.note ? ' ' + r.note : ''}`).join(' | ') || '-'));
  return lines.join('\n');
}

const CHAT_SYSTEM = `คุณคือ "เบน" ผู้ช่วยการเงินส่วนบุคคลในแอปจดรายรับรายจ่าย
- ตอบเป็นภาษาไทย สั้น กระชับ เป็นกันเอง ใช้อีโมจิได้เล็กน้อย
- ใช้เฉพาะข้อมูลของผู้ใช้ด้านล่างในการตอบเรื่องตัวเลข ถ้าข้อมูลไม่พอให้บอกตรงๆ ห้ามเดาหรือแต่งตัวเลข
- ถ้าถามยอดตามคำ (เช่น กาแฟ) ให้ดูที่ "ผลค้นหาตามคำในคำถาม" และรายการ/หมวดที่เกี่ยวข้อง
- เมื่อถามว่าทำไมเงินเก็บลด ให้เทียบเดือนนี้กับเดือนก่อนตามหมวดและรายรับ แล้วชี้สาเหตุจากข้อมูล
- ให้คำแนะนำการออมแบบทั่วไปตามรายได้และรายจ่ายจริงได้ แต่ไม่แนะนำหุ้นหรือกองทุนรายตัว และบอกว่าเป็นคำแนะนำทั่วไป`;

export async function chatReply(env, uid, messages, today, question) {
  const context = await buildContext(env, uid, todayOr(today), question);
  const res = await env.AI.run(TEXT_MODEL, {
    messages: [{ role: 'system', content: `${CHAT_SYSTEM}\n\n=== ข้อมูลของผู้ใช้ ===\n${context}` }, ...messages],
    max_tokens: 600,
    temperature: 0.3,
  });
  const reply = typeof res?.response === 'string' ? res.response.trim() : '';
  if (!reply) throw new Error('ผู้ช่วยตอบไม่ได้ในตอนนี้ ลองใหม่อีกครั้ง');
  return reply;
}

export function registerAiRoutes(app) {
  app.get('/api/suggest', async (c) => {
    const type = c.req.query('type') === 'income' ? 'income' : 'expense';
    return c.json({ suggestion: await learnCategory(c.env, c.get('uid'), c.req.query('q'), type) });
  });

  app.post('/api/nl/parse', async (c) => {
    const uid = c.get('uid');
    const { text, today } = (await c.req.json().catch(() => null)) || {};
    if (typeof text !== 'string' || text.trim().length < 2 || text.length > 600) return c.json({ error: 'พิมพ์ข้อความก่อน (ไม่เกิน 600 ตัวอักษร)' }, 400);
    if (!(await aiAllowed(c.env, uid))) return c.json({ error: 'วันนี้ใช้ AI ครบโควตาแล้ว ลองใหม่พรุ่งนี้' }, 429);
    const { results: accounts } = await c.env.DB.prepare('SELECT id, name FROM accounts WHERE user_id = ?').bind(uid).all();
    try {
      return c.json({ items: await parseNaturalLanguage(c.env, uid, text.trim(), today, accounts) });
    } catch (e) {
      return c.json({ error: e.message || 'วิเคราะห์ข้อความไม่สำเร็จ' }, 422);
    }
  });

  app.post('/api/chat', async (c) => {
    const uid = c.get('uid');
    const { messages, today } = (await c.req.json().catch(() => null)) || {};
    if (!Array.isArray(messages) || !messages.length) return c.json({ error: 'พิมพ์คำถามก่อน' }, 400);
    const history = messages.slice(-8)
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content.slice(0, 600) }));
    const last = history[history.length - 1];
    if (!last || last.role !== 'user') return c.json({ error: 'พิมพ์คำถามก่อน' }, 400);
    if (!(await aiAllowed(c.env, uid))) return c.json({ error: 'วันนี้ใช้ AI ครบโควตาแล้ว ลองใหม่พรุ่งนี้' }, 429);
    try {
      return c.json({ reply: await chatReply(c.env, uid, history, today, last.content) });
    } catch (e) {
      return c.json({ error: e.message || 'ผู้ช่วยตอบไม่ได้ในตอนนี้' }, 422);
    }
  });
}
