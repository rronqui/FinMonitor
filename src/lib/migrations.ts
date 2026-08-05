import Database from "better-sqlite3";
import { normalizeDescription } from "./semantics";

export const CURRENT_SCHEMA_VERSION = 5;

export interface Migration {
  version: number;
  name: string;
  run(d: Database.Database): void;
}

const migrationsV1: Migration = {
  version: 1,
  name: "create-base-schema",
  run(d) {
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
  },
};

function readTableColumns(d: Database.Database, tableName: string): Set<string> {
  const columns = d.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return new Set(columns.map((column) => column.name));
}

const migrationsV2: Migration = {
  version: 2,
  name: "transaction-derived-fields",
  run(d) {
    const columns = readTableColumns(d, "transactions");
    if (!columns.has("kind")) d.exec("ALTER TABLE transactions ADD COLUMN kind TEXT");
    if (!columns.has("abs_amount")) d.exec("ALTER TABLE transactions ADD COLUMN abs_amount REAL");
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
  },
};

const migrationsV3: Migration = {
  version: 3,
  name: "classify-investments",
  run(d) {
    d.exec(`
      UPDATE transactions SET kind = 'investment'
      WHERE COALESCE(category, '') IN ('Fixed income', 'Investments', 'Variable income', 'Funds')
        AND kind IN ('spend', 'income');
    `);
  },
};

const migrationsV4: Migration = {
  version: 4,
  name: "investment-movements",
  run(d) {
    d.exec(`
      CREATE TABLE IF NOT EXISTS investment_movements (
        id TEXT PRIMARY KEY,
        investment_id TEXT NOT NULL,
        date TEXT NOT NULL,
        type TEXT NOT NULL,
        net_amount REAL NOT NULL
      );
    `);
  },
};

const migrationsV5: Migration = {
  version: 5,
  name: "normalized-descriptions",
  run(d) {
    const columns = readTableColumns(d, "transactions");
    if (!columns.has("desc_norm")) {
      d.exec("ALTER TABLE transactions ADD COLUMN desc_norm TEXT");
    }
    d.function("normalizeDescription", (description: unknown) =>
      normalizeDescription(typeof description === "string" ? description : ""),
    );
    d.exec(
      "UPDATE transactions SET desc_norm = normalizeDescription(description) WHERE desc_norm IS NULL",
    );
  },
};

export const migrations: Migration[] = [
  migrationsV1,
  migrationsV2,
  migrationsV3,
  migrationsV4,
  migrationsV5,
];

function readSchemaVersion(d: Database.Database): number {
  const metaTable = d
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'")
    .get() as { name: string } | undefined;
  if (!metaTable) return 0;

  const row = d
    .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
    .get() as { value: unknown } | undefined;
  const version = Number(row?.value);
  return Number.isNaN(version) ? 0 : version;
}

export function migrate(d: Database.Database): void {
  let currentVersion = readSchemaVersion(d);
  if (currentVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${currentVersion} is newer than supported version ${CURRENT_SCHEMA_VERSION}`,
    );
  }

  for (const migration of migrations) {
    if (migration.version <= currentVersion) continue;
    d.transaction(() => {
      migration.run(d);
      d.prepare(
        "INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(String(migration.version));
    })();
    currentVersion = migration.version;
  }
}
