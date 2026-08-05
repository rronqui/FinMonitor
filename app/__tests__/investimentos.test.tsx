import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Investment } from "@/src/banco-mcp";
import { brl, dateBR } from "@/src/lib/format";

// Recharts consults ResizeObserver while rendering charts in jsdom.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const mockState = vi.hoisted(() => ({
  investments: null as unknown,
  benchmarks: null as unknown,
  movements: null as unknown,
}));

vi.mock("@/src/lib/hooks", () => ({
  useInvestments: () => mockState.investments,
  useBenchmarks: () => mockState.benchmarks,
  useInvestmentMovements: () => mockState.movements,
}));

import InvestmentsPage from "../investimentos/page";

const textWithNbsp = (expected: string) => (content: string) =>
  content.replace(/\u00a0/g, " ") === expected.replace(/\u00a0/g, " ");

const ok = <T,>(data: T) => ({ data, isLoading: false, isError: false, error: null, refetch: vi.fn() });
const loading = () => ({ data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn() });
const error = (message: string) => ({ data: undefined, isLoading: false, isError: true, error: new Error(message), refetch: vi.fn() });

const baseBenchmarks = {
  cdiAnnualPct: null,
  ipcaAnnualPct: null,
  source: "BCB",
  updatedAt: "2026-08-05T00:00:00.000Z",
};

function investment(overrides: Partial<Investment> = {}): Investment {
  return {
    id: "inv-1",
    name: "CDB Banco Azul",
    type: "FIXED_INCOME",
    subtype: "CDB",
    balance: "1000",
    currencyCode: "BRL",
    status: "ACTIVE",
    amount: "1000",
    amountOriginal: "1000",
    amountWithdrawal: "1100",
    taxes: "10",
    ...overrides,
  };
}

function setDefaults() {
  mockState.investments = ok({ total: 0, page: 1, totalPages: 1, results: [] as Investment[] });
  mockState.benchmarks = ok(baseBenchmarks);
  mockState.movements = ok({ results: [] });
};

beforeEach(setDefaults);
afterEach(cleanup);

describe("InvestmentsPage", () => {
  test("AC-007: mostra erro de investimentos", () => {
    mockState.investments = error("falha ao carregar investimentos");

    render(<InvestmentsPage />);

    expect(screen.getByText("Erro ao carregar dados")).toBeTruthy();
    expect(screen.getByText("falha ao carregar investimentos")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeTruthy();
  });

  test("AC-007: mostra cabeçalho e quatro cards de skeleton durante loading", () => {
    mockState.investments = loading();

    render(<InvestmentsPage />);

    expect(screen.getByRole("heading", { name: "Investimentos" })).toBeTruthy();
    expect(screen.getByText("Posições consolidadas")).toBeTruthy();
    expect(document.querySelectorAll("div.rounded-xl.border.border-border.bg-surface.p-5")).toHaveLength(4);
    expect(document.querySelectorAll(".animate-pulse")).toHaveLength(8);
  });

  test("AC-007: informa quando não há investimentos", () => {
    render(<InvestmentsPage />);

    expect(screen.getByText("Nenhum investimento encontrado")).toBeTruthy();
  });

  test("AC-007: deriva tipos incluindo encerradas, permite filtro vazio e reexibe encerrada", () => {
    const active = investment({ id: "active", name: "Ativo", type: "FIXED_INCOME" });
    const closed = investment({
      id: "closed",
      name: "ETF encerrado",
      type: "ETF",
      subtype: "INDICE",
      status: "TOTAL_WITHDRAWAL",
    });
    mockState.investments = ok({ total: 2, page: 1, totalPages: 1, results: [active, closed] });

    render(<InvestmentsPage />);

    const typeSelect = screen.getByRole("combobox");
    expect(within(typeSelect).getByRole("option", { name: "FIXED_INCOME" })).toBeTruthy();
    expect(screen.getByText("Ativo")).toBeTruthy();
    expect(screen.queryByText("ETF encerrado")).toBeNull();

    const closedToggle = screen.getByRole("checkbox", { name: /Exibir posições encerradas/ });
    fireEvent.click(closedToggle);
    expect(screen.getByText("ETF encerrado")).toBeTruthy();
    expect(screen.getByText("Encerrada")).toBeTruthy();
    expect(within(typeSelect).getByRole("option", { name: "ETF" })).toBeTruthy();

    fireEvent.change(typeSelect, { target: { value: "ETF" } });
    expect(screen.getByText("ETF encerrado")).toBeTruthy();
    expect(screen.queryByText("Ativo")).toBeNull();

    fireEvent.click(closedToggle);
    expect(screen.getByText("Nenhuma posição com esse filtro")).toBeTruthy();
    expect(screen.getByText("Ajuste o tipo ou exiba encerradas.")).toBeTruthy();
  });

  test("AC-007: agrega stats das posições ativas", () => {
    mockState.investments = ok({
      total: 2,
      page: 1,
      totalPages: 1,
      results: [
        investment({ id: "a", name: "Ativo A", amountOriginal: "1000", amountWithdrawal: "1100", taxes: "10" }),
        investment({ id: "b", name: "Ativo B", amountOriginal: "2000", amountWithdrawal: "2400", taxes: "40" }),
      ],
    });

    render(<InvestmentsPage />);

    expect(screen.getByText(textWithNbsp(brl(3000)))).toBeTruthy();
    expect(screen.getByText(textWithNbsp(brl(3500)))).toBeTruthy();
    expect(screen.getByText(textWithNbsp(brl(50)))).toBeTruthy();
    const rent = screen.getByText(textWithNbsp(brl(450)));
    expect(rent.className).toContain("text-pos");
    expect(screen.getByText("15,00% líquido de impostos")).toBeTruthy();
  });

  test("AC-007: oculta encerradas por padrão e mostra badge ao marcar checkbox", () => {
    const closed = investment({ id: "closed", name: "Tesouro encerrado", status: "TOTAL_WITHDRAWAL" });
    mockState.investments = ok({ total: 2, page: 1, totalPages: 1, results: [investment({ id: "open", name: "Tesouro aberto" }), closed] });

    render(<InvestmentsPage />);

    expect(screen.queryByText("Tesouro encerrado")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /Exibir posições encerradas/ }));
    expect(screen.getByText("Tesouro encerrado")).toBeTruthy();
    expect(screen.getByText("Encerrada")).toBeTruthy();
  });

  test("AC-007: renderiza taxa literal e a.a. realizado como indisponível sem datas", () => {
    const withRate = investment({ id: "rate", name: "CDB com taxa", rate: 105.5, rateType: "% do CDI" });
    const withoutRate = investment({ id: "none", name: "Sem taxa", rate: undefined, rateType: undefined });
    mockState.investments = ok({ total: 2, page: 1, totalPages: 1, results: [withRate, withoutRate] });

    render(<InvestmentsPage />);

    const rateRow = screen.getByText("CDB com taxa").closest("tr");
    const noRateRow = screen.getByText("Sem taxa").closest("tr");
    expect(rateRow).toBeTruthy();
    expect(noRateRow).toBeTruthy();
    expect(within(rateRow as HTMLElement).getByText("105.5% % do CDI")).toBeTruthy();
    expect(within(rateRow as HTMLElement).getAllByText("—")).toHaveLength(2);
    expect(within(noRateRow as HTMLElement).getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  test("AC-007: calcula a.a. realizado em uma faixa plausível", () => {
    const purchaseDate = new Date(Date.now() - 2 * 365.25 * 86_400_000).toISOString();
    const inv = investment({
      name: "CDB anualizado",
      amountOriginal: "1000",
      amountWithdrawal: "1100",
      taxes: "0",
      purchaseDate,
    });
    mockState.investments = ok({ total: 1, page: 1, totalPages: 1, results: [inv] });

    render(<InvestmentsPage />);

    const row = screen.getByText("CDB anualizado").closest("tr") as HTMLElement;
    const annualizedCell = within(row).getByText(/^\d+,\d+%$/);
    const percentage = Number(annualizedCell.textContent?.replace("%", "").replace(",", "."));
    expect(percentage).toBeGreaterThan(4);
    expect(percentage).toBeLessThan(6);
  });

  test("AC-007: mostra agenda vazia e agenda com vencimento formatado", () => {
    mockState.investments = ok({
      total: 1,
      page: 1,
      totalPages: 1,
      results: [investment({ name: "CDB sem vencimento", dueDate: undefined })],
    });
    const { rerender } = render(<InvestmentsPage />);
    expect(screen.getByText("Sem vencimentos informados")).toBeTruthy();

    mockState.investments = ok({
      total: 1,
      page: 1,
      totalPages: 1,
      results: [investment({ name: "Tesouro 2027", dueDate: "2027-01-10", amountWithdrawal: "5000" })],
    });
    rerender(<InvestmentsPage />);
    expect(screen.getAllByText("Tesouro 2027")).toHaveLength(2);
    expect(screen.getByText(`vence ${dateBR("2027-01-10")}`, { exact: false })).toBeTruthy();
    const agendaCard = screen.getByRole("heading", { name: "Agenda de vencimentos" }).closest("section") as HTMLElement;
    expect(within(agendaCard).getByText(textWithNbsp(brl("5000")))).toBeTruthy();
  });

  test("AC-007: mostra benchmark em loading e valores formatados", () => {
    const dated = investment({ purchaseDate: new Date(Date.now() - 2 * 365.25 * 86_400_000).toISOString() });
    mockState.investments = ok({ total: 1, page: 1, totalPages: 1, results: [dated] });
    mockState.benchmarks = loading();
    const { rerender } = render(<InvestmentsPage />);
    const benchmarkCard = screen.getByRole("heading", { name: "Rentabilidade vs benchmarks" }).closest("section") as HTMLElement;
    expect(within(benchmarkCard).getByText("Rentabilidade vs benchmarks")).toBeTruthy();
    expect(benchmarkCard.querySelector(".animate-pulse")).toBeTruthy();

    mockState.benchmarks = ok({ ...baseBenchmarks, cdiAnnualPct: 10.5, ipcaAnnualPct: 4.2 });
    rerender(<InvestmentsPage />);
    expect(within(benchmarkCard).getByText("CDI")).toBeTruthy();
    expect(within(benchmarkCard).getByText("10,50%")).toBeTruthy();
    expect(within(benchmarkCard).getByText("IPCA")).toBeTruthy();
    expect(within(benchmarkCard).getByText("4,20%")).toBeTruthy();
    expect(within(benchmarkCard).getByText(/Ganho real ≈/)).toBeTruthy();
  });

  test("AC-007: benchmark com CDI nulo exibe traço", () => {
    const dated = investment({ purchaseDate: new Date(Date.now() - 2 * 365.25 * 86_400_000).toISOString() });
    mockState.investments = ok({ total: 1, page: 1, totalPages: 1, results: [dated] });
    mockState.benchmarks = ok({ ...baseBenchmarks, ipcaAnnualPct: 4.2 });

    render(<InvestmentsPage />);

    const cdiRow = screen.getByText("CDI").closest("li") as HTMLElement;
    expect(within(cdiRow).getByText("—")).toBeTruthy();
  });

  test("AC-007: legenda da distribuição contém cada tipo agregado", () => {
    mockState.investments = ok({
      total: 2,
      page: 1,
      totalPages: 1,
      results: [
        investment({ id: "fixed", type: "FIXED_INCOME", amountWithdrawal: "1000" }),
        investment({ id: "etf", type: "ETF", amountWithdrawal: "2000" }),
      ],
    });

    render(<InvestmentsPage />);

    const distribution = screen.getByRole("heading", { name: "Distribuição por tipo" }).closest("section") as HTMLElement;
    expect(within(distribution).getByText("FIXED_INCOME")).toBeTruthy();
    expect(within(distribution).getByText("ETF")).toBeTruthy();
  });

  test("AC-007: expande, renderiza estados e colapsa movimentações", () => {
    const inv = investment({ id: "mov", name: "CDB movimentado" });
    mockState.investments = ok({ total: 1, page: 1, totalPages: 1, results: [inv] });
    mockState.movements = loading();
    const { rerender } = render(<InvestmentsPage />);
    fireEvent.click(screen.getByText("CDB movimentado"));
    expect(screen.getByText("Carregando movimentações…")).toBeTruthy();

    mockState.movements = error("falha ao carregar movimentações");
    rerender(<InvestmentsPage />);
    expect(screen.getByText("falha ao carregar movimentações")).toBeTruthy();

    mockState.movements = ok({ results: [] });
    rerender(<InvestmentsPage />);
    expect(screen.getByText("Sem movimentações registradas.")).toBeTruthy();

    mockState.movements = ok({
      results: [
        { id: "m1", investment_id: "mov", date: "2026-01-15", type: "BUY", net_amount: 1000 },
        { id: "m2", investment_id: "mov", date: "2026-02-15", type: "SELL", net_amount: 1100 },
      ],
    });
    rerender(<InvestmentsPage />);
    expect(screen.getByText("Aplicação")).toBeTruthy();
    const sellDate = screen.getByText(dateBR("2026-02-15"));
    expect(within(sellDate.closest("tr") as HTMLElement).getByText("Resgate")).toBeTruthy();
    expect(screen.getByText(dateBR("2026-01-15"))).toBeTruthy();

    fireEvent.click(screen.getByText("CDB movimentado"));
    expect(screen.queryByText("Aplicação")).toBeNull();
    expect(screen.queryAllByText("Resgate").filter((element) => element.tagName === "TD")).toHaveLength(0);
  });
});
