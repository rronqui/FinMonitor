import { describe, expect, it } from "vitest";
import { classify, prettifyCategory } from "../semantics";

describe("classify", () => {
  it("BANK negativo é gasto", () => {
    expect(classify("BANK", -42.5, "Groceries")).toEqual({ kind: "spend", valor: 42.5 });
  });

  it("BANK positivo é entrada", () => {
    expect(classify("BANK", 1000, "Salary")).toEqual({ kind: "income", valor: 1000 });
  });

  it("CREDIT positivo é gasto (compra)", () => {
    expect(classify("CREDIT", 89.9, "Shopping")).toEqual({ kind: "spend", valor: 89.9 });
  });

  it("CREDIT negativo é entrada (estorno/pagamento recebido)", () => {
    expect(classify("CREDIT", -15, "Refund")).toEqual({ kind: "income", valor: 15 });
  });

  it("categorias de transferência viram transfer independente de conta/sinal", () => {
    expect(classify("BANK", -500, "Credit card payment").kind).toBe("transfer");
    expect(classify("CREDIT", 500, "Same person transfer").kind).toBe("transfer");
  });

  it("categorias de investimento viram investment independente de conta/sinal", () => {
    expect(classify("BANK", -200, "Fixed income").kind).toBe("investment");
    expect(classify("BANK", 200, "Investments").kind).toBe("investment");
    expect(classify("CREDIT", -50, "Variable income").kind).toBe("investment");
  });
});

describe("prettifyCategory", () => {
  it("title-case com conectores minúsculos", () => {
    expect(prettifyCategory("taxi and ride-hailing")).toBe("Taxi and Ride-Hailing");
  });

  it("mantém categoria já formatada", () => {
    expect(prettifyCategory("Groceries")).toBe("Groceries");
  });

  it("colapsa múltiplos espaços preservando o separador", () => {
    expect(prettifyCategory("PROCEEDS INTERESTS AND DIVIDENDS")).toBe("Proceeds Interests and Dividends");
  });
});
