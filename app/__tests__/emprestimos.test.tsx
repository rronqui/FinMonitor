import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { brl, dateBR } from "@/src/lib/format";

const mockState = vi.hoisted(() => ({
  connections: null as unknown,
  loans: null as unknown,
}));
const fetchSpy = vi.hoisted(() => vi.fn());

vi.mock("@/src/lib/hooks", () => ({
  useConnections: () => mockState.connections,
  useLoans: () => mockState.loans,
}));

import LoansPage from "../emprestimos/page";

const ok = <T,>(data: T) => ({ data, isLoading: false, isError: false, error: null, refetch: vi.fn() });
const loading = () => ({ data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn() });
const error = (message: string) => ({ data: undefined, isLoading: false, isError: true, error: new Error(message), refetch: vi.fn() });

const baseConnections = {
  connections: [{ item_id: "item-1" }],
  count: 1,
};
const baseLoans = { results: [], errors: [] };
const baseContract = {
  id: "loan-1",
  type: "PERSONAL",
  currencyCode: "BRL",
  contractAmount: "10000",
  contractNumber: "CN-123",
  dueDate: "2026-12-31",
};

function renderLoans() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LoansPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockState.connections = ok(baseConnections);
  mockState.loans = ok(baseLoans);
  fetchSpy.mockReset();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});

afterEach(cleanup);

describe("LoansPage", () => {
  test("AC-005: mostra erro de conexões e erro de empréstimos", () => {
    mockState.connections = error("Falha ao carregar conexões");
    renderLoans();
    expect(screen.getByText("Falha ao carregar conexões")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeTruthy();

    cleanup();
    mockState.connections = ok(baseConnections);
    mockState.loans = error("Falha ao carregar empréstimos");
    renderLoans();
    expect(screen.getByText("Falha ao carregar empréstimos")).toBeTruthy();
  });

  test("AC-005: exibe cabeçalho e skeleton durante o carregamento", () => {
    mockState.connections = loading();
    renderLoans();
    expect(screen.getByText("Empréstimos")).toBeTruthy();
    expect(document.querySelector(".animate-pulse")).toBeTruthy();

    cleanup();
    mockState.connections = ok(baseConnections);
    mockState.loans = loading();
    renderLoans();
    expect(screen.getByText("Empréstimos")).toBeTruthy();
    expect(document.querySelector(".animate-pulse")).toBeTruthy();
  });

  test("AC-005: orienta quando não há contratos", () => {
    mockState.connections = ok({ connections: [], count: 0 });
    renderLoans();
    expect(screen.getByText("Nenhum empréstimo contratado")).toBeTruthy();
  });

  test("AC-005: renderiza o card com tipo, valor e vencimento formatados", () => {
    mockState.loans = ok({ results: [{ item_id: "item-1", total: 1, results: [baseContract] }], errors: [] });
    renderLoans();

    expect(screen.getByText("PERSONAL")).toBeTruthy();
    expect(screen.getByText(/R\$/).textContent).toBe(brl(baseContract.contractAmount));
    expect(screen.getByText(/Contrato nº CN-123/).textContent).toContain(`vencimento ${dateBR(baseContract.dueDate)}`);
  });

  test("AC-005: abre detalhes, consulta o contrato e renderiza CET, taxas e parcelas", async () => {
    mockState.loans = ok({ results: [{ item_id: "item-1", total: 1, results: [baseContract] }], errors: [] });
    const detail = {
      results: [
        {
          loan_id: "loan-1",
          loan: {
            contractDate: "2025-01-15",
            CET: 2.5,
            installmentPeriodicity: "MENSAL",
            interestRates: [
              {
                taxType: "JUROS",
                preFixedRate: 1.9,
                calculation: "SIMPLES",
                taxPeriodicity: "YEARLY",
              },
            ],
            installments: {
              totalNumberOfInstallments: 24,
              contractRemainingNumber: 12,
              paidInstallments: 12,
              pastDueInstallments: 0,
            },
          },
        },
      ],
    };
    fetchSpy.mockResolvedValue({ ok: true, json: async () => detail });
    renderLoans();

    fireEvent.click(screen.getByRole("button", { name: /Detalhes/ }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/bank/loans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ loan_ids: ["loan-1"] }),
    }));
    await waitFor(() => {
      expect(screen.getByText("Contratado em").parentElement?.textContent).toContain(dateBR("2025-01-15"));
      expect(screen.getByText("CET").parentElement?.textContent).toContain("2.5%");
      expect(screen.getByText("Periodicidade").parentElement?.textContent).toContain("MENSAL");
      expect(screen.getByText("JUROS (SIMPLES)").parentElement?.textContent).toContain("1.9% a.a.");
      expect(screen.getByText("Total de parcelas").parentElement?.textContent).toContain("24");
      expect(screen.getByText("Parcelas restantes").parentElement?.textContent).toContain("12");
    });

    fireEvent.click(screen.getByRole("button", { name: /Detalhes/ }));
    expect(screen.queryByText("Contratado em")).toBeNull();
  });

  test("AC-005: exibe pagamento balloon quando não há parcelas", async () => {
    mockState.loans = ok({ results: [{ item_id: "item-1", total: 1, results: [baseContract] }], errors: [] });
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            loan_id: "loan-1",
            loan: {
              installments: {
                totalNumberOfInstallments: 0,
                balloonPayments: [{ dueDate: "2027-01-10", amount: { value: 5000 } }],
              },
            },
          },
        ],
      }),
    });
    renderLoans();
    fireEvent.click(screen.getByRole("button", { name: /Detalhes/ }));

    await waitFor(() => {
      expect(screen.getByText(/Pagamento único \(balloon\)/).textContent).toContain(
        `Pagamento único (balloon) em ${dateBR("2027-01-10")} · ${brl(5000)}.`,
      );
    });
  });

  test("AC-005: diferencia detalhe vazio e erro HTTP do provedor", async () => {
    mockState.loans = ok({ results: [{ item_id: "item-1", total: 1, results: [baseContract] }], errors: [] });
    fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) });
    renderLoans();
    fireEvent.click(screen.getByRole("button", { name: /Detalhes/ }));
    await waitFor(() => expect(screen.getByText("Sem detalhes para este contrato.")).toBeTruthy());

    cleanup();
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({ error: "boom" }) });
    renderLoans();
    fireEvent.click(screen.getByRole("button", { name: /Detalhes/ }));
    await waitFor(() => expect(screen.getByText("boom")).toBeTruthy());
  });
});
