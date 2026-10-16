-- Multiple accounts (wallets) with their own currency; rate_to_thb converts the account's currency to baht
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'cash' CHECK (type IN ('cash','bank','credit','ewallet','other')),
  currency TEXT NOT NULL DEFAULT 'THB',
  rate_to_thb REAL NOT NULL DEFAULT 1 CHECK (rate_to_thb > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts (user_id);

ALTER TABLE transactions ADD COLUMN account_id INTEGER;

-- Budgets now have a period (month or week). Rebuild the table because the primary key changes.
CREATE TABLE budgets_new (
  user_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  period TEXT NOT NULL DEFAULT 'month' CHECK (period IN ('month','week')),
  limit_amount REAL NOT NULL CHECK (limit_amount > 0),
  PRIMARY KEY (user_id, category, period)
);
INSERT INTO budgets_new (user_id, category, period, limit_amount)
  SELECT user_id, category, 'month', monthly_limit FROM budgets WHERE monthly_limit > 0;
DROP TABLE budgets;
ALTER TABLE budgets_new RENAME TO budgets;

-- Change counter per user: other devices poll it to know when to refresh
CREATE TABLE IF NOT EXISTS sync (
  user_id INTEGER PRIMARY KEY,
  v INTEGER NOT NULL DEFAULT 0
);

-- Daily cap on AI calls (slip scan, natural-language entry, chat)
CREATE TABLE IF NOT EXISTS ai_usage (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
