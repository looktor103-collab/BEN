import { accountsWithBalance } from './queries.js';

const TYPES = ['cash', 'bank', 'credit', 'ewallet', 'other'];
const MAX_ACCOUNTS = 30;

function parseAccount(body) {
  const { name, type = 'cash', currency = 'THB', rate_to_thb = 1 } = body || {};
  if (typeof name !== 'string' || !name.trim() || name.length > 40) return { error: 'ชื่อบัญชีไม่ถูกต้อง (ไม่เกิน 40 ตัวอักษร)' };
  if (!TYPES.includes(type)) return { error: 'ประเภทบัญชีไม่ถูกต้อง' };
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return { error: 'สกุลเงินต้องเป็นรหัส 3 ตัวอักษร เช่น THB, USD' };
  const rate = currency === 'THB' ? 1 : Number(rate_to_thb);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1e7) return { error: 'อัตราแลกเปลี่ยนไม่ถูกต้อง' };
  return { value: [name.trim(), type, currency, rate] };
}

export function registerAccountRoutes(app) {
  app.get('/api/accounts', async (c) => c.json({ accounts: await accountsWithBalance(c.env, c.get('uid')) }));

  app.post('/api/accounts', async (c) => {
    const uid = c.get('uid');
    const p = parseAccount(await c.req.json().catch(() => null));
    if (p.error) return c.json({ error: p.error }, 400);
    const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM accounts WHERE user_id = ?').bind(uid).first();
    if (n.n >= MAX_ACCOUNTS) return c.json({ error: `สร้างบัญชีได้สูงสุด ${MAX_ACCOUNTS} บัญชี` }, 400);
    const r = await c.env.DB.prepare('INSERT INTO accounts (user_id, name, type, currency, rate_to_thb) VALUES (?, ?, ?, ?, ?)')
      .bind(uid, ...p.value).run();
    return c.json({ id: r.meta.last_row_id }, 201);
  });

  app.put('/api/accounts/:id', async (c) => {
    const p = parseAccount(await c.req.json().catch(() => null));
    if (p.error) return c.json({ error: p.error }, 400);
    const r = await c.env.DB.prepare('UPDATE accounts SET name=?, type=?, currency=?, rate_to_thb=? WHERE id=? AND user_id=?')
      .bind(...p.value, Number(c.req.param('id')), c.get('uid')).run();
    if (!r.meta.changes) return c.json({ error: 'ไม่พบบัญชี' }, 404);
    return c.json({ ok: true });
  });

  // Deleting an account keeps its transactions; they become "no account"
  app.delete('/api/accounts/:id', async (c) => {
    const uid = c.get('uid'), id = Number(c.req.param('id'));
    const r = await c.env.DB.prepare('DELETE FROM accounts WHERE id=? AND user_id=?').bind(id, uid).run();
    if (!r.meta.changes) return c.json({ error: 'ไม่พบบัญชี' }, 404);
    await c.env.DB.prepare('UPDATE transactions SET account_id = NULL WHERE account_id=? AND user_id=?').bind(id, uid).run();
    return c.json({ ok: true });
  });
}
