import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeDescription } from "../semantics";

type SqliteDatabase = InstanceType<typeof Database>;

type LegacyOptions = {
  descNorm?: boolean;
  schemaVersion?: string;
};

type LegacyTransaction = {
  id: string;
  accountId: string;
  date: string;
  description: string | null;
  amount: string;
  category: string | null;
};

const openDbForPath = async (dbPath: string) => {
  vi.resetModules();
  process.env.FINMONITOR_DB_PATH = dbPath;
  // O import dinâmico é obrigatório: db.ts captura FINMONITOR_DB_PATH ao carregar.
  const module = await import("../db");
  return { module, database: module.db() };
};

const createLegacyDb = (dbPath: string, options: LegacyOptions = {}): SqliteDatabase => {
  const database = new Database(dbPath);
  database.exec(`
    CREATE TABLE meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE connections (
      item_id TEXT PRIMARY KEY,
      connector_id TEXT,
      connector_name TEXT,
      status TEXT,
      reconnect_url TEXT,
      created_at TEXT,
      raw TEXT NOT NULL
    );
    CREATE TABLE accounts (
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
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      date TEXT NOT NULL,
      description TEXT,
      amount TEXT NOT NULL,
      type TEXT,
      status TEXT,
      category TEXT,
      category_id TEXT,
      raw TEXT NOT NULL${options.descNorm ? ",\n      desc_norm TEXT" : ""}
    );
    CREATE TABLE bills (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      due_date TEXT,
      total_amount TEXT,
      minimum_payment TEXT,
      payment_status TEXT,
      raw TEXT NOT NULL
    );
    CREATE TABLE investments (
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
    CREATE TABLE loans (
      id TEXT PRIMARY KEY,
      item_id TEXT,
      type TEXT,
      contract_amount TEXT,
      due_date TEXT,
      contract_number TEXT,
      raw TEXT NOT NULL
    );
    CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      description TEXT,
      description_translated TEXT,
      parent_id TEXT,
      parent_description TEXT
    );
    CREATE TABLE sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      detail TEXT
    );
  `);
  if (options.schemaVersion !== undefined) {
    database.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(options.schemaVersion);
  }
  return database;
};

const insertLegacyTransaction = (database: SqliteDatabase, transaction: LegacyTransaction) => {
  database
    .prepare(
      `INSERT INTO transactions
        (id, account_id, date, description, amount, category, raw)
       VALUES (?, ?, ?, ?, ?, ?, '{}')`,
    )
    .run(
      transaction.id,
      transaction.accountId,
      transaction.date,
      transaction.description,
      transaction.amount,
      transaction.category,
    );
};

afterEach(() => {
  delete process.env.FINMONITOR_DB_PATH;
});

describe("migração de bancos legados", () => {
  it("AC-005 preserva dados v1 e preenche as colunas derivadas pela conta e categoria", async () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "finmonitor-legacy-ac005-"));
    const dbPath = path.join(tmpDir, "legacy.db");
    const transactions: LegacyTransaction[] = [
      {
        id: "tx-transfer-category",
        accountId: "credit-account",
        date: "2025-01-01",
        description: "Pagamento cartão 123",
        amount: "-50.25",
        category: "Credit card payment",
      },
      {
        id: "tx-transfer-person",
        accountId: "bank-account",
        date: "2025-01-02",
        description: "Transferência própria",
        amount: "100.00",
        category: "Same person transfer",
      },
      {
        id: "tx-credit-positive",
        accountId: "credit-account",
        date: "2025-01-03",
        description: "Compra no crédito",
        amount: "42.00",
        category: "Groceries",
      },
      {
        id: "tx-credit-negative",
        accountId: "credit-account",
        date: "2025-01-04",
        description: "Pagamento da fatura",
        amount: "-10.50",
        category: "Salary",
      },
      {
        id: "tx-bank-negative",
        accountId: "bank-account",
        date: "2025-01-05",
        description: "Mercado 987",
        amount: "-12.34",
        category: "Groceries",
      },
      {
        id: "tx-bank-positive",
        accountId: "bank-account",
        date: "2025-01-06",
        description: "Salário",
        amount: "20.00",
        category: "Salary",
      },
    ];

    const legacy = createLegacyDb(dbPath);
    legacy.prepare("INSERT INTO accounts (account_id, type, raw) VALUES (?, ?, '{}')").run("credit-account", "CREDIT");
    legacy.prepare("INSERT INTO accounts (account_id, type, raw) VALUES (?, ?, '{}')").run("bank-account", "BANK");
    for (const transaction of transactions) insertLegacyTransaction(legacy, transaction);
    legacy.close();

    let database: SqliteDatabase | undefined;
    try {
      const opened = await openDbForPath(dbPath);
      database = opened.database;

      const rows = database
        .prepare(
          `SELECT id, account_id, date, description, amount, category, kind, abs_amount
           FROM transactions ORDER BY id`,
        )
        .all() as Array<{
        id: string;
        account_id: string;
        date: string;
        description: string | null;
        amount: string;
        category: string | null;
        kind: string;
        abs_amount: number;
      }>;

      const expectedById: Record<string, { kind: string; absAmount: number }> = {
        "tx-bank-negative": { kind: "spend", absAmount: 12.34 },
        "tx-bank-positive": { kind: "income", absAmount: 20 },
        "tx-credit-negative": { kind: "income", absAmount: 10.5 },
        "tx-credit-positive": { kind: "spend", absAmount: 42 },
        "tx-transfer-category": { kind: "transfer", absAmount: 50.25 },
        "tx-transfer-person": { kind: "transfer", absAmount: 100 },
      };

      expect(rows.map(({ id, account_id, date, description, amount, category }) => ({
        id,
        account_id,
        date,
        description,
        amount,
        category,
      }))).toEqual(
        transactions
          .map((transaction) => ({
            id: transaction.id,
            account_id: transaction.accountId,
            date: transaction.date,
            description: transaction.description,
            amount: transaction.amount,
            category: transaction.category,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      );
      expect(rows.map(({ id, kind, abs_amount }) => ({ id, kind, abs_amount }))).toEqual(
        Object.entries(expectedById).map(([id, expected]) => ({
          id,
          kind: expected.kind,
          abs_amount: expected.absAmount,
        })),
      );
      expect(opened.module.getMeta("schema_version")).toBe("5");
    } finally {
      database?.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("AC-006 aplica investment uma vez e preserva uma correção manual após reabrir", async () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "finmonitor-legacy-ac006-"));
    const dbPath = path.join(tmpDir, "legacy.db");
    const legacy = createLegacyDb(dbPath);
    legacy.prepare("INSERT INTO accounts (account_id, type, raw) VALUES ('bank-account', 'BANK', '{}')").run();
    insertLegacyTransaction(legacy, {
      id: "tx-investment",
      accountId: "bank-account",
      date: "2025-02-01",
      description: "Aporte",
      amount: "-200.00",
      category: "Investments",
    });
    legacy.close();

    let firstDatabase: SqliteDatabase | undefined;
    let reopenedDatabase: SqliteDatabase | undefined;
    try {
      const first = await openDbForPath(dbPath);
      firstDatabase = first.database;
      expect(
        (firstDatabase.prepare("SELECT kind FROM transactions WHERE id = 'tx-investment'").get() as { kind: string }).kind,
      ).toBe("investment");
      firstDatabase
        .prepare("UPDATE transactions SET kind = 'spend' WHERE id = 'tx-investment'")
        .run();
      firstDatabase.close();
      firstDatabase = undefined;

      const reopened = await openDbForPath(dbPath);
      reopenedDatabase = reopened.database;
      expect(
        (reopenedDatabase.prepare("SELECT kind FROM transactions WHERE id = 'tx-investment'").get() as { kind: string }).kind,
      ).toBe("spend");
    } finally {
      firstDatabase?.close();
      reopenedDatabase?.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("AC-007 faz backfill de desc_norm somente nas linhas NULL e preserva valores existentes", async () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "finmonitor-legacy-ac007-"));
    const dbPath = path.join(tmpDir, "legacy.db");
    const legacy = createLegacyDb(dbPath, { descNorm: true, schemaVersion: "4" });
    legacy.prepare("INSERT INTO accounts (account_id, type, raw) VALUES ('bank-account', 'BANK', '{}')").run();
    insertLegacyTransaction(legacy, {
      id: "tx-null-description",
      accountId: "bank-account",
      date: "2025-03-01",
      description: "  Coffee 123  Shop ",
      amount: "-5.00",
      category: "Groceries",
    });
    insertLegacyTransaction(legacy, {
      id: "tx-manual-normalized",
      accountId: "bank-account",
      date: "2025-03-02",
      description: "Should preserve 456",
      amount: "-6.00",
      category: "Groceries",
    });
    insertLegacyTransaction(legacy, {
      id: "tx-null-description-value",
      accountId: "bank-account",
      date: "2025-03-03",
      description: null,
      amount: "7.00",
      category: "Salary",
    });
    legacy.prepare("UPDATE transactions SET desc_norm = 'manual-key' WHERE id = 'tx-manual-normalized'").run();
    legacy.close();

    let database: SqliteDatabase | undefined;
    try {
      const opened = await openDbForPath(dbPath);
      database = opened.database;
      const rows = database
        .prepare("SELECT id, description, desc_norm FROM transactions ORDER BY id")
        .all() as Array<{ id: string; description: string | null; desc_norm: string | null }>;

      expect(rows).toEqual([
        {
          id: "tx-manual-normalized",
          description: "Should preserve 456",
          desc_norm: "manual-key",
        },
        {
          id: "tx-null-description",
          description: "  Coffee 123  Shop ",
          desc_norm: normalizeDescription("  Coffee 123  Shop "),
        },
        {
          id: "tx-null-description-value",
          description: null,
          desc_norm: normalizeDescription(""),
        },
      ]);
    } finally {
      database?.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
