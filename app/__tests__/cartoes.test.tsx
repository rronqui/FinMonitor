import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  bundle: null as unknown,
  bills: null as unknown,
  comparison: null as unknown,
}));

vi.mock("@/src/lib/hooks", () => ({
  useAccountsBundle: () => mockState.bundle,
  useBills: () => mockState.bills,
  useBillsComparison: () => mockState.comparison,
}));

const normalized = (value: string) => value.replace(/\s+/g, " ").trim();
const expectVisibleText = (expected: string) => {
  expect(normalized(document.body.textContent ?? "")).toContain(normalized(expected));
};
const expectNotVisibleText = (expected: string) => {
  expect(normalized(document.body.textContent ?? "")).not.toContain(normalized(expected));
};


import CardsPage from "../cartoes/page";
import { brl, dateBR } from "@/src/lib/format";

const ok = <T,>(data: T) => ({ data, isLoading: false, isError: false, error: null, refetch: vi.fn() });
const loading = () => ({ data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn() });
const error = (message: string) => ({ data: undefined, isLoading: false, isError: true, error: new Error(message), refetch: vi.fn() });

const creditAccount = {
  id: "account-1",
  account_id: "account-1",
  type: "CREDIT" as const,
  subtype: "CREDIT_CARD",
  name: "Cartão Azul",
  number: "**** 1234",
  balance: "3000",
  currencyCode: "BRL",
  creditData: {
    brand: "Mastercard",
    level: "Black",
    creditLimit: "5000",
    availableCreditLimit: "2000",
    balanceDueDate: "2026-08-15",
    minimumPayment: "150.5",
  },
};

const bankAccount = {
  id: "account-bank",
  account_id: "account-bank",
  type: "BANK" as const,
  subtype: "CHECKING",
  name: "Conta Azul",
  number: "**** 4321",
  balance: "1000",
  currencyCode: "BRL",
};

const billsWithRows = {
  total: 2,
  results: [
    {
      id: "b-paid",
      dueDate: "2026-08-15",
      totalAmount: "1000",
      minimumPaymentAmount: "100",
      payment_status: "PAID",
    },
    {
      id: "b-open",
      dueDate: "2026-09-15",
      totalAmount: "2000",
      minimumPaymentAmount: "200",
      payment_status: "OPEN",
    },
  ],
  disputed: {},
};

const baseBundle = {
  connections: { connections: [], count: 0 },
  accounts: { total: 1, bank: "Banco Azul", item_id: "item-1", results: [creditAccount] },
  details: { results: [] },
};

const emptyComparison = {
  accountId: "account-1",
  current: null,
  previous: null,
  delta: null,
  deltaPct: null,
};

function setDefaults() {
  mockState.bundle = ok(baseBundle);
  mockState.bills = ok({ total: 0, results: [], disputed: {} });
  mockState.comparison = ok(emptyComparison);
}

beforeEach(setDefaults);
afterEach(cleanup);

describe("CardsPage", () => {
  test("AC-006: mostra o erro do bundle e permite tentar novamente", () => {
    const refetch = vi.fn();
    mockState.bundle = { ...error("Falha ao carregar contas"), refetch };

    render(<CardsPage />);

    expect(screen.getByText("Erro ao carregar dados")).toBeTruthy();
    expect(screen.getByText("Falha ao carregar contas")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  test("AC-006: exibe cabeçalho e skeleton enquanto o bundle carrega", () => {
    mockState.bundle = loading();

    render(<CardsPage />);

    expect(screen.getByRole("heading", { name: "Cartões" })).toBeTruthy();
    expect(screen.getByText("Limites, faturas e pagamentos")).toBeTruthy();
    expect(document.querySelector(".animate-pulse")).toBeTruthy();
  });

  test("AC-006: informa quando não há conta de crédito", () => {
    mockState.bundle = ok({ ...baseBundle, accounts: { ...baseBundle.accounts, total: 1, results: [bankAccount] } });

    render(<CardsPage />);

    expect(screen.getByText("Nenhum cartão de crédito conectado")).toBeTruthy();
  });

  test("AC-006: renderiza painel do cartão com limite, fatura e pagamento mínimo", () => {
    mockState.bills = ok({ total: 0, results: [], disputed: {} });

    render(<CardsPage />);

    expect(screen.getByText("Cartão Azul")).toBeTruthy();
    expect(screen.getByText("Mastercard · Black")).toBeTruthy();
    expect(screen.getByText("Fatura atual")).toBeTruthy();
    expectVisibleText(brl(3000));
    expectVisibleText(`Limite usado ${brl(3000)} de ${brl(5000)}`);
    expect(document.body.textContent?.replace(/\s+/g, " ")).toMatch(/60\s*%/);
    expectVisibleText(brl(2000));
    expectVisibleText(dateBR("2026-08-15"));
    expectVisibleText(brl(150.5));
    expectVisibleText("Limite disponível");
    expectVisibleText("Vencimento");
    expectVisibleText("Pagamento mínimo");
  });

  test("AC-006: reduz a fatura atual quando há pagamento disputado", () => {
    mockState.bills = ok({
      total: 1,
      results: [
        {
          id: "b1",
          dueDate: "2026-08-15",
          totalAmount: "1000",
          minimumPaymentAmount: "100",
          payment_status: "OPEN",
        },
      ],
      disputed: { b1: { paymentDate: "2026-08-01", paymentAmount: 3000 } },
    });

    render(<CardsPage />);

    expectVisibleText(`Exclui ${brl(1000)} pagos em ${dateBR("2026-08-01")} (banco ainda não baixou).`);
    expectVisibleText(brl(2000));
  });

  test("AC-006: exibe faturas com datas, valores, mínimos, status e selo de disputa", () => {
    mockState.bills = ok({
      ...billsWithRows,
      disputed: { "b-open": { paymentDate: "2026-08-01", paymentAmount: 2000 } },
    });

    render(<CardsPage />);

    expectVisibleText(dateBR("2026-08-15"));
    expectVisibleText(dateBR("2026-09-15"));
    expectVisibleText(brl(1000));
    expectVisibleText(brl(100));
    expectVisibleText(brl(2000));
    expectVisibleText(brl(200));
    expectVisibleText("Paga");
    expectVisibleText("Em aberto");
    expectVisibleText(`Pagamento registrado em ${dateBR("2026-08-01")} — aguardando baixa`);
  });

  test("AC-006: filtra a tabela pelo status Paga", () => {
    mockState.bills = ok(billsWithRows);

    render(<CardsPage />);
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "PAID" } });

    expect(normalized(screen.getByRole("table").textContent ?? "")).toContain(normalized(dateBR("2026-08-15")));
    expect(normalized(screen.getByRole("table").textContent ?? "")).not.toContain(normalized(dateBR("2026-09-15")));
    expect(normalized(screen.getByRole("table").textContent ?? "")).toContain("Paga");
    expect(normalized(screen.getByRole("table").textContent ?? "")).not.toContain("Em aberto");
  });

  test("AC-006: informa filtro sem resultados e lista vazia", () => {
    mockState.bills = ok({
      total: 1,
      results: [{ id: "old", dueDate: "2020-01-01", totalAmount: "100", minimumPaymentAmount: "10", payment_status: "OPEN" }],
      disputed: {},
    });
    const { rerender } = render(<CardsPage />);
    fireEvent.change(screen.getByLabelText("Período de vencimento"), { target: { value: "future" } });
    expect(screen.getByText("Nenhuma fatura com esses filtros")).toBeTruthy();
    expect(screen.getByText("Ajuste o período ou o status.")).toBeTruthy();

    mockState.bills = ok({ total: 0, results: [], disputed: {} });
    rerender(<CardsPage />);
    expect(screen.getByText("Nenhuma fatura")).toBeTruthy();
  });

  test("AC-006: exibe comparação carregando e cartão de faturas", () => {
    mockState.comparison = loading();
    mockState.bills = ok(billsWithRows);

    render(<CardsPage />);

    expect(screen.getByText("Fatura fechada vs anterior")).toBeTruthy();
    expect(document.querySelector(".animate-pulse")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Faturas" })).toBeTruthy();
  });

  test("AC-006: mostra erro da comparação e permite recarregar", () => {
    const refetch = vi.fn();
    mockState.comparison = { ...error("Falha na comparação"), refetch };

    render(<CardsPage />);

    expect(screen.getByText("Falha na comparação")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  test("AC-006: informa quando há menos de duas faturas pagas", () => {
    mockState.comparison = ok(emptyComparison);

    render(<CardsPage />);

    expect(screen.getByText("Menos de duas faturas pagas")).toBeTruthy();
  });

  test("AC-006: exibe comparação da fatura atual com a anterior e o delta", () => {
    mockState.comparison = ok({
      accountId: "account-1",
      current: { total: 1200, dueDate: "2026-08-15" },
      previous: { total: 1000, dueDate: "2026-07-15" },
      delta: 200,
      deltaPct: 20,
    });

    render(<CardsPage />);

    expectVisibleText(brl(1200));
    expectVisibleText(`venc. ${dateBR("2026-08-15")} vs ${brl(1000)} em ${dateBR("2026-07-15")} · +20,0%`);
  });

  test("AC-006: mostra erro de bills dentro do card Faturas", () => {
    mockState.bills = error("Falha ao carregar faturas");

    render(<CardsPage />);

    expect(screen.getByRole("heading", { name: "Faturas" })).toBeTruthy();
    expect(screen.getByText("Falha ao carregar faturas")).toBeTruthy();
  });
});
