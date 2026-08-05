import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type SyncMetaMock = {
  data?: { syncedAt: string | null; syncing: boolean; lastError: string | null };
  isError: boolean;
  error: Error | null;
};

const pathState = vi.hoisted(() => ({ path: "/" }));
const metaState = vi.hoisted(() => ({ meta: null as SyncMetaMock | null }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathState.path,
}));
vi.mock("@/src/lib/hooks", () => ({
  useSyncMeta: () => metaState.meta,
}));

import { Sidebar } from "../sidebar";

const defaultMeta = (): SyncMetaMock => ({
  data: { syncedAt: null, syncing: false, lastError: null },
  isError: false,
  error: null,
});

function setMeta(overrides: Partial<SyncMetaMock> = {}) {
  metaState.meta = { ...defaultMeta(), ...overrides };
}

const routes = [
  ["/", "Visão Geral"],
  ["/transacoes", "Transações"],
  ["/cartoes", "Cartões"],
  ["/investimentos", "Investimentos"],
  ["/emprestimos", "Empréstimos"],
  ["/conexoes", "Conexões"],
] as const;

const originalVersion = process.env.NEXT_PUBLIC_APP_VERSION;

beforeEach(() => {
  pathState.path = "/";
  setMeta();
  process.env.NEXT_PUBLIC_APP_VERSION = "0.0.0-test";
});

afterEach(cleanup);
afterEach(() => {
  vi.useRealTimers();
  if (originalVersion === undefined) delete process.env.NEXT_PUBLIC_APP_VERSION;
  else process.env.NEXT_PUBLIC_APP_VERSION = originalVersion;
});

describe("Sidebar — AC-002", () => {
  test("renderiza as seis rotas com hrefs e labels em cada navegação", () => {
    render(<Sidebar />);

    for (const [href, label] of routes) {
      const links = screen.getAllByRole("link", { name: new RegExp(label) });
      expect(links).toHaveLength(2);
      expect(links.every((link) => link.getAttribute("href") === href)).toBe(true);
    }
  });

  test("marca Visão Geral como ativa apenas no pathname raiz", () => {
    pathState.path = "/";
    render(<Sidebar />);

    for (const link of screen.getAllByRole("link", { name: /Visão Geral/ })) {
      expect(link.className).toContain("bg-primary/20");
    }
  });

  test("marca Transações como ativa e mantém Visão Geral inativa em /transacoes", () => {
    pathState.path = "/transacoes";
    render(<Sidebar />);

    for (const link of screen.getAllByRole("link", { name: /Transações/ })) {
      expect(link.className).toContain("bg-primary/20");
    }
    for (const link of screen.getAllByRole("link", { name: /Visão Geral/ })) {
      expect(link.className).not.toContain("bg-primary/20");
    }
  });

  test("não aplica o estado ativo da raiz a /cartoes", () => {
    pathState.path = "/cartoes";
    render(<Sidebar />);

    for (const link of screen.getAllByRole("link", { name: /Visão Geral/ })) {
      expect(link.className).not.toContain("bg-primary/20");
    }
    for (const link of screen.getAllByRole("link", { name: /Cartões/ })) {
      expect(link.className).toContain("bg-primary/20");
    }
  });

  describe("SyncChip", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-05T12:00:00Z"));
    });

    test("mostra o estado de sincronização em andamento", () => {
      setMeta({ data: { syncedAt: null, syncing: true, lastError: null } });
      render(<Sidebar />);

      expect(screen.getByText("Sincronizando…")).toBeTruthy();
    });

    test("mostra erro de consulta do sync", () => {
      setMeta({ data: undefined, isError: true, error: new Error("falha de rede") });
      render(<Sidebar />);

      expect(screen.getByText("Falha ao consultar sync")).toBeTruthy();
    });

    test("mostra primeira sincronização quando syncedAt é nulo", () => {
      setMeta({ data: { syncedAt: null, syncing: false, lastError: null } });
      render(<Sidebar />);

      expect(screen.getByText("Primeira sincronização…")).toBeTruthy();
    });

    test.each([
      ["5 min", "2026-08-05T11:55:00.000Z", "Atualizado há 5 min"],
      ["20 s", "2026-08-05T11:59:40.000Z", "Atualizado agora"],
      ["2 h", "2026-08-05T10:00:00.000Z", "Atualizado há 2 h"],
    ])("formata a última sincronização há %s", (_label, syncedAt, expected) => {
      setMeta({ data: { syncedAt, syncing: false, lastError: null } });
      render(<Sidebar />);

      expect(screen.getByText(expected)).toBeTruthy();
    });

    test("expõe lastError no title do chip", () => {
      setMeta({ data: { syncedAt: "2026-08-05T11:55:00.000Z", syncing: false, lastError: "boom" } });
      render(<Sidebar />);

      const chip = screen.getByTitle("boom");
      expect(chip.textContent).toContain("Atualizado há 5 min");
    });
  });

  test("exibe a versão da aplicação no rodapé do aside", () => {
    render(<Sidebar />);

    expect(screen.getByText("v0.0.0-test")).toBeTruthy();
  });
});
