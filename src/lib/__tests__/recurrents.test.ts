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

// Âncoras determinísticas: dia 15 do mês corrente e do anterior (sempre
// dentro da janela de 120 dias e sempre em meses distintos).
const now = new Date();
const anchor = (monthsBack: number) =>
  new Date(now.getFullYear(), now.getMonth() - monthsBack, 15, 12).toISOString();
const dayInMonth = (monthsBack: number, dayOfMonth: number) =>
  new Date(now.getFullYear(), now.getMonth() - monthsBack, dayOfMonth, 12).toISOString();

const tx = (id: string, date: string) => ({
  id,
  date,
  description: "NETFLIX.COM ASSINATURA",
  amount: "-55.90",
  category: "streaming",
});
const key = () => analytics.recKey("streaming", "NETFLIX.COM ASSINATURA");

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

describe("detectRecurrents — frequência mensal", () => {
  it("frequência variável (4 lançamentos/mês em 2 meses) não é recorrência", () => {
    const rows = [0, 1].flatMap((m) =>
      [3, 8, 13, 18].map((d, i) => tx(`var-m${m}-${i}`, dayInMonth(m, d))),
    );
    repo.upsertTransactions("BANK", "acc-var", rows as never[]);
    expect(analytics.detectRecurrents().filter((r) => r.key === key())).toHaveLength(0);
  });

  it("assinatura mensal (1 lançamento/mês em 2 meses) é recorrência", () => {
    // o guard de lista vazia preserva as linhas do teste anterior; troca a
    // descrição para tirá-las da chave de recorrência sem apagá-las.
    repo.upsertTransactions("BANK", "acc-var", [
      { ...tx("var-x", anchor(0)), description: "OUTRA COISA LTDA" },
      { ...tx("var-y", anchor(1)), description: "OUTRA COISA LTDA" },
    ] as never[]);
    repo.upsertTransactions("BANK", "acc-rec", [
      tx("rec-0", anchor(1)),
      tx("rec-1", anchor(0)),
    ] as never[]);
    const found = analytics.detectRecurrents().filter((r) => r.key === key());
    expect(found).toHaveLength(1);
    expect(found[0].occurrences).toBe(2);
  });
});
