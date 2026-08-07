import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Recharts consults ResizeObserver while rendering charts in jsdom.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const pushSpy = vi.fn();
const mockState = vi.hoisted(() => ({
  bundle: null as unknown,
  investments: null as unknown,
  insights: null as unknown,
  categories: null as unknown,
  projection: null as unknown,
  recurrents: null as unknown,
  comparisons: null as unknown,
  budgetsSpent: null as unknown,
  sync: null as unknown,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushSpy }) }));
vi.mock("@/src/lib/hooks", () => ({
  useAccountsBundle: () => mockState.bundle,
  useInvestments: () => mockState.investments,
  useInsights: () => mockState.insights,
  useCategories: () => mockState.categories,
  useProjection: () => mockState.projection,
  useRecurrents: () => mockState.recurrents,
  useComparisons: () => mockState.comparisons,
  useBudgetsSpent: () => mockState.budgetsSpent,
  useSync: () => mockState.sync,
}));

import OverviewPage from "../page";

const ok = <T,>(data: T) => ({ data, isLoading: false, isError: false, error: null, refetch: vi.fn() });
const loading = () => ({ data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn() });
const error = (message: string) => ({ data: undefined, isLoading: false, isError: true, error: new Error(message), refetch: vi.fn() });

const baseBundle = {
  connections: { connections: [{ connector_id: "c1", connector_name: "Banco Azul", item_id: "item-12345678", status: "UPDATED" }], count: 1, add_connection_url: "https://bank.example/connect" },
  accounts: { total: 2, bank: "Banco Azul", item_id: "item-123", results: [] },
  details: { results: [] },
};
const baseInsights = {
  categories: [],
  series: [],
  latest: [],
  monthly: [],
  investmentSeries: [],
  creditOpenTotal: 0,
  disputedCycle: null,
  openBill: null,
  nextBill: null,
  overdueBills: [],
  disputed: {},
};
const baseComparisons = {
  elapsedDays: 10,
  sameWindow: {
    current: { spend: 120, income: 400 },
    previous: { spend: 100, income: 350 },
    deltaSpend: 20,
    deltaSpendPct: 20,
    deltaIncome: 50,
    deltaIncomePct: 14.3,
    categories: { spend: [], income: [] },
  },
  rolling: {
    current: { spend: 1200, income: 700 },
    previous: { spend: 960, income: 600 },
    deltaSpend: 240,
    deltaSpendPct: 25,
    deltaIncome: 100,
    deltaIncomePct: 16.7,
    categories: { spend: [], income: [] },
  },
  calendar: {
    current: { spend: 300, income: 400, days: 10, spendPerDay: 30, incomePerDay: 40 },
    previous: { spend: 280, income: 350, days: 30, spendPerDay: 9.33, incomePerDay: 11.67 },
    deltaSpendPerDayPct: 10,
    deltaIncomePerDayPct: 20,
    categories: { spend: [], income: [] },
  },
};

function setDefaults() {
  pushSpy.mockClear();
  localStorage.clear();
  mockState.bundle = ok(baseBundle);
  mockState.investments = ok({ total: 0, page: 1, totalPages: 1, results: [] });
  mockState.insights = ok(baseInsights);
  mockState.categories = ok({ total: 0, results: [] });
  mockState.projection = ok({ days: [] });
  mockState.recurrents = ok({ recorrentes: [] });
  mockState.comparisons = ok(baseComparisons);
  mockState.budgetsSpent = ok({ categories: [] });
  mockState.sync = { mutate: vi.fn(), isPending: false, isError: false, error: null };
}

beforeEach(setDefaults);
afterEach(cleanup);

describe("OverviewPage", () => {
  test("AC-001: mostra cabeçalho e quatro skeletons enquanto o bundle carrega", () => {
    mockState.bundle = loading();

    render(<OverviewPage />);

    expect(screen.getByText("Visão Geral")).toBeTruthy();
    const kpiSkeletonCards = document.querySelectorAll("div.rounded-xl.border.border-border.bg-surface.p-5");
    expect(kpiSkeletonCards).toHaveLength(4);
    expect(document.querySelectorAll(".animate-pulse")).toHaveLength(8);
    expect(screen.queryByText("Saldo em conta")).toBeNull();
    expect(screen.queryByText("R$\u00a00,00")).toBeNull();
  });

  test("AC-001: exibe a mensagem do erro e permite tentar novamente", () => {
    mockState.bundle = error("Falha ao carregar contas");

    render(<OverviewPage />);

    expect(screen.getByText("Falha ao carregar contas")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeTruthy();
  });

  test("AC-001: orienta adicionar banco quando não há conexões", () => {
    mockState.bundle = ok({ ...baseBundle, connections: { ...baseBundle.connections, connections: [] } });

    render(<OverviewPage />);

    expect(screen.getByText("Nenhuma conexão bancária")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Adicionar banco" })).toBeTruthy();
  });

  test("AC-008: calcula e formata os quatro KPIs a partir dos payloads", () => {
    mockState.bundle = ok({
      ...baseBundle,
      accounts: {
        ...baseBundle.accounts,
        results: [
          { id: "a1", account_id: "a1", type: "BANK", subtype: "CHECKING", name: "Conta 1", number: "1", balance: "1000.50", currencyCode: "BRL" },
          { id: "a2", account_id: "a2", type: "BANK", subtype: "CHECKING", name: "Conta 2", number: "2", balance: "499.50", currencyCode: "BRL" },
        ],
      },
      details: {
        results: [
          {
            account_id: "a1",
            account: { id: "a1", account_id: "a1", type: "CREDIT", subtype: "CARD", name: "Cartão", number: "3", balance: "0", currencyCode: "BRL", creditData: { availableCreditLimit: "1000" } },
          },
        ],
      },
    });
    mockState.insights = ok({ ...baseInsights, creditOpenTotal: 250 });
    mockState.investments = ok({ total: 1, page: 1, totalPages: 1, results: [{ id: "i1", name: "Tesouro", type: "bond", subtype: "", balance: "300", currencyCode: "BRL", status: "active", amount: "300", amountOriginal: "300", amountWithdrawal: "300", taxes: "0" }] });

    render(<OverviewPage />);

    expect(screen.getByText("Saldo em conta").parentElement?.textContent).toContain("R$\u00a01.500,00");
    expect(screen.getByText("Fatura atual dos cartões").parentElement?.textContent).toContain("R$\u00a0250,00");
    expect(screen.getAllByText("Investimentos")[0].parentElement?.textContent).toContain("R$\u00a0300,00");
    expect(screen.getByText("Limite disponível").parentElement?.textContent).toContain("R$\u00a01.000,00");
  });

  test("AC-009: mostra aviso de conexão com erro de login", () => {
    mockState.bundle = ok({ ...baseBundle, connections: { ...baseBundle.connections, connections: [{ ...baseBundle.connections.connections[0], status: "LOGIN_ERROR" }] } });

    render(<OverviewPage />);

    expect(screen.getByText("Conexão Banco Azul com erro de login — reconecte.")).toBeTruthy();
  });

  test("AC-009: mostra o banner quando o provedor está degradado", () => {
    mockState.bundle = ok({ ...baseBundle, accounts: { ...baseBundle.accounts, provider_incident: { degraded: true } } });

    render(<OverviewPage />);

    expect(screen.getByText(/Provedor com desempenho degradado/)).toBeTruthy();
  });

  test("AC-009: renderiza o destaque dos gastos móveis", () => {
    mockState.insights = ok({ ...baseInsights, categories: [{ key: "food", name: "Alimentação", valor: 200 }] });
    mockState.comparisons = ok(baseComparisons);

    render(<OverviewPage />);

    expect(screen.getByText(/Gastos dos últimos 30 dias subiram 25%/)).toBeTruthy();
  });

  test("AC-009: alterna ComparisonCard e abre drill-down com as janelas", () => {
    mockState.comparisons = ok({
      ...baseComparisons,
      sameWindow: { ...baseComparisons.sameWindow, categories: { spend: [{ key: "food", name: "Alimentação", current: 120, previous: 100, delta: 20 }], income: [] } },
    });

    render(<OverviewPage />);

    fireEvent.click(screen.getByRole("button", { name: "Alimentação" }));
    expect(pushSpy).toHaveBeenCalledWith(expect.stringMatching(/^\/transacoes\?range=custom&/));
    expect(pushSpy.mock.calls[0][0]).toContain("kind=spend");
    expect(pushSpy.mock.calls[0][0]).toContain("fromIso=");
    expect(pushSpy.mock.calls[0][0]).toContain("toIso=");

    const incomeButtons = screen.getAllByRole("button", { name: "Entradas" });
    fireEvent.click(incomeButtons[2]);
    const dailyCard = screen.getByRole("heading", { name: "Mês atual (R$/dia)" }).closest("section");
    expect(dailyCard?.textContent).toContain("R$\u00a040,00/dia");
  });

  test("AC-009: soma recorrentes, filtra entradas e exibe estado vazio", () => {
    mockState.recurrents = ok({
      recorrentes: [
        { key: "rent", label: "Aluguel", category: "housing", descNorm: "aluguel", kind: "spend", monthly: 100, occurrences: 2, lastDate: "2026-07-01", deltaPct: null },
        { key: "phone", label: "Telefone", category: "services", descNorm: "telefone", kind: "spend", monthly: 50, occurrences: 1, lastDate: "2026-07-02", deltaPct: null },
        { key: "salary", label: "Salário", category: "salary", descNorm: "salario", kind: "income", monthly: 900, occurrences: 1, lastDate: "2026-07-03", deltaPct: null },
      ],
    });

    const view = render(<OverviewPage />);
    expect(screen.getByText(/Custo fixo ≈/).parentElement?.textContent).toContain("R$\u00a0150,00/mês");
    fireEvent.click(screen.getAllByRole("button", { name: "Entradas" }).at(-1)!);
    expect(screen.getByText("Salary")).toBeTruthy();
    expect(screen.getByText(/Renda recorrente ≈/).parentElement?.textContent).toContain("R$\u00a0900,00/mês");

    mockState.recurrents = ok({ recorrentes: [] });
    view.rerender(<OverviewPage />);
    fireEvent.click(screen.getAllByRole("button", { name: "Entradas" }).at(-1)!);
    expect(screen.getByText("Nenhuma entrada recorrente detectada")).toBeTruthy();
  });
  test("RF-008: abre recorrência com janela de 365 dias e filtros", () => {
    mockState.recurrents = ok({
      recorrentes: [
        { key: "housing::aluguel", label: "Aluguel", category: "housing", descNorm: "aluguel", kind: "spend", monthly: 100, occurrences: 6, lastDate: "2026-07-01", deltaPct: null },
      ],
    });

    render(<OverviewPage />);

    const button = screen.getByTitle("Ver transações dos últimos 12 meses");
    expect(button.textContent).toBe("Housing");

    const from = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    fireEvent.click(button);

    expect(pushSpy).toHaveBeenCalledWith(
      `/transacoes?range=custom&from=${from}&to=${to}&kind=spend&category=housing&desc=aluguel`,
    );
  });


  test("AC-009: define orçamento e persiste o limite com percentual", () => {
    mockState.budgetsSpent = ok({ categories: [{ key: "food", spent: 100 }] });
    mockState.categories = ok({ total: 1, results: [{ id: "food", description: "food", descriptionTranslated: "Alimentação", parentId: null, parentDescription: null }] });

    render(<OverviewPage />);

    fireEvent.click(screen.getByRole("button", { name: "definir limite" }));
    const input = screen.getByPlaceholderText("limite R$");
    fireEvent.change(input, { target: { value: "500" } });
    fireEvent.blur(input);

    expect(JSON.parse(localStorage.getItem("finmonitor.budgets.v1") ?? "{}")) .toEqual({ food: 500 });
    expect(screen.getByText("20% do limite")).toBeTruthy();
  });

  test("AC-009: sincroniza e sinaliza estado pendente", () => {
    const mutate = vi.fn();
    mockState.sync = { mutate, isPending: false, isError: false, error: null };

    const view = render(<OverviewPage />);
    fireEvent.click(screen.getByRole("button", { name: "Sincronizar agora" }));
    expect(mutate).toHaveBeenCalledTimes(1);

    mockState.sync = { mutate, isPending: true, isError: false, error: null };
    view.rerender(<OverviewPage />);
    const button = screen.getByRole("button", { name: "Sincronizando…" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
  test("AC-007: exibe as premissas da projeção de caixa", () => {
    mockState.projection = ok({
      days: [{ day: "2026-08-07", saldo: 1000 }],
      premissas: {
        recorrentes: [{ key: "k", label: "Seguro", kind: "spend", monthly: 555.59 }],
        unicos: [],
      },
    });

    render(<OverviewPage />);

    fireEvent.click(screen.getByText("O que entra nesta estimativa"));
    expect(screen.getByText(/555,59/)).toBeTruthy();
  });
});
