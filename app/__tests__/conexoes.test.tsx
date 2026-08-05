import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  connections: null as unknown,
  sync: null as unknown,
  disconnect: null as unknown,
}));

vi.mock("@/src/lib/hooks", () => ({
  useConnections: () => mockState.connections,
  useSync: () => mockState.sync,
  useDisconnect: () => mockState.disconnect,
}));

import ConnectionsPage from "../conexoes/page";
import { dateTimeBR } from "@/src/lib/format";

const ok = <T,>(data: T) => ({
  data,
  isLoading: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
});
const loading = () => ({
  data: undefined,
  isLoading: true,
  isError: false,
  error: null,
  refetch: vi.fn(),
});
const error = (message: string) => ({
  data: undefined,
  isLoading: false,
  isError: true,
  error: new Error(message),
  refetch: vi.fn(),
});
const mutation = (overrides: Record<string, unknown> = {}) => ({
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
  ...overrides,
});

const emptyResult = { connections: [], count: 0 };
const connection = {
  connector_id: "nubank",
  connector_name: "Nubank",
  item_id: "it1",
  status: "UPDATED",
  created_at: "2026-08-01T10:00:00Z",
};

function setDefaults() {
  mockState.connections = ok(emptyResult);
  mockState.sync = mutation();
  mockState.disconnect = mutation();
}

beforeEach(setDefaults);
afterEach(cleanup);

describe("ConnectionsPage", () => {
  test("exibe erro e permite tentar novamente", () => {
    const connections = error("falha ao consultar conexões");
    mockState.connections = connections;

    render(<ConnectionsPage />);

    expect(screen.getByText("falha ao consultar conexões")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(connections.refetch).toHaveBeenCalledTimes(1);
  });

  test("exibe header e estado de carregamento", () => {
    mockState.connections = loading();

    render(<ConnectionsPage />);

    expect(screen.getByRole("heading", { name: "Conexões" })).toBeTruthy();
    expect(screen.getByText("Carregando…")).toBeTruthy();
  });

  test("exibe estado vazio e links para adicionar banco", () => {
    const addConnectionUrl = "https://bank.example/connect";
    mockState.connections = ok({ ...emptyResult, add_connection_url: addConnectionUrl });

    render(<ConnectionsPage />);

    expect(screen.getByText("Nenhuma conexão")).toBeTruthy();
    const links = screen.getAllByRole("link", { name: "Adicionar banco" });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.getAttribute("href")).toBe(addConnectionUrl);
      expect(link.getAttribute("target")).toBe("_blank");
    }
  });

  test("renderiza card de conexão sem link de reconexão", () => {
    mockState.connections = ok({ connections: [connection], count: 1 });

    render(<ConnectionsPage />);

    expect(screen.getByText("Nubank")).toBeTruthy();
    expect(screen.getByText("Atualizada")).toBeTruthy();
    expect(screen.getByText("item it1")).toBeTruthy();
    expect(screen.getByText(`conectada em ${dateTimeBR(connection.created_at)}`)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Reconectar" })).toBeNull();
  });

  test("renderiza link de reconexão externo quando disponível", () => {
    const reconnectUrl = "https://bank.example/reconnect/it1";
    mockState.connections = ok({
      connections: [{ ...connection, reconnect_url: reconnectUrl }],
      count: 1,
    });

    render(<ConnectionsPage />);

    const link = screen.getByRole("link", { name: "Reconectar" });
    expect(link.getAttribute("href")).toBe(reconnectUrl);
    expect(link.getAttribute("target")).toBe("_blank");
  });

  test("sincroniza e mostra estado pendente e erro", () => {
    const sync = mutation();
    mockState.sync = sync;
    mockState.connections = ok({ connections: [connection], count: 1 });
    const { rerender } = render(<ConnectionsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Sincronizar" }));
    expect(sync.mutate).toHaveBeenCalledTimes(1);

    mockState.sync = mutation({ isPending: true });
    rerender(<ConnectionsPage />);
    const pendingButton = screen.getByRole("button", { name: "Sincronizando…" });
    expect((pendingButton as HTMLButtonElement).disabled).toBe(true);

    mockState.sync = mutation({ isError: true, error: new Error("sync indisponível") });
    rerender(<ConnectionsPage />);
    expect(screen.getByText("sync indisponível")).toBeTruthy();
  });

  test("confirma desconexão em dois passos e mostra remoção pendente", () => {
    const disconnect = mutation();
    mockState.disconnect = disconnect;
    mockState.connections = ok({ connections: [connection], count: 1 });
    const { rerender } = render(<ConnectionsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Desconectar" }));
    expect(screen.getByRole("button", { name: "Confirmar desconexão?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar desconexão?" }));
    expect(disconnect.mutate).toHaveBeenCalledWith(
      { item: "it1", confirm: true },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );

    mockState.disconnect = mutation({ isPending: true });
    rerender(<ConnectionsPage />);
    const pendingButton = screen.getByRole("button", { name: "Removendo…" });
    expect((pendingButton as HTMLButtonElement).disabled).toBe(true);
  });

  test("exibe badge de erro de login", () => {
    mockState.connections = ok({
      connections: [{ ...connection, status: "LOGIN_ERROR" }],
      count: 1,
    });

    render(<ConnectionsPage />);

    expect(screen.getByText("Erro de login")).toBeTruthy();
  });
});
