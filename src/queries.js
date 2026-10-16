import { AMT_THB, JOIN_ACCT, savingCond } from './shared.js';

// Goal progress = income - spending since the start date (money moved into savings categories is not subtracted)
export async function goalsWithProgress(env, uid) {
  const { results } = await env.DB.prepare(
    `SELECT g.id, g.name, g.target, g.start_date,
       COALESCE((SELECT SUM(CASE WHEN t.type='income' THEN ${AMT_THB}
                                  WHEN ${savingCond('t.category')} THEN 0
                                  ELSE -(${AMT_THB}) END)
                 FROM transactions t ${JOIN_ACCT}
                 WHERE t.user_id = g.user_id AND t.date >= g.start_date), 0) AS saved
     FROM goals g WHERE g.user_id = ? ORDER BY g.id`
  ).bind(uid).all();
  return results;
}

// Balance per account in the account's own currency (income - expense, all time)
export async function accountsWithBalance(env, uid) {
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.name, a.type, a.currency, a.rate_to_thb,
       COALESCE(SUM(CASE t.type WHEN 'income' THEN t.amount WHEN 'expense' THEN -t.amount END), 0) AS balance
     FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id AND t.user_id = a.user_id
     WHERE a.user_id = ? GROUP BY a.id ORDER BY a.id`
  ).bind(uid).all();
  return results;
}
