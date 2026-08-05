import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type * as dbTypes from "../db";
import type * as repoTypes from "../repo";

let tmpDir: string;
let repo: typeof repoTypes;
let dbMod: typeof dbTypes;

const DUE = "2026-07-15";

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "finmonitor-bills-"));
  process.env.FINMONITOR_DB_PATH = path.join(tmpDir, "test.db");
  dbMod = await import("../db");
  repo = await import("../repo");

  repo.upsertAccounts([
    {
      id: "accBank",
      account_id: "accBank",
      type: "BANK",
      subtype: "CHECKING",
      name: "Conta corrente",
      number: "1",
      balance: "5000.00",
      currencyCode: "BRL",
    },
    {
      id: "accCredit",
      account_id: "accCredit",
      type: "CREDIT",
      subtype: "CREDIT_CARD",
      name: "Cartão",
      number: "2",
      balance: "1000.00",
      currencyCode: "BRL",
    },
  ]);

  // fatura overdue no cartão: total 1000, vencimento D
  repo.upsertBills("accCredit", [
    {
      id: "bill1",
      dueDate: DUE,
      totalAmount: "1000.00",
      minimumPaymentAmount: "50.00",
      payment_status: "PAST_DUE_UNPAID",
    },
  ]);
});

afterAll(() => {
  dbMod.db().close();
  rmSync(tmpDir, { recursive: true, force: true });
});

/** insere um pagamento "Credit card payment" na conta corrente num dado dia. */
function pay(amount: number, day: string) {
  repo.upsertTransactions("BANK", "accBank", [
    {
      id: `pay-${day}-${amount}`,
      account_id: "accBank",
      date: `${day}T10:00:00.000Z`,
      description: "Pagamento cartão",
      amount: String(amount),
      type: "DEBIT",
      status: "POSTED",
      category: "Credit card payment",
    },
  ]);
}

describe("detectDisputedBills (semântica AND: valor E data)", () => {
  it("pagamento de valor exato no dia do vencimento casa a fatura", () => {
    pay(-1000, DUE);
    const d = repo.detectDisputedBills();
    expect(d["bill1"]).toBeDefined();
    expect(d["bill1"].paymentAmount).toBe(1000);
  });

  it("pagamento fora da tolerância (500) no dia do vencimento NÃO casa", () => {
    pay(-500, DUE);
    const d = repo.detectDisputedBills();
    expect(d["bill1"]).toBeUndefined();
  });

  it("pagamento de valor exato fora da janela (D+10) NÃO casa", () => {
    pay(-1000, "2026-07-25");
    const d = repo.detectDisputedBills();
    expect(d["bill1"]).toBeUndefined();
  });
});

describe("readInvestments (ordenação numérica decrescente)", () => {
  it("retorna por CAST(amount_withdrawal AS REAL) DESC, não TEXT", () => {
    repo.upsertInvestments([
      {
        id: "inv-9000",
        name: "Pequeno",
        type: "FIXED_INCOME",
        subtype: "CDB",
        balance: "9000.00",
        currencyCode: "BRL",
        status: "ACTIVE",
        amount: "9000.00",
        amountOriginal: "9000.00",
        amountWithdrawal: "9000.00",
        taxes: "0",
      },
      {
        id: "inv-338",
        name: "Grande",
        type: "FIXED_INCOME",
        subtype: "CDB",
        balance: "338155.79",
        currencyCode: "BRL",
        status: "ACTIVE",
        amount: "338155.79",
        amountOriginal: "338155.79",
        amountWithdrawal: "338155.79",
        taxes: "0",
      },
      {
        id: "inv-59",
        name: "Médio",
        type: "FIXED_INCOME",
        subtype: "CDB",
        balance: "59260.49",
        currencyCode: "BRL",
        status: "ACTIVE",
        amount: "59260.49",
        amountOriginal: "59260.49",
        amountWithdrawal: "59260.49",
        taxes: "0",
      },
    ]);
    const list = repo.readInvestments();
    expect(list.map((i) => i.amountWithdrawal)).toEqual(["338155.79", "59260.49", "9000.00"]);
  });
});
