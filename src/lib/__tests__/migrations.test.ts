import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type * as dbTypes from "../db";

let tmpDir: string;
let dbMod: typeof dbTypes;
type MigrationLike = {
  version: number;
  name: string;
  run: (d: Database.Database) => void;
};
type MigrationsModule = {
  CURRENT_SCHEMA_VERSION: number;
  migrations: MigrationLike[];
  migrate: (d: Database.Database) => void;
};
let migrationsMod: MigrationsModule | null;

function isMigrationsModule(value: unknown): value is MigrationsModule {
  if (value === null || typeof value !== "object") return false;
  if (!("CURRENT_SCHEMA_VERSION" in value) || !("migrations" in value) || !("migrate" in value)) return false;
  if (typeof value.CURRENT_SCHEMA_VERSION !== "number" || typeof value.migrate !== "function") return false;
  if (!Array.isArray(value.migrations)) return false;
  return value.migrations.every(
    (migration) =>
      migration !== null &&
      typeof migration === "object" &&
      "version" in migration &&
      "name" in migration &&
      "run" in migration &&
      typeof migration.version === "number" &&
      typeof migration.name === "string" &&
      typeof migration.run === "function",
  );
}

const previousDbPath = process.env.FINMONITOR_DB_PATH;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "finmonitor-migrations-test-"));
  process.env.FINMONITOR_DB_PATH = path.join(tmpDir, "test.db");
  // db.ts lê FINMONITOR_DB_PATH durante o carregamento do módulo.
  dbMod = await import("../db");
  // Import dinâmico guardado é intencional: migrations.ts ainda não existe na fase RED.
  const loaded: unknown = await import("../migrations").catch(() => null);
  migrationsMod = isMigrationsModule(loaded) ? loaded : null;
});

afterAll(() => {
  dbMod?.db().close();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousDbPath === undefined) delete process.env.FINMONITOR_DB_PATH;
  else process.env.FINMONITOR_DB_PATH = previousDbPath;
});

function schemaShape(d: Database.Database) {
  const tables = (d
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as Array<{ name: string }>).map(({ name }) => ({
    name,
    columns: (d.prepare(`PRAGMA table_info('${name.replaceAll("'", "''")}')`).all() as Array<{ name: string }>).map(
      ({ name: column }) => column,
    ),
  }));
  const indexes = (d
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as Array<{ name: string }>).map(({ name }) => name);
  return { tables, indexes };
}

const expectedColumns: Record<string, string[]> = {
  meta: ["key", "value"],
  connections: ["item_id", "connector_id", "connector_name", "status", "reconnect_url", "created_at", "raw"],
  accounts: [
    "account_id",
    "type",
    "subtype",
    "name",
    "number",
    "balance",
    "currency_code",
    "bank_data",
    "credit_data",
    "raw",
  ],
  transactions: [
    "id",
    "account_id",
    "date",
    "description",
    "amount",
    "type",
    "status",
    "category",
    "category_id",
    "raw",
    "kind",
    "abs_amount",
    "desc_norm",
  ],
  bills: ["id", "account_id", "due_date", "total_amount", "minimum_payment", "payment_status", "raw"],
  investments: [
    "id",
    "name",
    "type",
    "subtype",
    "balance",
    "amount",
    "amount_original",
    "amount_withdrawal",
    "taxes",
    "rate",
    "rate_type",
    "issuer",
    "issue_date",
    "raw",
  ],
  loans: ["id", "item_id", "type", "contract_amount", "due_date", "contract_number", "raw"],
  categories: ["id", "description", "description_translated", "parent_id", "parent_description"],
  sync_log: ["id", "started_at", "finished_at", "status", "detail"],
  investment_movements: ["id", "investment_id", "date", "type", "net_amount"],
};

describe("mecanismo de migrações versionadas", () => {
  it("AC-001: cria o DB novo na versão atual e no schema final", () => {
    const d = dbMod.db();
    const currentVersion = migrationsMod?.CURRENT_SCHEMA_VERSION ?? 5;
    expect(dbMod.getMeta("schema_version")).toBe(String(currentVersion));

    const shape = schemaShape(d);
    expect(shape.tables.map(({ name }) => name)).toEqual(Object.keys(expectedColumns).sort());
    for (const table of shape.tables) {
      expect(table.columns, `colunas finais de ${table.name}`).toEqual(expectedColumns[table.name]);
    }
    expect(shape.indexes).toContain("idx_tx_account_date");
  });

  it("AC-002: reabrir/aplicar migrate na versão final é idempotente", () => {
    const d = dbMod.db();
    if (!migrationsMod) {
      expect(migrationsMod).not.toBeNull();
      return;
    }

    const before = schemaShape(d);
    migrationsMod.migrate(d);
    const after = schemaShape(d);
    expect(dbMod.getMeta("schema_version")).toBe(String(migrationsMod.CURRENT_SCHEMA_VERSION));
    expect(after).toEqual(before);
  });

  it("AC-003: rejeita schema_version futuro com erro explícito", () => {
    const d = new Database(":memory:");
    try {
      d.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
      d.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', '999')").run();
      if (!migrationsMod) {
        expect(migrationsMod).not.toBeNull();
        return;
      }

      const mod = migrationsMod;
      const current = mod.CURRENT_SCHEMA_VERSION;
      expect(() => mod.migrate(d)).toThrowError(
        new RegExp(`(?:999.*${current}|${current}.*999)`),
      );
    } finally {
      d.close();
    }
  });

  it("AC-004: falha de migração reverte schema intermediário e versão", () => {
    if (!migrationsMod) {
      expect(migrationsMod).not.toBeNull();
      return;
    }
    const mod = migrationsMod;
    expect(mod.migrations).toEqual(expect.any(Array));
    expect(mod.migrations.length).toBeGreaterThan(0);

    const d = new Database(":memory:");
    const firstMigration = mod.migrations[0];
    const runSpy = vi.spyOn(firstMigration, "run").mockImplementation((target: Database.Database) => {
      target.exec("CREATE TABLE migration_partial_state (id INTEGER PRIMARY KEY)");
      throw new Error("intentional migration failure");
    });
    try {
      d.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
      d.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', '0')").run();

      expect(() => mod.migrate(d)).toThrowError("intentional migration failure");
      expect(
        d.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migration_partial_state'",
        ).get(),
      ).toBeUndefined();
      expect(d.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()).toEqual({ value: "0" });
    } finally {
      runSpy.mockRestore();
      d.close();
    }
  });

  it("AC-008: DB novo e migrate sobre DB vazio produzem o mesmo schema", () => {
    if (!migrationsMod) {
      expect(migrationsMod).not.toBeNull();
      return;
    }
    expect(typeof migrationsMod.migrate).toBe("function");
    expect(migrationsMod.migrations).toEqual(expect.any(Array));

    const createdByDb = schemaShape(dbMod.db());
    const empty = new Database(":memory:");
    try {
      migrationsMod.migrate(empty);
      expect(schemaShape(empty)).toEqual(createdByDb);
    } finally {
      empty.close();
    }
  });
});
