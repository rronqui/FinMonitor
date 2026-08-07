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

// Âncoras determinísticas: dia 15 do mês corrente e dos meses anteriores.
const now = new Date();
const anchor = (monthsBack: number) =>
  new Date(now.getFullYear(), now.getMonth() - monthsBack, 15, 12).toISOString();
const dayInMonth = (monthsBack: number, dayOfMonth: number) =>
  new Date(now.getFullYear(), now.getMonth() - monthsBack, dayOfMonth, 12).toISOString();

const tx = (
  id: string,
  date: string,
  description = "NETFLIX.COM ASSINATURA",
  amount = "-55.90",
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
});

afterAll(() => {
  dbMod.db().close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("detectRecurrents — estabilidade e recency", () => {
  it("AC-003: frequência variável (4 lançamentos/mês em 3 meses) não é recorrência", () => {
    const description = "NETFLIX.COM ASSINATURA";
    const rows = [2, 1, 0].flatMap((m) =>
      [3, 8, 13, 18].map((day, i) =>
        tx(`variable-m${m}-${i}`, dayInMonth(m, day), description),
      ),
    );
    repo.upsertTransactions("BANK", "acc-variable", rows as never[]);

    expect(
      analytics
        .detectRecurrents()
        .filter((r) => r.key === analytics.recKey("streaming", description)),
    ).toHaveLength(0);
  });

  it("AC-002: assinatura mensal em somente 2 meses não é recorrência", () => {
    const description = "SPOTIFY ASSINATURA";
    const rows = [1, 0].map((m) => tx(`two-months-${m}`, anchor(m), description));
    repo.upsertTransactions("BANK", "acc-two-months", rows as never[]);

    expect(
      analytics
        .detectRecurrents()
        .filter((r) => r.key === analytics.recKey("streaming", description)),
    ).toHaveLength(0);
  });

  it("AC-001: seis ocorrências mensais estáveis são detectadas com mediana e contagem corretas", () => {
    const description = "DISNEY PLUS";
    const amounts = ["-90.00", "-100.00", "-100.00", "-110.00", "-100.00", "-120.00"];
    const rows = [5, 4, 3, 2, 1, 0].map((m, i) =>
      tx(`six-months-${m}`, anchor(m), description, amounts[i]),
    );
    repo.upsertTransactions("BANK", "acc-six-months", rows as never[]);

    const found = analytics
      .detectRecurrents()
      .filter((r) => r.key === analytics.recKey("streaming", description));
    expect(found).toHaveLength(1);
    expect(found[0]?.monthly).toBe(100);
    expect(found[0]?.occurrences).toBe(6);
  });

  it("AC-004a: recorrência estável que terminou há 3 ciclos não é detectada", () => {
    const description = "HBO MAX";
    const rows = [9, 8, 7, 6, 5, 4, 3].map((m) =>
      tx(`stale-three-cycles-${m}`, anchor(m), description, "-120.00"),
    );
    repo.upsertTransactions("BANK", "acc-stale-three-cycles", rows as never[]);

    expect(
      analytics
        .detectRecurrents()
        .filter((r) => r.key === analytics.recKey("streaming", description)),
    ).toHaveLength(0);
  });

  it("AC-004b: recorrência estável com somente um ciclo perdido é detectada", () => {
    const description = "PRIME VIDEO";
    const rows = [3, 2, 1].map((m) =>
      tx(`stale-one-cycle-${m}`, anchor(m), description, "-42.50"),
    );
    repo.upsertTransactions("BANK", "acc-stale-one-cycle", rows as never[]);

    const found = analytics
      .detectRecurrents()
      .filter((r) => r.key === analytics.recKey("streaming", description));
    expect(found).toHaveLength(1);
    expect(found[0]?.monthly).toBe(42.5);
    expect(found[0]?.occurrences).toBe(3);
  });

  it("AC-005: windfall income instável não é detectado", () => {
    const description = "APPLE TV";
    const rows = [
      tx("windfall-large-1", dayInMonth(4, 5), description, "10000.00", "salary"),
      tx("windfall-large-2", dayInMonth(4, 6), description, "20000.00", "salary"),
      tx("windfall-small-middle", dayInMonth(2, 15), description, "100.00", "salary"),
      tx("windfall-small", anchor(0), description, "100.00", "salary"),
    ];
    repo.upsertTransactions("BANK", "acc-windfall", rows as never[]);

    expect(
      analytics
        .detectRecurrents()
        .filter((r) => r.key === analytics.recKey("salary", description)),
    ).toHaveLength(0);
  });
  it("AC-006: renda mensal estável recente é detectada como income", () => {
    const description = "SALARIO MENSAL FIXO";
    const rows = [5, 4, 3, 2, 1, 0].map((m) =>
      tx(`stable-income-${m}`, anchor(m), description, "2500.00", "salary"),
    );
    repo.upsertTransactions("BANK", "acc-stable-income", rows as never[]);

    const found = analytics
      .detectRecurrents()
      .filter((r) => r.key === analytics.recKey("salary", description));
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe("income");
    expect(found[0]?.monthly).toBe(2500);
    expect(found[0]?.occurrences).toBe(6);
  });

});
