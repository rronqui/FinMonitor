import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { normalizeDescription } from "./semantics";

const DB_PATH = process.env.FINMONITOR_DB_PATH ?? path.join(process.cwd(), "data", "finmonitor.db");

let instance: Database.Database | null = null;

export function db(): Database.Database {
  if (instance) return instance;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const d = new Database(DB_PATH);
  d.pragma("journal_mode = WAL");
  d.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS connections (
      item_id TEXT PRIMARY KEY,
      connector_id TEXT,
      connector_name TEXT,
      status TEXT,
      reconnect_url TEXT,
      created_at TEXT,
      raw TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS accounts (
      account_id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      subtype TEXT,
      name TEXT,
      number TEXT,
      balance TEXT,
      currency_code TEXT,
      bank_data TEXT,
      credit_data TEXT,
      raw TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      date TEXT NOT NULL,
      description TEXT,
      amount TEXT NOT NULL,
      type TEXT,
      status TEXT,
      category TEXT,
      category_id TEXT,
      raw TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tx_account_date ON transactions (account_id, date DESC);
    CREATE TABLE IF NOT EXISTS bills (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      due_date TEXT,
      total_amount TEXT,
      minimum_payment TEXT,
      payment_status TEXT,
      raw TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS investments (
      id TEXT PRIMARY KEY,
      name TEXT,
      type TEXT,
      subtype TEXT,
      balance TEXT,
      amount TEXT,
      amount_original TEXT,
      amount_withdrawal TEXT,
      taxes TEXT,
      rate REAL,
      rate_type TEXT,
      issuer TEXT,
      issue_date TEXT,
      raw TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS loans (
      id TEXT PRIMARY KEY,
      item_id TEXT,
      type TEXT,
      contract_amount TEXT,
      due_date TEXT,
      contract_number TEXT,
      raw TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      description TEXT,
      description_translated TEXT,
      parent_id TEXT,
      parent_description TEXT
    );
    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      detail TEXT
    );
  `);
  // migração: semântica normalizada persistida (v2)
  const cols = d.prepare("PRAGMA table_info(transactions)").all() as Array<{ name: string }>;
  const has = (n: string) => cols.some((c) => c.name === n);
  if (!has("kind")) d.exec("ALTER TABLE transactions ADD COLUMN kind TEXT");
  if (!has("abs_amount")) d.exec("ALTER TABLE transactions ADD COLUMN abs_amount REAL");
  d.exec(`
    UPDATE transactions SET
      abs_amount = ABS(CAST(amount AS REAL)),
      kind = CASE
        WHEN COALESCE(category, '') IN ('Credit card payment', 'Same person transfer') THEN 'transfer'
        WHEN (SELECT type FROM accounts a WHERE a.account_id = transactions.account_id) = 'CREDIT'
          THEN CASE WHEN CAST(amount AS REAL) > 0 THEN 'spend' ELSE 'income' END
        ELSE CASE WHEN CAST(amount AS REAL) < 0 THEN 'spend' ELSE 'income' END
      END
    WHERE kind IS NULL;
  `);
  // v3: aportes/resgates deixam de contar como gasto/entrada
  d.exec(`
    UPDATE transactions SET kind = 'investment'
    WHERE COALESCE(category, '') IN ('Fixed income', 'Investments', 'Variable income', 'Funds')
      AND kind IN ('spend', 'income');
  `);
  // v4: movimentações de investimento para reconstruir a série investida
  d.exec(`
    CREATE TABLE IF NOT EXISTS investment_movements (
      id TEXT PRIMARY KEY,
      investment_id TEXT NOT NULL,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      net_amount REAL NOT NULL
    );
  `);
  // v5: descrição normalizada persistida (mesma chave da detecção de recorrências)
  if (!has("desc_norm")) {
    d.exec("ALTER TABLE transactions ADD COLUMN desc_norm TEXT");
    d.transaction(() => {
      const upd = d.prepare("UPDATE transactions SET desc_norm = ? WHERE id = ?");
      for (const r of d.prepare("SELECT id, description FROM transactions").all() as Array<{ id: string; description: string | null }>) {
        upd.run(normalizeDescription(r.description ?? ""), r.id);
      }
    })();
  }
  instance = d;
  return d;
}

export function getMeta(key: string): string | undefined {
  const row = db().prepare("SELECT value FROM meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}


export function setMeta(key: string, value: string): void {
  db().prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
