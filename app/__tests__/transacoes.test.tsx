import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { brl, dateBR } from "@/src/lib/format";

// Recharts consults ResizeObserver while rendering charts in jsdom.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const captured = vi.hoisted(() => ({
  txParams: null as unknown,
  params: new URLSearchParams(),
}));
const mockState = vi.hoisted(() => ({
  bundle: null as unknown,
  tx: null as unknown,
  categories: null as unknown,
  categorize: null as unknown,
}));

vi.mock("next/navigation", () => ({ useSearchParams: () => captured.params }));
vi.mock("@/src/lib/hooks", () => ({
  useAccountsBundle: () => mockState.bundle,
  useTransactions: (params: unknown) => {
    captured.txParams = params;
    return mockState.tx;
  },
  useCategories: () => mockState.categories,
  useCategorize: () => mockState.categorize,
}));

import TransactionsPage from "../transacoes/page";

type TxFixture = {
  id: string;
  date: string;
  description: string;
  category: string;
  amount: string;
  kind: "spend" | "income" | "transfer" | "investment";
  abs_amount: number;
  status: string;
  categoryId?: string;
};
type CapturedParams = {
  account_id?: string;
  from?: string;
  to?: string;
  windows?: Array<{ from: string; to: string }>;
  page?: number;
  search_queries?: string[];
  category?: string;
  kind?: string;
  status?: string;
  desc_norm?: string[];
};

function currentParams(): CapturedParams {
  if (!captured.txParams || typeof captured.txParams !== "object") throw new Error("transaction payload was not captured");
  return captured.txParams as CapturedParams;
}


const ok = <T,>(data: T) => ({ data, isLoading: false, isError: false, error: null, refetch: vi.fn() });
const loading = () => ({ data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn() });
const error = (message: string) => ({ data: undefined, isLoading: false, isError: true, error: new Error(message), refetch: vi.fn() });

const account = {
  id: "a1",
  account_id: "a1",
  type: "BANK" as const,
  subtype: "CHECKING",
  name: "Conta principal",
  number: "1234",
  balance: "1000",
  currencyCode: "BRL",
};
const baseBundle = {
  connections: { connections: [], count: 0 },
  accounts: { total: 1, bank: "Banco", item_id: "item1", results: [account] },
  details: { results: [] },
};
const baseTx: TxFixture = {
  id: "t1",
  date: "2026-08-01",
  description: "Mercado",
  category: "Supermarket",
  amount: "-50",
  kind: "spend",
  abs_amount: 50,
  status: "POSTED",
  categoryId: "c1",
};
const basePayload = {
  total: 1,
  page: 1,
  totalPages: 1,
  results: [baseTx],
  summary: { entradas: 0, saidas: 50, total: -50 },
  breakdown: [],
};
const categoriesPayload = {
  total: 2,
  results: [
    { id: "c1", description: "Supermarket", descriptionTranslated: "Supermercado", parentId: null, parentDescription: "Alimentação" },
    { id: "c2", description: "Food", descriptionTranslated: "Alimentação", parentId: null, parentDescription: "Alimentação" },
  ],
};

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

const originalFetch = globalThis.fetch;

afterEach(cleanup);
afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  captured.params = new URLSearchParams();
});

function setDefaults() {
  captured.txParams = null;
  captured.params = new URLSearchParams();
  mockState.bundle = ok(baseBundle);
  mockState.tx = ok(basePayload);
  mockState.categories = ok(categoriesPayload);
  mockState.categorize = { mutate: vi.fn(), isPending: false, isError: false, error: null };
}

beforeEach(setDefaults);

describe("TransactionsPage", () => {
  test("AC-008: cobre erro do bundle, carregamento, erro de transações e vazio", () => {
    const bundleRetry = vi.fn();
    mockState.bundle = { ...error("Falha no bundle"), refetch: bundleRetry };
    const view = render(<TransactionsPage />);
    expect(screen.getByText("Falha no bundle")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(bundleRetry).toHaveBeenCalledOnce();

    view.unmount();
    mockState.bundle = ok(baseBundle);
    mockState.tx = loading();
    render(<TransactionsPage />);
    expect(screen.getByText("Transações")).toBeTruthy();
    expect(document.querySelectorAll(".animate-pulse")).toHaveLength(6);

    cleanup();
    mockState.tx = error("Falha nas transações");
    render(<TransactionsPage />);
    expect(screen.getByText("Falha nas transações")).toBeTruthy();

    cleanup();
    mockState.tx = ok({ ...basePayload, total: 0, results: [] });
    render(<TransactionsPage />);
    expect(screen.getByText("Nenhuma transação no período")).toBeTruthy();
  });

  test("AC-008: renderiza contagem, linha formatada, tipo e status", () => {
    mockState.tx = ok({ ...basePayload, total: 120, results: [baseTx] });
    render(<TransactionsPage />);

    expect(screen.getByText("120 transação(ões) no período com os filtros atuais")).toBeTruthy();
    expect(screen.getByText(dateBR(baseTx.date))).toBeTruthy();
    expect(screen.getByText("Mercado")).toBeTruthy();
    const row = screen.getByText("Mercado").closest("tr");
    expect(row?.textContent).toContain(brl(50));
    const amount = row?.querySelector(".text-neg");
    expect(amount?.textContent).toBe(brl(50));
    expect(amount?.className).toContain("text-neg");
    expect(screen.getByText("Gasto")).toBeTruthy();
    expect(screen.getByText("Confirmada")).toBeTruthy();

    cleanup();
    mockState.tx = ok({ ...basePayload, results: [{ ...baseTx, status: "PENDING" }] });
    render(<TransactionsPage />);
    expect(screen.getByText("Pendente")).toBeTruthy();
  });

  test("AC-008: exibe os três cards de resumo com brl", () => {
    mockState.tx = ok({
      ...basePayload,
      summary: { entradas: 1000, saidas: 400, total: 0 },
    });
    render(<TransactionsPage />);

    expect(screen.getByText("Entradas (filtro atual)").parentElement?.textContent).toContain(brl(1000));
    expect(screen.getByText("Saídas (filtro atual)").parentElement?.textContent).toContain(brl(400));
    expect(screen.getByText("Resultado (filtro atual)").parentElement?.textContent).toContain(brl(600));
  });

  test("AC-008: reflete conta, período, tipo e busca no payload", () => {
    render(<TransactionsPage />);

    fireEvent.change(screen.getByLabelText("Conta"), { target: { value: "a1" } });
    expect(currentParams().account_id).toBe("a1");

    fireEvent.change(screen.getByLabelText("Período"), { target: { value: "90" } });
    const ninety = currentParams();
    expect(ninety.from).toMatch(/^\d{4}-\d{2}-\d{2}/);
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "POSTED" } });
    expect(currentParams().status).toBe("POSTED");

    expect(ninety.to).toBeUndefined();

    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "spend" } });
    expect(currentParams().kind).toBe("spend");

    fireEvent.change(screen.getByPlaceholderText("ex.: mercado, salário…"), { target: { value: " mercado " } });
    expect(currentParams().search_queries).toEqual(["mercado"]);
  });

  test("AC-008: período personalizado exibe datas e atualiza from", () => {
    render(<TransactionsPage />);
    fireEvent.change(screen.getByLabelText("Período"), { target: { value: "custom" } });
    const from = screen.getByLabelText("De") as HTMLInputElement;
    const to = screen.getByLabelText("Até") as HTMLInputElement;
    expect(from.type).toBe("date");
    expect(to.type).toBe("date");

    fireEvent.change(from, { target: { value: "2026-07-01" } });
    expect(currentParams().from).toBe("2026-07-01");
  });

  test("AC-008: reúne opções de categoria, traduz o rótulo e envia category", () => {
    mockState.tx = ok({ ...basePayload, breakdown: [{ key: "Food", name: "Alimentação", total: 20 }] });
    render(<TransactionsPage />);

    expect(screen.getAllByRole("option", { name: "Supermercado" })).toHaveLength(2);
    expect(screen.getAllByRole("option", { name: "Alimentação" })).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Categoria"), { target: { value: "Food" } });
    expect(currentParams().category).toBe("Food");
  });

  test("AC-008: mostra o card Por categoria quando há breakdown", () => {
    mockState.tx = ok({ ...basePayload, breakdown: [{ key: "Food", name: "Alimentação", total: 20 }] });
    render(<TransactionsPage />);
    expect(screen.getByText("Por categoria — gastos (filtros atuais) — clique na barra para filtrar")).toBeTruthy();
  });

  test("AC-008: pagina resultados e desabilita os limites", () => {
    mockState.tx = ok({ ...basePayload, total: 120, totalPages: 3 });
    render(<TransactionsPage />);
    expect(screen.getByText(/Página 1 de 3/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Anterior" })).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    expect(screen.getByText(/Página 2 de 3/)).toBeTruthy();
    expect(currentParams().page).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    expect(screen.getByText(/Página 3 de 3/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Próxima" })).toHaveProperty("disabled", true);
  });

  test("AC-008: chip de recorrência usa desc_norm e pode ser limpo", () => {
    captured.params = new URLSearchParams("desc=a&desc=b");
    render(<TransactionsPage />);
    const chip = screen.getByRole("button", { name: "Recorrência específica ativa — clique para limpar" });
    expect(chip).toBeTruthy();
    expect(currentParams().desc_norm).toEqual(["a", "b"]);

    fireEvent.click(chip);
    expect(screen.queryByRole("button", { name: "Recorrência específica ativa — clique para limpar" })).toBeNull();
    expect(currentParams().desc_norm).toBeUndefined();
  });

  test("AC-008: janelas múltiplas substituem from/to e limpar restaura a primeira janela", () => {
    captured.params = new URLSearchParams();
    captured.params.append("fromIso", "2026-07-01T03:00:00.000Z");
    captured.params.append("toIso", "2026-07-10T03:00:00.000Z");
    captured.params.append("fromIso", "2026-08-01T03:00:00.000Z");
    captured.params.append("toIso", "2026-08-05T03:00:00.000Z");
    render(<TransactionsPage />);

    expect(screen.getByRole("button", { name: "2 janelas comparadas ativas — clique para limpar" })).toBeTruthy();
    const params = currentParams();
    expect(params.windows).toEqual([
      { from: "2026-07-01T03:00:00.000Z", to: "2026-07-10T03:00:00.000Z" },
      { from: "2026-08-01T03:00:00.000Z", to: "2026-08-05T03:00:00.000Z" },
    ]);
    expect(params.from).toBeUndefined();
    expect(params.to).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "2 janelas comparadas ativas — clique para limpar" }));
    const restored = currentParams();
    expect(restored.windows).toBeUndefined();
    expect(restored.from).toBe("2026-07-01T03:00:00.000Z");
  });

  test("AC-008: preserva timestamps completos de drill-down nos selects e payload", () => {
    captured.params = new URLSearchParams(
      "range=custom&fromIso=2026-07-01T03:00:00.000Z&toIso=2026-07-31T03:00:00.000Z&kind=spend&category=Supermarket",
    );
    render(<TransactionsPage />);

    expect((screen.getByLabelText("Tipo") as HTMLSelectElement).value).toBe("spend");
    expect((screen.getByLabelText("Categoria") as HTMLSelectElement).value).toBe("Supermarket");
    expect(currentParams().from).toBe("2026-07-01T03:00:00.000Z");
  });

  test("AC-008: exporta CSV formatado, escapa aspas e envia page_size 5000", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [{ date: "2026-08-01", description: 'Padaria "Pão"', category: "Food", amount: "-12.5", kind: "spend", status: "POSTED" }] }),
    });
    globalThis.fetch = fetchSpy;
    const createObjectURLSpy = vi.fn((_obj: Blob) => "blob:x");
    URL.createObjectURL = createObjectURLSpy;
    const revokeSpy = vi.fn();
    URL.revokeObjectURL = revokeSpy;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<TransactionsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Exportar CSV" }));
    await waitFor(() => expect(clickSpy).toHaveBeenCalledOnce());
    expect(fetchSpy).toHaveBeenCalledWith("/api/bank/transactions", expect.objectContaining({ method: "POST" }));
    const request = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string) as { page_size: number };
    expect(request.page_size).toBe(5000);

    const blob = createObjectURLSpy.mock.calls[0][0] as Blob;
    const csv = await blob.text();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv).toContain("data;descricao;categoria;valor;tipo;status");
    expect(csv).toContain('"Padaria ""Pão"""');
    expect(csv).toContain("-12,5");
    expect(csv).toContain("Gasto");
    expect(clickSpy.mock.instances[0]).toHaveProperty("download", `transacoes-todas-${String((captured.txParams as { from?: string }).from).slice(0, 10)}.csv`);
    expect(revokeSpy).toHaveBeenCalledWith("blob:x");
  });

  test("AC-008: desabilita exportação sem transações", () => {
    mockState.tx = ok({ ...basePayload, results: [], total: 0 });
    render(<TransactionsPage />);
    expect(screen.getByRole("button", { name: "Exportar CSV" })).toHaveProperty("disabled", true);
  });

  test("AC-008: apresenta erros HTTP e de rede ao exportar", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    globalThis.fetch = fetchSpy;
    render(<TransactionsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Exportar CSV" }));
    await waitFor(() => expect(screen.getByText("Erro 500 ao exportar")).toBeTruthy());

    cleanup();
    fetchSpy.mockRejectedValue(new Error("offline"));
    render(<TransactionsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Exportar CSV" }));
    await waitFor(() => expect(screen.getByText("offline")).toBeTruthy());
  });

  test("AC-008: recategoriza uma linha e expõe estados da mutação", () => {
    const mutate = vi.fn();
    mockState.categorize = { mutate, isPending: false, isError: false, error: null };
    render(<TransactionsPage />);
    const rowCategory = screen.getAllByRole("combobox").at(-1) as HTMLSelectElement;
    fireEvent.change(rowCategory, { target: { value: "c2" } });
    expect(mutate).toHaveBeenCalledWith([{ transaction_id: "t1", category_id: "c2" }]);

    cleanup();
    mockState.categorize = { mutate: vi.fn(), isPending: true, isError: false, error: null };
    render(<TransactionsPage />);
    expect(screen.getByText("salvando…")).toBeTruthy();

    cleanup();
    mockState.categorize = { mutate: vi.fn(), isPending: false, isError: true, error: new Error("Falha ao categorizar") };
    render(<TransactionsPage />);
    expect(screen.getByText("Falha ao categorizar")).toBeTruthy();
  });
});
