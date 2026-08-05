import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComparisonsPayload, InsightsPayload, RecurrentItem } from "../hooks";

type FlowSeries = Array<{
  accountId: string;
  name: string;
  points: Array<{ day: string; saldo: number }>;
}>;

type OverviewModule = {
  isCurrentMonth: (monthKey: string) => boolean;
  loadBudgets: () => Record<string, number>;
  buildFlowData: (
    series: FlowSeries,
    investmentSeries: Array<{ day: string; investido: number }>,
  ) => Array<Record<string, number | string>>;
  buildBudgetRows: (
    spentByCat: Array<{ key: string; spent: number }>,
    budgets: Record<string, number>,
  ) => Array<{ key: string; spent: number; limit: number }>;
  buildDestaques: (args: {
    comp: ComparisonsPayload | undefined;
    categoryData: Array<{ key: string; valor: number }>;
    recurrents: RecurrentItem[] | undefined;
    firstNegative: { day: string; saldo: number } | undefined;
    labelOf: (key: string) => string;
  }) => Array<{ icon: "up" | "down" | "warn"; text: string }>;
  buildAvisos: (args: {
    nextBill: InsightsPayload["nextBill"];
    overdueBills: InsightsPayload["overdueBills"];
    connections: Array<{ status: string; connector_name: string }>;
    disputedCycle: InsightsPayload["disputedCycle"];
    today?: Date;
  }) => Array<{ tone: "yellow" | "red"; text: string }>;
};

let overviewMod: OverviewModule | null = null;

function isOverviewModule(value: unknown): value is OverviewModule {
  if (value === null || typeof value !== "object") return false;
  const module = value as Record<string, unknown>;
  return [
    "isCurrentMonth",
    "loadBudgets",
    "buildFlowData",
    "buildBudgetRows",
    "buildDestaques",
    "buildAvisos",
  ].every((name) => typeof module[name] === "function");
}

function overview(): OverviewModule {
  expect(overviewMod, "src/lib/overview.ts deve exportar as seis funções do contrato").not.toBeNull();
  return overviewMod as OverviewModule;
}

type LocalStorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
};

function createLocalStorage(): LocalStorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };
}

const storage = createLocalStorage();

beforeAll(async () => {
  // Import dinâmico guardado: overview.ts ainda não existe na fase RED.
  const loaded: unknown = await import("../overview").catch(() => null);
  overviewMod = isOverviewModule(loaded) ? loaded : null;
});

beforeEach(() => {
  // O projeto default usa ambiente node; fornecer apenas o contrato mínimo usado por loadBudgets.
  storage.clear();
  vi.stubGlobal("localStorage", storage);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("overview helpers", () => {
  describe("AC-002 — isCurrentMonth", () => {
    it("retorna true para a chave do mês corrente em UTC", () => {
      const now = new Date();
      const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

      expect(overview().isCurrentMonth(currentMonth)).toBe(true);
    });

    it("retorna false para o mês anterior ao corrente em UTC", () => {
      const now = new Date();
      const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const previousMonth = `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;

      expect(overview().isCurrentMonth(previousMonth)).toBe(false);
    });
  });

  describe("AC-003 — loadBudgets", () => {
    it("retorna objeto vazio quando a chave não existe", () => {
      expect(overview().loadBudgets()).toEqual({});
    });

    it("faz parse do JSON válido na chave finmonitor.budgets.v1", () => {
      localStorage.setItem("finmonitor.budgets.v1", JSON.stringify({ Food: 300 }));

      expect(overview().loadBudgets()).toEqual({ Food: 300 });
    });

    it("retorna objeto vazio quando o JSON está corrompido", () => {
      localStorage.setItem("finmonitor.budgets.v1", "{not-json");

      expect(overview().loadBudgets()).toEqual({});
    });
  });

  describe("AC-004 — buildFlowData", () => {
    it("retorna lista vazia para séries sem pontos", () => {
      expect(overview().buildFlowData([], [])).toEqual([]);
    });

    it("mescla contas e investimentos por dia, ordena e arredonda o total a duas casas", () => {
      const series: FlowSeries = [
        {
          accountId: "checking",
          name: "Conta corrente",
          points: [
            { day: "2026-06-02", saldo: 10.005 },
            { day: "2026-06-01", saldo: 1.5 },
          ],
        },
        {
          accountId: "savings",
          name: "Poupança",
          points: [
            { day: "2026-06-02", saldo: 0 },
            { day: "2026-06-03", saldo: 2 },
          ],
        },
      ];
      const investmentSeries = [
        { day: "2026-06-02", investido: 0.001 },
        { day: "2026-06-01", investido: 0.5 },
      ];

      expect(overview().buildFlowData(series, investmentSeries)).toEqual([
        { day: "2026-06-01", checking: 1.5, investimentos: 0.5, total: 2 },
        { day: "2026-06-02", checking: 10.005, savings: 0, investimentos: 0.001, total: 10.01 },
        { day: "2026-06-03", savings: 2, total: 2 },
      ]);
    });
  });

  describe("AC-005 — buildBudgetRows", () => {
    it("inclui orçamentos positivos e completa com top 5 sem orçamento, sem duplicar, ordenado e limitado a 6", () => {
      const spentByCat = [
        { key: "Food", spent: 100 },
        { key: "Rent", spent: 90 },
        { key: "Travel", spent: 80 },
        { key: "Bills", spent: 70 },
        { key: "Health", spent: 60 },
        { key: "Fun", spent: 50 },
        { key: "Other", spent: 40 },
        { key: "Luxury", spent: 10 },
      ];
      const budgets = { Food: 300, Bills: 200, Luxury: 1000 };

      const rows = overview().buildBudgetRows(spentByCat, budgets);

      expect(rows).toHaveLength(6);
      expect(rows.map((row) => row.key)).toEqual(["Food", "Rent", "Travel", "Bills", "Health", "Luxury"]);
      expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
      expect(rows.find((row) => row.key === "Food")).toEqual({ key: "Food", spent: 100, limit: 300 });
      expect(rows.find((row) => row.key === "Rent")).toEqual({ key: "Rent", spent: 90, limit: 0 });
      expect(rows.find((row) => row.key === "Luxury")).toEqual({ key: "Luxury", spent: 10, limit: 1000 });
    });
  });

  describe("AC-006 — buildDestaques", () => {
    it("emite destaques de rolling/sameWindow, maior categoria e recorrente acima de 5%", () => {
      const result = overview().buildDestaques({
        comp: comparisons({ rollingDelta: 12, sameWindowDelta: -8 }),
        categoryData: [{ key: "Food", valor: 200 }],
        recurrents: [recurrent({ category: "Gym", deltaPct: 20 })],
        firstNegative: { day: "2026-06-20", saldo: -10 },
        labelOf: (key) => key,
      });

      expect(result).toHaveLength(4);
      expect(result[0]).toMatchObject({ icon: "up" });
      expect(result[0]?.text).toContain("subiram");
      expect(result[1]).toMatchObject({ icon: "down" });
      expect(result[1]?.text).toContain("-8% em gastos vs mês anterior");
      expect(result[2]).toMatchObject({ icon: "down", text: expect.stringContaining("Maior categoria em 30 dias: Food") });
      expect(result[3]).toMatchObject({ icon: "up", text: expect.stringContaining("Gym") });
    });

    it("pula deltas nulos e recorrentes com delta de até 5%, mas sempre inclui a maior categoria", () => {
      const result = overview().buildDestaques({
        comp: comparisons({ rollingDelta: null, sameWindowDelta: null }),
        categoryData: [{ key: "Food", valor: 200 }],
        recurrents: [recurrent({ category: "Gym", deltaPct: 4 })],
        firstNegative: undefined,
        labelOf: (key) => key,
      });

      expect(result).toHaveLength(1);
      expect(result[0]?.text).toContain("Maior categoria em 30 dias: Food");
      expect(result.some((item) => item.text.includes("recorrente"))).toBe(false);
    });

    it("inclui projeção negativa com ícone warn e texto da data, respeitando teto de quatro itens", () => {
      const result = overview().buildDestaques({
        comp: undefined,
        categoryData: [],
        recurrents: undefined,
        firstNegative: { day: "2026-06-20", saldo: -10 },
        labelOf: (key) => key,
      });

      expect(result).toEqual([
        expect.objectContaining({ icon: "warn", text: expect.stringContaining("Projeção de caixa fica negativa em") }),
      ]);
    });
  });

  describe("AC-007 — buildAvisos", () => {
    const today = new Date("2026-06-15T12:00:00Z");

    it("emite aviso amarelo para fatura que vence em dois dias", () => {
      const result = overview().buildAvisos({
        nextBill: bill({ dueDate: "2026-06-17" }),
        overdueBills: [],
        connections: [],
        disputedCycle: null,
        today,
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ tone: "yellow" });
      expect(result[0]?.text).toContain("vence em 2 dia(s)");
    });

    it("não avisa fatura com vencimento distante e suprime a em aberto próxima do ciclo contestado", () => {
      const result = overview().buildAvisos({
        nextBill: bill({ dueDate: "2026-06-25" }),
        overdueBills: [
          bill({ id: "suppressed", dueDate: "2026-06-01", totalAmount: "100.00" }),
          bill({ id: "visible", dueDate: "2026-06-02", totalAmount: "50.00" }),
        ],
        connections: [],
        disputedCycle: {
          accountName: "Cartão",
          balance: "110.00",
          paymentDate: "2026-06-05",
          paymentAmount: 110,
        },
        today,
      });

      expect(result).toHaveLength(1);
      expect(result[0]?.tone).toBe("red");
      expect(result[0]?.text).toContain("50,00");
      expect(result[0]?.text).not.toContain("100,00");
    });

    it("emite erro vermelho para conexão LOGIN_ERROR e limita a quatro avisos", () => {
      const result = overview().buildAvisos({
        nextBill: bill({ dueDate: "2026-06-15" }),
        overdueBills: [
          bill({ id: "one", dueDate: "2026-06-01", totalAmount: "10.00" }),
          bill({ id: "two", dueDate: "2026-06-02", totalAmount: "20.00" }),
          bill({ id: "three", dueDate: "2026-06-03", totalAmount: "30.00" }),
          bill({ id: "four", dueDate: "2026-06-04", totalAmount: "40.00" }),
        ],
        connections: [{ status: "LOGIN_ERROR", connector_name: "Banco Azul" }],
        disputedCycle: null,
        today,
      });

      expect(result).toHaveLength(4);
      expect(result.slice(1).every((item) => item.tone === "red")).toBe(true);
      expect(result.some((item) => item.tone === "red" && item.text.includes("Conexão Banco Azul com erro de login"))).toBe(false);

      const connectionOnly = overview().buildAvisos({
        nextBill: null,
        overdueBills: [],
        connections: [{ status: "LOGIN_ERROR", connector_name: "Banco Azul" }],
        disputedCycle: null,
        today,
      });
      expect(connectionOnly).toEqual([
        { tone: "red", text: expect.stringContaining("Conexão Banco Azul com erro de login") },
      ]);
    });
  });
});

function windowComparison(deltaSpendPct: number | null, currentSpend = 120, previousSpend = 100) {
  return {
    current: { spend: currentSpend, income: 80 },
    previous: { spend: previousSpend, income: 70 },
    deltaSpend: currentSpend - previousSpend,
    deltaSpendPct,
    deltaIncome: 10,
    deltaIncomePct: 14,
    categories: { spend: [], income: [] },
  };
}

function comparisons({ rollingDelta, sameWindowDelta }: { rollingDelta: number | null; sameWindowDelta: number | null }): ComparisonsPayload {
  return {
    elapsedDays: 15,
    rolling: windowComparison(rollingDelta),
    sameWindow: windowComparison(sameWindowDelta),
    calendar: {
      current: { spend: 120, income: 80, days: 15, spendPerDay: 8, incomePerDay: 5.33 },
      previous: { spend: 100, income: 70, days: 15, spendPerDay: 6.67, incomePerDay: 4.67 },
      deltaSpendPerDayPct: 20,
      deltaIncomePerDayPct: 14,
      categories: { spend: [], income: [] },
    },
  };
}

function recurrent(overrides: Partial<RecurrentItem> = {}): RecurrentItem {
  return {
    key: "gym-membership",
    label: "Gym",
    category: "Gym",
    descNorm: "gym",
    kind: "spend",
    monthly: 40,
    occurrences: 3,
    lastDate: "2026-06-01",
    deltaPct: 20,
    ...overrides,
  };
}

function bill(overrides: Partial<InsightsPayload["nextBill"]> = {}): NonNullable<InsightsPayload["nextBill"]> {
  return {
    id: "bill-id",
    dueDate: "2026-06-17",
    totalAmount: "100.00",
    minimumPaymentAmount: "10.00",
    payment_status: "OPEN",
    ...overrides,
  };
}
