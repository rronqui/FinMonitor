import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type * as dbTypes from "../db";
import type * as repoTypes from "../repo";

let tmpDir: string;
let repo: typeof repoTypes;
let dbMod: typeof dbTypes;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "finmonitor-categorize-"));
  process.env.FINMONITOR_DB_PATH = path.join(tmpDir, "test.db");
  dbMod = await import("../db");
  repo = await import("../repo");

  // catálogo real: id -> descrição INGLESA (chave do provedor) + tradução pt-BR
  repo.upsertCategories([
    {
      id: "05100000",
      description: "Credit card payment",
      descriptionTranslated: "Pagamento de cartão de crédito",
      parentId: null,
      parentDescription: null,
    },
    {
      id: "01010000",
      description: "Salary",
      descriptionTranslated: "Salário",
      parentId: null,
      parentDescription: null,
    },
    {
      id: "03010000",
      description: "Groceries",
      descriptionTranslated: "Supermercado",
      parentId: null,
      parentDescription: null,
    },
  ]);

  repo.upsertAccounts([
    {
      id: "accBank",
      account_id: "accBank",
      type: "BANK",
      subtype: "CHECKING",
      name: "Conta corrente",
      number: "123",
      balance: "1000.00",
      currencyCode: "BRL",
    },
    {
      id: "accCredit",
      account_id: "accCredit",
      type: "CREDIT",
      subtype: "CREDIT_CARD",
      name: "Cartão",
      number: "456",
      balance: "500.00",
      currencyCode: "BRL",
    },
  ]);

  // raw do provedor NÃO contém account_id — o tipo da conta vem da COLUNA da
  // tabela, persistida por upsertTransactions (bug real: ler do raw dava BANK).
  // tx BANK com entrada (+100): sem categoria -> kind income.
  repo.upsertTransactions("BANK", "accBank", [
    {
      id: "tx1",
      date: "2026-07-15T10:00:00.000Z",
      description: "Compra",
      amount: "100",
      type: "DEBIT",
      status: "POSTED",
    },
  ]);
  // compra no cartão (CREDIT, valor POSITIVO): gasto. raw do provedor NÃO
  // contém account_id — replica o dado real que revelou o bug.
  repo.upsertTransactions("CREDIT", "accCredit", [
    {
      id: "tx2",
      date: "2026-07-16T10:00:00.000Z",
      description: "Mercado no cartão",
      amount: "250",
      type: "CREDIT",
      status: "POSTED",
    },
  ]);
});

afterAll(() => {
  dbMod.db().close();
  rmSync(tmpDir, { recursive: true, force: true });
});
function row(id: string): { category: string | null; kind: string } {
  return dbMod.db().prepare("SELECT category, kind FROM transactions WHERE id = ?").get(id) as {
    category: string | null;
    kind: string;
  };
}

describe("applyRecategorization", () => {
  it("grava a chave INGLESA da categoria e re-deriva kind=transfer", () => {
    repo.applyRecategorization([{ transaction_id: "tx1", category_id: "05100000" }]);
    const r = row("tx1");
    expect(r.category).toBe("Credit card payment");
    expect(r.kind).toBe("transfer");
  });

  it("recategorizar para Salary re-deriva kind=income", () => {
    repo.applyRecategorization([{ transaction_id: "tx1", category_id: "01010000" }]);
    const r = row("tx1");
    expect(r.category).toBe("Salary");
    expect(r.kind).toBe("income");
  });

  it("transaction_id inexistente é ignorado sem lançar", () => {
    expect(() =>
      repo.applyRecategorization([{ transaction_id: "naoexiste", category_id: "05100000" }]),
    ).not.toThrow();
    // a tx real permanece inalterada
    const r = row("tx1");
    expect(r.category).toBe("Salary");
    expect(r.kind).toBe("income");
  });

  it("category_id inexistente mantém a categoria/kind anteriores", () => {
    repo.applyRecategorization([{ transaction_id: "tx1", category_id: "zzzzzzzz" }]);
    const r = row("tx1");
    expect(r.category).toBe("Salary");
    expect(r.kind).toBe("income");
  });

  // REGRESSÃO do bug reportado: compra no cartão (CREDIT, valor POSITIVO)
  // recategorizada para uma categoria comum NÃO pode virar "income".
  // Antes da correção, account_id era lido do raw (undefined -> fallback BANK),
  // e a regra de sinal do BANK invertia o gasto do cartão para entrada.
  it("compra no cartão recategorizada permanece gasto (não vira entrada)", () => {
    repo.applyRecategorization([{ transaction_id: "tx2", category_id: "03010000" }]);
    const r = row("tx2");
    expect(r.category).toBe("Groceries");
    expect(r.kind).toBe("spend");
  });
});
