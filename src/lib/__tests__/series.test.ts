import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type * as dbTypes from "../db";
import type * as repoTypes from "../repo";

let tmpDir: string;
let repo: typeof repoTypes;
let dbMod: typeof dbTypes;
const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
const iso = (offset: number) => `${day(offset)}T12:00:00.000Z`;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "finmonitor-test-"));
  process.env.FINMONITOR_DB_PATH = path.join(tmpDir, "test.db");
  // import dinâmico obrigatório: db.ts lê FINMONITOR_DB_PATH no load do módulo;
  // um import estático seria içado acima da definição do env.
  dbMod = await import("../db");
  repo = await import("../repo");
});

afterAll(() => {
  dbMod.db().close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("queryInvestmentSeries", () => {
  it("caminhada reversa com BUY/SELL", () => {
    repo.upsertInvestments([
      {
        id: "inv1",
        name: "CDB Teste",
        type: "FIXED_INCOME",
        subtype: "CDB",
        balance: "1000.00",
        currencyCode: "BRL",
        status: "ACTIVE",
        amount: "1000.00",
        amountOriginal: "850.00",
        amountWithdrawal: "1000.00",
        taxes: "0",
      },
    ]);
    repo.upsertInvestmentMovements([
      { id: "m1", investment_id: "inv1", date: iso(2), type: "BUY", net_amount: 300 },
      { id: "m2", investment_id: "inv1", date: iso(1), type: "SELL", net_amount: 150 },
    ]);

    const series = repo.queryInvestmentSeries(4);
    expect(series).toHaveLength(4);
    // cronológico: hoje por último
    expect(series[3].day).toBe(day(0));
    expect(series.map((p) => p.investido)).toEqual([850, 1150, 1000, 1000]);
  });

  it("movimento com type desconhecido (OTHER) não altera a série (delta 0)", () => {
    // mesmo setup do caso anterior + um movimento OTHER que deve ser ignorado
    repo.upsertInvestmentMovements([
      { id: "m3", investment_id: "inv1", date: iso(3), type: "OTHER", net_amount: 500 },
    ]);
    const series = repo.queryInvestmentSeries(4);
    expect(series).toHaveLength(4);
    expect(series.map((p) => p.investido)).toEqual([850, 1150, 1000, 1000]);
  });
});

describe("queryMonthlyStats", () => {
  it("agrega por mês e zera meses sem dados", () => {
    const d = dbMod.db();
    const now = new Date();
    const monthISO = (back: number, dayOfMonth: number) => {
      const dt = new Date(now.getFullYear(), now.getMonth() - back, dayOfMonth, 12);
      return dt.toISOString();
    };
    const ins = d.prepare(
      "INSERT INTO transactions (id, account_id, date, description, amount, type, status, category, category_id, kind, abs_amount, raw) VALUES (?, 'acc1', ?, '', ?, '', '', NULL, NULL, ?, ?, '{}')",
    );
    // mês corrente: spend 100 (2 lançamentos) + income 50
    ins.run("t1", monthISO(0, 3), "-60", "spend", 60);
    ins.run("t2", monthISO(0, 5), "-40", "spend", 40);
    ins.run("t3", monthISO(0, 6), "50", "income", 50);
    // mês anterior: spend 200
    ins.run("t4", monthISO(1, 10), "-200", "spend", 200);
    // transferências não entram na série
    ins.run("t5", monthISO(0, 7), "-999", "transfer", 999);

    const stats = repo.queryMonthlyStats(3);
    expect(stats).toHaveLength(3);
    const key = (back: number) => {
      const dt = new Date(now.getFullYear(), now.getMonth() - back, 1);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
    };
    expect(stats[2]).toEqual({ month: key(0), spend: 100, income: 50 });
    expect(stats[1]).toEqual({ month: key(1), spend: 200, income: 0 });
    expect(stats[0]).toEqual({ month: key(2), spend: 0, income: 0 });
  });
});

describe("txWhere windows (drill-down de janelas comparadas)", () => {
  it("retorna só as transações dentro das janelas; gap e fim exclusivo ficam de fora", () => {
    const d = dbMod.db();
    const ins = d.prepare(
      "INSERT INTO transactions (id, account_id, date, description, amount, type, status, category, category_id, kind, abs_amount, raw) VALUES (?, 'accw', ?, '', ?, '', '', NULL, NULL, ?, ?, ?)",
    );
    // w10 e w1 dentro das janelas; w5 no gap; w9 exatamente no fim exclusivo de W1
    ins.run("w10", iso(10), "-100", "spend", 100, '{"id":"w10"}');
    ins.run("w9", iso(9), "-90", "spend", 90, '{"id":"w9"}');
    ins.run("w5", iso(5), "-50", "spend", 50, '{"id":"w5"}');
    ins.run("w1", iso(1), "-10", "spend", 10, '{"id":"w1"}');

    const w1 = { from: iso(10), to: iso(9) };
    const w2 = { from: iso(1), to: iso(0) };
    const q = { accountId: "accw", windows: [w1, w2] };
    const { total, results } = repo.queryTransactions({ ...q, page: 1, pageSize: 50 });
    expect(total).toBe(2);
    expect(results.map((t) => t.id).sort()).toEqual(["w1", "w10"]);

    const sum = repo.queryTransactionsSummary(q);

    expect(sum.saidas).toBe(110);
    expect(sum.total).toBe(2);
  });
});
