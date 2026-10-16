import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { scanSlip } from './slip.js';

const app = new Hono();
const enc = new TextEncoder();
const SESSION_DAYS = 30;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function hashPassword(password, saltB64) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: unb64(saltB64), iterations: 100000, hash: 'SHA-256' },
    key,
    256
  );
  return b64(bits);
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

async function makeSession(env, userId) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const payload = `${userId}.${exp}`;
  return `${payload}.${await hmac(env.SESSION_SECRET, payload)}`;
}

async function readSession(env, token) {
  if (!token || !env.SESSION_SECRET) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [uid, exp, sig] = parts;
  if (!safeEqual(sig, await hmac(env.SESSION_SECRET, `${uid}.${exp}`))) return null;
  if (Number(exp) < Date.now()) return null;
  return Number(uid);
}

function setSessionCookie(c, token) {
  setCookie(c, 'ben_session', token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  });
}

const validUsername = (u) => typeof u === 'string' && /^[A-Za-z0-9_.@+-]{3,64}$/.test(u);
const validPassword = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 200;
const validDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d));

// CSRF: block state-changing requests that originate from another site
app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const origin = c.req.header('Origin');
    if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: 'forbidden' }, 403);
  }
  await next();
});

// ---------- Auth ----------
app.get('/api/me', async (c) => {
  const uid = await readSession(c.env, getCookie(c, 'ben_session'));
  if (uid) {
    const u = await c.env.DB.prepare('SELECT id, username FROM users WHERE id = ?').bind(uid).first();
    if (u) return c.json({ user: u, needsSetup: false });
  }
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  return c.json({ user: null, needsSetup: count.n === 0 });
});

app.post('/api/auth/setup', async (c) => {
  if (!c.env.SESSION_SECRET) return c.json({ error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า SESSION_SECRET' }, 500);
  const { username, password } = await c.req.json().catch(() => ({}));
  if (!validUsername(username)) return c.json({ error: 'username ต้องเป็น a-z, 0-9, _ . - @ + ยาว 3-64 ตัว (ห้ามเว้นวรรค/ภาษาไทย)' }, 400);
  if (!validPassword(password)) return c.json({ error: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' }, 400);
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await hashPassword(password, salt);
  // insert only while no user exists (guards against concurrent setup)
  const r = await c.env.DB.prepare(
    'INSERT INTO users (username, pass_hash, salt) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)'
  ).bind(username, hash, salt).run();
  if (!r.meta.changes) return c.json({ error: 'ตั้งค่าบัญชีไปแล้ว' }, 409);
  setSessionCookie(c, await makeSession(c.env, r.meta.last_row_id));
  return c.json({ ok: true });
});

app.post('/api/auth/login', async (c) => {
  const { username, password } = await c.req.json().catch(() => ({}));
  if (typeof username !== 'string' || typeof password !== 'string') return c.json({ error: 'ข้อมูลไม่ครบ' }, 400);
  const key = username.toLowerCase();
  const fails = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE username = ? AND ts > ?')
    .bind(key, Date.now() - LOCK_MS).first();
  if (fails.n >= MAX_FAILS) return c.json({ error: 'ลองผิดหลายครั้งเกินไป กรุณารอ 15 นาที' }, 429);
  const u = await c.env.DB.prepare('SELECT id, pass_hash, salt FROM users WHERE username = ?').bind(username).first();
  // always hash so response time doesn't reveal whether the user exists
  const hash = await hashPassword(password, u ? u.salt : b64(new Uint8Array(16)));
  if (!u || !safeEqual(hash, u.pass_hash)) {
    await c.env.DB.prepare('INSERT INTO login_attempts (username, ts) VALUES (?, ?)').bind(key, Date.now()).run();
    return c.json({ error: 'username หรือรหัสผ่านไม่ถูกต้อง' }, 401);
  }
  await c.env.DB.prepare('DELETE FROM login_attempts WHERE username = ?').bind(key).run();
  setSessionCookie(c, await makeSession(c.env, u.id));
  return c.json({ ok: true });
});

app.post('/api/auth/logout', (c) => {
  deleteCookie(c, 'ben_session', { path: '/' });
  return c.json({ ok: true });
});

// ---------- everything below requires login ----------
app.use('/api/*', async (c, next) => {
  const uid = await readSession(c.env, getCookie(c, 'ben_session'));
  if (!uid) return c.json({ error: 'unauthorized' }, 401);
  c.set('uid', uid);
  await next();
});

const KEY_RE = (uid) => new RegExp('^' + uid + '/[0-9a-f-]{36}$');
const MAX_IMG = 5 * 1024 * 1024;

function parseTx(body, uid) {
  const { type, amount, category, note = '', date, image_key = null } = body || {};
  if (type !== 'income' && type !== 'expense') return { error: 'ประเภทไม่ถูกต้อง' };
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0 || amt > 1e12) return { error: 'จำนวนเงินไม่ถูกต้อง' };
  if (typeof category !== 'string' || !category.trim() || category.length > 60) return { error: 'กรุณาระบุหมวดหมู่' };
  if (typeof note !== 'string' || note.length > 200) return { error: 'โน้ตยาวเกินไป' };
  if (!validDate(date)) return { error: 'วันที่ไม่ถูกต้อง' };
  if (image_key !== null && !(typeof image_key === 'string' && KEY_RE(uid).test(image_key))) return { error: 'รูปแนบไม่ถูกต้อง' };
  return { value: [type, amt, category.trim(), note.trim(), date, image_key] };
}

function sniffImage(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57) return 'image/webp';
  return null;
}

async function readImage(c) {
  const form = await c.req.formData().catch(() => null);
  const file = form && form.get('file');
  if (!file || typeof file === 'string') return { error: 'ไม่พบไฟล์รูป' };
  if (file.size > MAX_IMG) return { error: 'รูปใหญ่เกิน 5MB' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(bytes);
  if (!type) return { error: 'รองรับเฉพาะรูป JPEG, PNG, WebP' };
  return { bytes, type };
}

app.post('/api/slip/scan', async (c) => {
  const img = await readImage(c);
  if (img.error) return c.json({ error: img.error }, 400);
  try {
    return c.json(await scanSlip(img.bytes, c.env));
  } catch (e) {
    return c.json({ error: e.message || 'อ่านสลิปไม่สำเร็จ' }, 422);
  }
});

app.post('/api/uploads', async (c) => {
  const img = await readImage(c);
  if (img.error) return c.json({ error: img.error }, 400);
  const id = crypto.randomUUID();
  await c.env.UPLOADS.put(`${c.get('uid')}/${id}`, img.bytes, { httpMetadata: { contentType: img.type } });
  return c.json({ key: `${c.get('uid')}/${id}` }, 201);
});

app.get('/api/uploads/:uid/:id', async (c) => {
  if (Number(c.req.param('uid')) !== c.get('uid')) return c.json({ error: 'not found' }, 404);
  const obj = await c.env.UPLOADS.get(`${c.req.param('uid')}/${c.req.param('id')}`);
  if (!obj) return c.json({ error: 'not found' }, 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

app.delete('/api/uploads/:uid/:id', async (c) => {
  const uid = c.get('uid');
  if (Number(c.req.param('uid')) !== uid || !/^[0-9a-f-]{36}$/.test(c.req.param('id'))) return c.json({ error: 'not found' }, 404);
  const key = `${uid}/${c.req.param('id')}`;
  // never delete a photo that a transaction still references
  const used = await c.env.DB.prepare('SELECT 1 FROM transactions WHERE user_id=? AND image_key=?').bind(uid, key).first();
  if (used) return c.json({ error: 'รูปนี้ถูกใช้อยู่' }, 409);
  await c.env.UPLOADS.delete(key);
  return c.json({ ok: true });
});

const dropImage = (env, key) => (key ? env.UPLOADS.delete(key).catch(() => {}) : null);

app.get('/api/transactions', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  let sql = 'SELECT id, type, amount, category, note, date, image_key FROM transactions WHERE user_id = ?';
  const args = [c.get('uid')];
  if (from && validDate(from)) { sql += ' AND date >= ?'; args.push(from); }
  if (to && validDate(to)) { sql += ' AND date <= ?'; args.push(to); }
  sql += ' ORDER BY date DESC, id DESC LIMIT 5000';
  const { results } = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json({ transactions: results });
});

app.post('/api/transactions', async (c) => {
  const p = parseTx(await c.req.json().catch(() => null), c.get('uid'));
  if (p.error) return c.json({ error: p.error }, 400);
  const r = await c.env.DB.prepare(
    'INSERT INTO transactions (user_id, type, amount, category, note, date, image_key) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(c.get('uid'), ...p.value).run();
  return c.json({ id: r.meta.last_row_id }, 201);
});

app.put('/api/transactions/:id', async (c) => {
  const uid = c.get('uid'), id = Number(c.req.param('id'));
  const p = parseTx(await c.req.json().catch(() => null), uid);
  if (p.error) return c.json({ error: p.error }, 400);
  const old = await c.env.DB.prepare('SELECT image_key FROM transactions WHERE id=? AND user_id=?').bind(id, uid).first();
  if (!old) return c.json({ error: 'ไม่พบรายการ' }, 404);
  await c.env.DB.prepare(
    'UPDATE transactions SET type=?, amount=?, category=?, note=?, date=?, image_key=? WHERE id=? AND user_id=?'
  ).bind(...p.value, id, uid).run();
  if (old.image_key && old.image_key !== p.value[5]) await dropImage(c.env, old.image_key);
  return c.json({ ok: true });
});

app.delete('/api/transactions/:id', async (c) => {
  const uid = c.get('uid'), id = Number(c.req.param('id'));
  const old = await c.env.DB.prepare('SELECT image_key FROM transactions WHERE id=? AND user_id=?').bind(id, uid).first();
  if (!old) return c.json({ error: 'ไม่พบรายการ' }, 404);
  await c.env.DB.prepare('DELETE FROM transactions WHERE id=? AND user_id=?').bind(id, uid).run();
  await dropImage(c.env, old.image_key);
  return c.json({ ok: true });
});

app.get('/api/budgets', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT category, monthly_limit FROM budgets WHERE user_id = ?')
    .bind(c.get('uid')).all();
  return c.json({ budgets: results });
});

app.put('/api/budgets', async (c) => {
  const { category, monthly_limit } = (await c.req.json().catch(() => null)) || {};
  const lim = Number(monthly_limit);
  if (typeof category !== 'string' || !category.trim() || category.length > 60) return c.json({ error: 'หมวดหมู่ไม่ถูกต้อง' }, 400);
  if (!Number.isFinite(lim) || lim < 0) return c.json({ error: 'วงเงินไม่ถูกต้อง' }, 400);
  if (lim === 0) {
    await c.env.DB.prepare('DELETE FROM budgets WHERE user_id=? AND category=?').bind(c.get('uid'), category.trim()).run();
  } else {
    await c.env.DB.prepare(
      'INSERT INTO budgets (user_id, category, monthly_limit) VALUES (?, ?, ?) ON CONFLICT(user_id, category) DO UPDATE SET monthly_limit = excluded.monthly_limit'
    ).bind(c.get('uid'), category.trim(), lim).run();
  }
  return c.json({ ok: true });
});

// Savings goals: progress = (income - expense) since start_date, computed on the fly
app.get('/api/goals', async (c) => {
  const uid = c.get('uid');
  const { results } = await c.env.DB.prepare(
    `SELECT g.id, g.name, g.target, g.start_date,
       COALESCE((SELECT SUM(CASE WHEN t.type='income' THEN t.amount ELSE -t.amount END)
                 FROM transactions t WHERE t.user_id = g.user_id AND t.date >= g.start_date), 0) AS saved
     FROM goals g WHERE g.user_id = ? ORDER BY g.id`
  ).bind(uid).all();
  return c.json({ goals: results });
});

app.post('/api/goals', async (c) => {
  const { name, target, start_date } = (await c.req.json().catch(() => null)) || {};
  const t = Number(target);
  if (typeof name !== 'string' || !name.trim() || name.length > 80) return c.json({ error: 'ชื่อเป้าหมายไม่ถูกต้อง' }, 400);
  if (!Number.isFinite(t) || t <= 0 || t > 1e12) return c.json({ error: 'จำนวนเป้าหมายไม่ถูกต้อง' }, 400);
  if (!validDate(start_date)) return c.json({ error: 'วันที่เริ่มไม่ถูกต้อง' }, 400);
  const r = await c.env.DB.prepare('INSERT INTO goals (user_id, name, target, start_date) VALUES (?, ?, ?, ?)')
    .bind(c.get('uid'), name.trim(), t, start_date).run();
  return c.json({ id: r.meta.last_row_id }, 201);
});

app.delete('/api/goals/:id', async (c) => {
  const r = await c.env.DB.prepare('DELETE FROM goals WHERE id=? AND user_id=?')
    .bind(Number(c.req.param('id')), c.get('uid')).run();
  if (!r.meta.changes) return c.json({ error: 'ไม่พบเป้าหมาย' }, 404);
  return c.json({ ok: true });
});

app.notFound((c) => c.json({ error: 'not found' }, 404));
export default app;
