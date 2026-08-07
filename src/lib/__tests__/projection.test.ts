import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type * as analyticsTypes from "../analytics";
import type * as dbTypes from "../db";
import type * as repoTypes from "../repo";

let tmpDir: string;
let analytics: typeof analyticsTypes;
let dbMod: typeof dbTypes;
let repo: typeof repoTypes;

type ProjectionResult = {
  days: Array<{ day: string; saldo: number }>;
  premissas?: {
    recorrentes: Array<{ key: string; label: string; kind: string; monthly: number }>;
    unicos: Array<{ day: string; value: number; label: string }>;
  };
};

// Âncoras determinísticas: dia 15 do mês corrente e dos meses anteriores.
const now = new Date();
const anchor = (monthsBack: number) =>
  new Date(now.getFullYear(), now.getMonth() - monthsBack, 15, 12).toISOString();
const dayInMonth = (monthsBack: number, dayOfMonth: number) =>
  new Date(now.getFullYear(), now.getMonth() - monthsBack, dayOfMonth, 12).toISOString();

const tx = (
  id: string,
  date: string,
  description = "PROJECAO ASSINATURA",
  amount = "-100.00",
  category = "streaming",
) => ({
  id,
  date,
  description,
  amount,
  category,
});

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "finmonitor-test-"));
  process.env.FINMONITOR_DB_PATH = path.join(tmpDir, "test.db");
  // import dinâmico obrigatório: db.ts lê FINMONITOR_DB_PATH no load do módulo;
  // um import estático seria içado acima da definição do env.
  dbMod = await import("../db");
  repo = await import("../repo");
  analytics = await import("../analytics");
  dbMod
    .db()
    .prepare("INSERT INTO accounts (account_id, type, raw, balance) VALUES (?, 'BANK', '{}', ?)")
    .run("acc-proj", "1000");
});

afterAll(() => {
  dbMod.db().close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("buildProjection — premissas e runway", () => {
  it("AC-006a: recorrência estável entra nos dias e nas premissas", () => {
    const description = "PROJECAO SEGURO MENSAL";
    const rows = [6, 5, 4, 3, 2, 1].map((m) =>
      tx(`projection-stable-${m}`, dayInMonth(m, 10), description),
    );
    repo.upsertTransactions("BANK", "acc-proj", rows as never[]);

    const nowD = new Date();
    const firstExpected = nowD.getDate() <= 10
      ? new Date(nowD.getFullYear(), nowD.getMonth(), 10)
      : new Date(nowD.getFullYear(), nowD.getMonth() + 1, 10);
    const expectedDay = `${firstExpected.getFullYear()}-${String(firstExpected.getMonth() + 1).padStart(2, "0")}-${String(firstExpected.getDate()).padStart(2, "0")}`;

    const res = analytics.buildProjection(60) as unknown as ProjectionResult;
    const days = res.days ?? [];
    const recurring = res.premissas?.recorrentes ?? [];
    const firstDrop = days.findIndex((point) => point.saldo !== 1000);
    expect(days.find((point) => point.saldo !== 1000)?.day).toBe(expectedDay);

    expect(res.premissas).toBeDefined();
    expect(recurring).toHaveLength(1);
    expect(recurring[0]?.label).toBe(description);
    expect(recurring[0]?.monthly).toBe(100);
    expect(days).toHaveLength(60);
    expect(firstDrop).toBeGreaterThanOrEqual(0);
    expect(days.some((point) => point.saldo === 800)).toBe(true);
    expect(days.every((point) => [1000, 900, 800].includes(point.saldo))).toBe(true);
    expect(
      days.every((point, index) => (point.saldo === 1000) === (index < firstDrop)),
    ).toBe(true);
  });

  it("AC-006b: renda estável sem evidência recente não entra na projeção", () => {
    const description = "PROJECAO SALARIO HISTORICO";
    const rows = [9, 8, 7, 6, 5, 4, 3].map((m) =>
      tx(`projection-stale-income-${m}`, anchor(m), description, "2500.00", "salary"),
    );
    repo.upsertTransactions("BANK", "acc-proj", rows as never[]);

    const res = analytics.buildProjection(60) as unknown as ProjectionResult;
    const days = res.days ?? [];

    expect(res.premissas).toBeDefined();
    expect(days).toHaveLength(60);
    expect(days.every((point) => point.saldo === 1000)).toBe(true);
    expect(res.premissas?.recorrentes ?? []).toHaveLength(0);
  });

  it("AC-006c: windfall não entra na projeção nem nas premissas", () => {
    const description = "PROJECAO WINDFALL";
    const rows = [
      tx("projection-windfall-large-1", dayInMonth(4, 5), description, "10000.00", "salary"),
      tx("projection-windfall-large-2", dayInMonth(4, 6), description, "20000.00", "salary"),
      tx("projection-windfall-small-middle", dayInMonth(2, 15), description, "100.00", "salary"),
      tx("projection-windfall-small", anchor(0), description, "100.00", "salary"),
    ];
    repo.upsertTransactions("BANK", "acc-proj", rows as never[]);

    const res = analytics.buildProjection(60) as unknown as ProjectionResult;
    const days = res.days ?? [];

    expect(res.premissas).toBeDefined();
    expect(days).toHaveLength(60);
    expect(days.every((point) => point.saldo === 1000)).toBe(true);
    expect(res.premissas?.recorrentes ?? []).toHaveLength(0);
  });

  it("AC-006e: renda mensal estável recente entra como income", () => {
    const description = "PROJECAO SALARIO FIXO";
    const rows = [6, 5, 4, 3, 2, 1].map((m) =>
      tx(`projection-income-${m}`, dayInMonth(m, 10), description, "2500.00", "salary"),
    );
    repo.upsertTransactions("BANK", "acc-proj", rows as never[]);

    const nowD = new Date();
    const firstExpected = nowD.getDate() <= 10
      ? new Date(nowD.getFullYear(), nowD.getMonth(), 10)
      : new Date(nowD.getFullYear(), nowD.getMonth() + 1, 10);
    const expectedDay = `${firstExpected.getFullYear()}-${String(firstExpected.getMonth() + 1).padStart(2, "0")}-${String(firstExpected.getDate()).padStart(2, "0")}`;
    const res = analytics.buildProjection(60) as unknown as ProjectionResult;
    const days = res.days ?? [];
    const recurring = res.premissas?.recorrentes ?? [];
    const firstRise = days.findIndex((point) => point.saldo !== 1000);

    expect(res.premissas).toBeDefined();
    expect(recurring).toHaveLength(1);
    expect(recurring[0]?.kind).toBe("income");
    expect(recurring[0]?.monthly).toBe(2500);
    expect(days).toHaveLength(60);
    expect(firstRise).toBeGreaterThanOrEqual(0);
    expect(days.find((point) => point.saldo !== 1000)?.day).toBe(expectedDay);
    expect(days.some((point) => point.saldo === 3500)).toBe(true);
    expect(days.every((point) => [1000, 3500, 6000].includes(point.saldo))).toBe(true);
    expect(
      days.every((point, index) => (point.saldo === 1000) === (index < firstRise)),
    ).toBe(true);
  });

  it("AC-006f: recorrência cuja próxima projeção cai exatamente após o horizonte não entra nas premissas", () => {
    const nowD = new Date();
    const dim = new Date(nowD.getFullYear(), nowD.getMonth() + 1, 0).getDate();
    const F = (nowD.getDate() % 28) + 1; // 1..28, sempre diferente do dia de hoje
    const days = nowD.getDate() < F ? F - nowD.getDate() : dim - nowD.getDate() + F;
    const description = "PROJECAO FRONTEIRA HORIZONTE";
    const rows = [6, 5, 4, 3, 2, 1].map((m) =>
      tx(`horizon-edge-${m}`, dayInMonth(m, F), description),
    );
    repo.upsertTransactions("BANK", "acc-proj", rows as never[]);

    const res = analytics.buildProjection(days) as unknown as ProjectionResult;
    expect(res.premissas?.recorrentes ?? []).toHaveLength(0);
    expect(res.days.every((point) => point.saldo === 1000)).toBe(true);
  });

  it("AC-006d: balloon payment entra no saldo no dia exato e nas premissas únicas", () => {
    const description = "PROJECAO PARCELA AVULSA";
    repo.upsertTransactions("BANK", "acc-proj", [
      tx("projection-one-off", anchor(0), description, "-10.00", "loan"),
    ] as never[]);

    const dueDay = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    dbMod
      .db()
      .prepare("INSERT INTO loans (id, raw) VALUES (?, ?)")
      .run(
        "loan-1",
        JSON.stringify({
          balloonPayments: [{ dueDate: `${dueDay}T12:00:00.000Z`, amount: { value: 500 } }],
        }),
      );

    const res = analytics.buildProjection(60) as unknown as ProjectionResult;
    const days = res.days ?? [];
    const duePoint = days.find((point) => point.day === dueDay);

    expect(res.premissas).toBeDefined();
    expect(duePoint?.saldo).toBe(500);
    expect(res.premissas?.unicos ?? []).toEqual([
      { day: dueDay, value: 500, label: "Parcela única de empréstimo" },
    ]);
  });
});
