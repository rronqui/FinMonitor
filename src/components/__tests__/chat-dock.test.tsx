import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const chatState = vi.hoisted(() => ({
  messages: [] as unknown[],
  status: "ready" as string,
  error: null as Error | null,
}));
const sendMessageSpy = vi.hoisted(() => vi.fn());
const stopSpy = vi.hoisted(() => vi.fn());
const setMessagesSpy = vi.hoisted(() => vi.fn());
const pushSpy = vi.hoisted(() => vi.fn());
const lastChatOpts = vi.hoisted(() => ({ current: undefined as unknown }));

function capturedMessages(): unknown {
  const opts = lastChatOpts.current;
  if (opts && typeof opts === "object" && "messages" in opts) {
    return opts.messages;
  }
  return undefined;
}

vi.mock("ai", () => ({
  DefaultChatTransport: class {
    constructor(public opts: unknown) {}
  },
}));
vi.mock("@ai-sdk/react", () => ({
  useChat: (opts: unknown) => {
    lastChatOpts.current = opts;
    return {
      messages: chatState.messages,
      sendMessage: sendMessageSpy,
      status: chatState.status,
      error: chatState.error,
      stop: stopSpy,
      setMessages: setMessagesSpy,
    };
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushSpy }) }));

import ChatDock from "../chat-dock";

const STORAGE_KEY = "finmonitor.chat.v1";
const SIZE_KEY = "finmonitor.chat.size.v1";

function openDock() {
  fireEvent.click(screen.getByRole("button", { name: "Abrir assistente" }));
}

beforeEach(() => {
  localStorage.clear();
  chatState.messages = [];
  chatState.status = "ready";
  chatState.error = null;
  sendMessageSpy.mockReset();
  stopSpy.mockReset();
  setMessagesSpy.mockReset();
  pushSpy.mockReset();
  lastChatOpts.current = undefined;
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
});
afterEach(cleanup);

describe("ChatDock", () => {
  test("AC-003: começa fechado, abre pelo botão flutuante e fecha pelo botão do painel", () => {
    render(<ChatDock />);

    expect(screen.getByRole("button", { name: "Abrir assistente" })).toBeTruthy();
    expect(screen.queryByText("Assistente FinMonitor")).toBeNull();

    openDock();
    expect(screen.getByText("Assistente FinMonitor")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fechar assistente" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByText("Assistente FinMonitor")).toBeNull();
  });

  test("AC-003: mostra quatro sugestões e envia a sugestão escolhida", () => {
    render(<ChatDock />);
    openDock();

    expect(screen.getByRole("button", { name: "Qual meu saldo total?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Quanto gastei nos últimos 30 dias?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Quando vence a próxima fatura?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Como estão meus investimentos?" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Qual meu saldo total?" }));
    expect(sendMessageSpy).toHaveBeenCalledWith({ text: "Qual meu saldo total?" });
  });

  test("AC-003: mantém envio desabilitado sem texto e limpa o input após envio", () => {
    render(<ChatDock />);
    openDock();

    const input = screen.getByPlaceholderText("Ex.: quanto gastei este mês?");
    expect((screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(input, { target: { value: "  saldo de hoje  " } });
    expect((screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    expect(sendMessageSpy).toHaveBeenCalledWith({ text: "saldo de hoje" });
    expect((input as HTMLInputElement).value).toBe("");
  });

  test("AC-003: em processamento mostra estado busy, permite parar e bloqueia envio e sugestões", () => {
    chatState.status = "submitted";
    render(<ChatDock />);
    openDock();

    expect(screen.getByText("Analisando…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Parar processamento" }));
    expect(stopSpy).toHaveBeenCalledTimes(1);

    const input = screen.getByPlaceholderText("Ex.: quanto gastei este mês?");
    fireEvent.change(input, { target: { value: "não enviar" } });
    fireEvent.submit(input.closest("form")!);
    fireEvent.click(screen.getByRole("button", { name: "Qual meu saldo total?" }));
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  test("AC-003: exibe erro do provedor", () => {
    chatState.error = new Error("falha no provedor");
    render(<ChatDock />);
    openDock();

    expect(screen.getByText("falha no provedor")).toBeTruthy();
  });

  test("AC-003: renderiza bolhas, markdown de assistente e chips de ferramentas", () => {
    chatState.messages = [
      { id: "1", role: "user", parts: [{ type: "text", text: "oi" }] },
      {
        id: "2",
        role: "assistant",
        parts: [
          { type: "text", text: "**olá**" },
          { type: "tool-saldo", state: "output-available" },
          { type: "tool-bills" },
        ],
      },
    ];
    render(<ChatDock />);
    openDock();

    expect(screen.getByText("oi")).toBeTruthy();
    expect(screen.getByText("olá").tagName).toBe("STRONG");
    expect(screen.getByText("✓ saldo")).toBeTruthy();
    const billsChip = Array.from(document.querySelectorAll("span")).find((span) => span.textContent?.includes("bills"));
    expect(billsChip?.textContent).not.toContain("✓");
  });

  test("AC-003: hidrata apenas mensagens com parts de texto e ignora JSON inválido ou não-array", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: "1", role: "user", parts: [{ type: "text", text: "mantido" }, { type: "tool-x" }] },
        { id: "2", role: "assistant", parts: [{ type: "tool-y" }] },
      ]),
    );
    render(<ChatDock />);
    expect(capturedMessages()).toEqual([
      { id: "1", role: "user", parts: [{ type: "text", text: "mantido" }] },
    ]);

    cleanup();
    localStorage.setItem(STORAGE_KEY, "{oops");
    render(<ChatDock />);
    expect(capturedMessages()).toBeUndefined();

    cleanup();
    localStorage.setItem(STORAGE_KEY, "{}");
    render(<ChatDock />);
    expect(capturedMessages()).toBeUndefined();
  });

  test("AC-003: persiste somente parts de texto e limita o histórico a 40 mensagens", async () => {
    chatState.messages = [
      { id: "1", role: "assistant", parts: [{ type: "text", text: "texto" }, { type: "tool-x" }] },
    ];
    render(<ChatDock />);
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([
        { id: "1", role: "assistant", parts: [{ type: "text", text: "texto" }] },
      ]);
    });

    cleanup();
    localStorage.clear();
    chatState.messages = Array.from({ length: 45 }, (_, i) => ({
      id: String(i + 1),
      role: "user",
      parts: [{ type: "text", text: `msg-${i + 1}` }],
    }));
    render(<ChatDock />);
    await waitFor(() => expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toHaveLength(40));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)[0].id).toBe("6");
  });

  test("AC-003: limpa conversa habilitada com mensagens e desabilitada sem mensagens", () => {
    chatState.messages = [{ id: "1", role: "user", parts: [{ type: "text", text: "oi" }] }];
    render(<ChatDock />);
    openDock();

    const clearButton = screen.getByRole("button", { name: "Limpar conversa" });
    expect((clearButton as HTMLButtonElement).disabled).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    fireEvent.click(clearButton);
    expect(setMessagesSpy).toHaveBeenCalledWith([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    cleanup();
    chatState.messages = [];
    render(<ChatDock />);
    openDock();
    expect((screen.getByRole("button", { name: "Limpar conversa" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("AC-003: usa tamanho padrão e restaura tamanho persistido ao abrir", () => {
    render(<ChatDock />);
    openDock();
    const defaultPanel = screen.getByText("Assistente FinMonitor").closest<HTMLElement>("div.fixed")!;
    expect(defaultPanel.style.width).toBe("420px");
    expect(defaultPanel.style.height).toBe("560px");

    cleanup();
    localStorage.clear();
    localStorage.setItem(SIZE_KEY, JSON.stringify({ w: 500, h: 400 }));
    render(<ChatDock />);
    openDock();
    const restoredPanel = screen.getByText("Assistente FinMonitor").closest<HTMLElement>("div.fixed")!;
    expect(restoredPanel.style.width).toBe("500px");
    expect(restoredPanel.style.height).toBe("400px");
  });
});
