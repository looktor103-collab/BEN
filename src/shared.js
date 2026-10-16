export const validDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d));

// Savings categories are recognised by keyword (kept in sync with SAVING_RE in public/js/core.js)
const SAVING_WORDS = ['ออม', 'ลงทุน', 'กองทุน', 'เงินเก็บ', 'ฉุกเฉิน'];
export const savingCond = (col) => '(' + SAVING_WORDS.map((w) => `${col} LIKE '%${w}%'`).join(' OR ') + ')';

// Convert a transaction amount to baht using its account's rate (no account = already baht)
export const AMT_THB = 't.amount * COALESCE(a.rate_to_thb, 1)';
export const JOIN_ACCT = 'LEFT JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id';

export function extractJsonValue(text, open = '{') {
  if (typeof text !== 'string') return null;
  const close = open === '[' ? ']' : '}';
  const start = text.indexOf(open);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) {
      try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

export async function bumpSync(env, uid) {
  await env.DB.prepare('INSERT INTO sync (user_id, v) VALUES (?, 1) ON CONFLICT(user_id) DO UPDATE SET v = v + 1').bind(uid).run();
}
