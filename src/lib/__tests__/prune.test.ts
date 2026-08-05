import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type * as dbTypes from "../db";
import type * as repoTypes from "../repo";

let tmpDir: string;
let dbMod: typeof dbTypes;
let repo: typeof repoTypes;

const ids = (table: string, column: string): string[] =>
  (dbMod.db().prepare(`SELECT ${column} AS v FROM ${table}`).all() as Array<{ v: string }>).map(
    (r) => r.v,
  );

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "finmonitor-test-"));
  process.env.FINMONITOR_DB_PATH = path.join(tmpDir, "test.db");
  // import dinâmico obrigatório: db.ts lê FINMONITOR_DB_PATH no load do módulo;
  // um import estático seria içado acima da definição do env.
  dbMod = await import("../db");
  repo = await import("../repo");
  const d = dbMod.db();
  d.prepare("INSERT INTO connections (item_id, raw) VALUES (?, '{}')").run("item-1");
  d.prepare("INSERT INTO connections (item_id, raw) VALUES (?, '{}')").run("item-2");
  d.prepare("INSERT INTO accounts (account_id, type, raw) VALUES (?, 'BANK', '{}')").run("acc-keep");
  d.prepare("INSERT INTO accounts (account_id, type, raw) VALUES (?, 'BANK', '{}')").run("acc-gone");
  const tx = d.prepare(
    "INSERT INTO transactions (id, account_id, date, amount, raw) VALUES (?, ?, '2026-01-01T00:00:00.000Z', '-10', '{}')",
  );
  tx.run("tx-keep", "acc-keep");
  tx.run("tx-gone", "acc-gone");
  d.prepare("INSERT INTO bills (id, account_id, raw) VALUES (?, ?, '{}')").run("bill-gone", "acc-gone");
  d.prepare("INSERT INTO investments (id, raw) VALUES (?, '{}')").run("inv-keep");
  d.prepare("INSERT INTO investments (id, raw) VALUES (?, '{}')").run("inv-gone");
  d.prepare(
    "INSERT INTO investment_movements (id, investment_id, date, type, net_amount) VALUES (?, ?, '2026-01-01T00:00:00.000Z', 'BUY', 10)",
  ).run("mov-gone", "inv-gone");
  d.prepare("INSERT INTO loans (id, raw) VALUES (?, '{}')").run("loan-gone");
});

afterAll(() => {
  dbMod.db().close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("prune* — entidades que saíram do provedor", () => {
  it("remove conexões fora da lista e preserva as demais", () => {
    repo.pruneConnections(["item-1"]);
    expect(ids("connections", "item_id")).toEqual(["item-1"]);
  });

  it("remove conta, transações e faturas da conta removida (cascata)", () => {
    repo.pruneAccounts(["acc-keep"]);
    expect(ids("accounts", "account_id")).toEqual(["acc-keep"]);
    expect(ids("transactions", "id")).toEqual(["tx-keep"]);
    expect(ids("bills", "id")).toEqual([]);
  });

  it("remove investimento e movimentações do investimento removido", () => {
    repo.pruneInvestments(["inv-keep"]);
    expect(ids("investments", "id")).toEqual(["inv-keep"]);
    expect(ids("investment_movements", "investment_id")).toEqual([]);
  });

  it("remove empréstimos fora da lista", () => {
    repo.pruneLoans([]); // guard: lista vazia não apaga nada
    expect(ids("loans", "id")).toEqual(["loan-gone"]);
    repo.pruneLoans(["loan-keep"]);
    expect(ids("loans", "id")).toEqual([]);
  });
});
