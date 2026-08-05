"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { LoaderCircle, MessageCircle, Send, Square, Trash2, X } from "lucide-react";

const SUGGESTIONS = [
  "Qual meu saldo total?",
  "Quanto gastei nos últimos 30 dias?",
  "Quando vence a próxima fatura?",
  "Como estão meus investimentos?",
];

const STORAGE_KEY = "finmonitor.chat.v1";
const SIZE_KEY = "finmonitor.chat.size.v1";

/** Mantém só parts de texto: tool-parts interrompidas (state input-available)
 * viram tool-call sem tool-result e o LLM rejeita a sequência no próximo envio. */
function persistableMessages<T extends { parts?: Array<{ type?: string }> }>(msgs: T[]): T[] {
  return msgs
    .map((m) => ({ ...m, parts: (m.parts ?? []).filter((p) => p?.type === "text") }))
    .filter((m) => m.parts.length > 0) as T[];
}

export default function ChatDock() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [transport] = useState(() => new DefaultChatTransport({ api: "/api/chat" }));
  const [initialMessages] = useState(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
      if (!raw) return undefined;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return undefined;
      // sanitiza na leitura: recupera storages já corrompidos em produção.
      const cleaned = persistableMessages(parsed);
      return cleaned.length > 0 ? cleaned : undefined;
    } catch {
      return undefined;
    }
  });
  const { messages, sendMessage, status, error, stop, setMessages } = useChat({
    transport,
    messages: initialMessages,
  });
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(SIZE_KEY) : null;
      if (raw) {
        const s = JSON.parse(raw) as { w?: number; h?: number };
        if (typeof s.w === "number" && typeof s.h === "number") return { w: s.w, h: s.h };
      }
    } catch {
      // ignora
    }
    return { w: 420, h: 560 };
  });

  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persistableMessages(messages).slice(-40)));
    } catch {
      // storage cheio/indisponível: ignora
    }
  }, [messages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, open]);

  function submit(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    sendMessage({ text: t });
  }

  function navigate(url: string) {
    if (url.startsWith("/")) router.push(url);
    else window.open(url, "_blank", "noopener");
  }

  function clearChat() {
    if (busy) stop();
    setMessages([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignora
    }
  }

  function startDrag(e: React.PointerEvent) {
    e.preventDefault();
    const right = window.innerWidth - 20; // right-5
    const bottom = window.innerHeight - 80; // bottom-20
    const move = (ev: PointerEvent) => {
      setSize({
        w: Math.min(Math.max(320, right - ev.clientX), window.innerWidth - 40),
        h: Math.min(Math.max(280, bottom - ev.clientY), window.innerHeight - 100),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setSize((s) => {
        try {
          localStorage.setItem(SIZE_KEY, JSON.stringify(s));
        } catch {
          // ignora
        }
        return s;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  // renderer markdown: links internos navegam via router; externos em nova aba
  const mdComponents: Components = {
    p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
    h1: ({ children }) => <h1 className="mt-2 mb-1 text-base font-bold text-text">{children}</h1>,
    h2: ({ children }) => <h2 className="mt-2 mb-1 text-sm font-bold text-text">{children}</h2>,
    h3: ({ children }) => <h3 className="mt-2 mb-1 text-sm font-semibold text-text">{children}</h3>,
    ul: ({ children }) => <ul className="my-1.5 list-disc space-y-0.5 pl-5">{children}</ul>,
    ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-0.5 pl-5">{children}</ol>,
    strong: ({ children }) => <strong className="font-semibold text-text">{children}</strong>,
    pre: ({ children }) => (
      <pre className="my-1.5 overflow-x-auto rounded-lg bg-surface p-2 text-xs [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-text">
        {children}
      </pre>
    ),
    code: ({ children }) => (
      <code className="rounded bg-surface px-1 py-0.5 text-[0.85em] text-primary">{children}</code>
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-1.5 border-l-2 border-primary/50 pl-3 text-muted">{children}</blockquote>
    ),
    hr: () => <hr className="my-2 border-border" />,
    table: ({ children }) => (
      <div className="my-1.5 overflow-x-auto">
        <table className="w-full border-collapse text-xs">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-surface">{children}</thead>,
    th: ({ children }) => <th className="border border-border px-2 py-1 text-left font-semibold">{children}</th>,
    td: ({ children }) => <td className="border border-border px-2 py-1 tabular-nums">{children}</td>,
    a: ({ href, children }) =>
      href?.startsWith("/") ? (
        <button
          onClick={() => navigate(href)}
          className="text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary"
        >
          {children}
        </button>
      ) : (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
          {children}
        </a>
      ),
  };

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-50 flex h-13 w-13 items-center justify-center rounded-full bg-primary text-white shadow-lg shadow-primary/30 hover:opacity-90"
        aria-label={open ? "Fechar assistente" : "Abrir assistente"}
      >
        {open ? <X size={22} /> : <MessageCircle size={22} />}
      </button>

      {open && (
        <div
          className="fixed bottom-20 right-5 z-50 flex max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
          style={{ width: size.w, height: size.h }}
        >
          <header className="flex items-center justify-between border-b border-border py-3 pl-6 pr-4">
            <div>
              <p className="text-sm font-semibold text-text">Assistente FinMonitor</p>
              <p className="text-[11px] text-muted">Pergunte sobre seus dados bancários</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={clearChat}
                disabled={messages.length === 0 && !busy}
                className="rounded p-1 text-muted hover:text-text disabled:opacity-40"
                aria-label="Limpar conversa"
                title="Limpar conversa"
              >
                <Trash2 size={16} />
              </button>
              <button onClick={() => setOpen(false)} className="rounded p-1 text-muted hover:text-text" aria-label="Fechar">
                <X size={16} />
              </button>
            </div>
          </header>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 && (
              <div className="space-y-2 pt-2">
                <p className="text-xs text-muted">Sugestões:</p>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => submit(s)}
                    className="block w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-left text-xs text-text hover:border-primary/50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {messages.map((m) => {
              const toolParts = m.parts.filter((p) => p.type.startsWith("tool-"));
              const textParts = m.parts.filter((p) => p.type === "text");
              return (
                <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[90%] ${m.role === "user" ? "" : "min-w-0"}`}>
                    {m.role === "assistant" && toolParts.length > 0 && (
                      <div className="mb-1 flex flex-wrap gap-1">
                        {toolParts.map((part, i) => {
                          const name = part.type.slice(5);
                          const done = "state" in part && part.state === "output-available";
                          return (
                            <span
                              key={i}
                              className="inline-flex items-center gap-1 rounded-full bg-muted/15 px-2 py-0.5 text-[10px] text-muted"
                            >
                              {done ? (
                                <>✓ {name}</>
                              ) : (
                                <>
                                  <LoaderCircle size={10} className="animate-spin" /> {name}
                                </>
                              )}
                            </span>
                          );
                        })}
                      </div>
                    )}
                    {m.role === "user" ? (
                      <div className="rounded-xl bg-primary px-3 py-2 text-sm text-white">
                        <p className="whitespace-pre-wrap">{textParts.map((p) => ("text" in p ? p.text : "")).join("")}</p>
                      </div>
                    ) : (
                      textParts.length > 0 && (
                        <div className="rounded-xl border border-border bg-surface2 px-3 py-2 text-sm text-text">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                            {textParts.map((p) => ("text" in p ? p.text : "")).join("\n\n")}
                          </ReactMarkdown>
                        </div>
                      )
                    )}
                  </div>
                </div>
              );
            })}

            {busy && (
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <LoaderCircle size={12} className="animate-spin" /> Analisando…
              </p>
            )}

            {error && (
              <p className="rounded-lg border border-neg/30 bg-neg/10 px-3 py-2 text-xs text-neg">{error.message}</p>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
            className="flex items-center gap-2 border-t border-border px-3 py-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ex.: quanto gastei este mês?"
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-text placeholder:text-muted focus:border-primary focus:outline-none"
            />
            {busy && (
              <button
                type="button"
                onClick={() => stop()}
                className="rounded-lg bg-neg p-2 text-white hover:opacity-90"
                aria-label="Parar processamento"
                title="Parar processamento"
              >
                <Square size={16} />
              </button>
            )}
            {!busy && (
              <button
                type="submit"
                disabled={!input.trim()}
                className="rounded-lg bg-primary p-2 text-white disabled:opacity-40"
                aria-label="Enviar"
              >
                <Send size={16} />
              </button>
            )}
          </form>

          {/* alça de redimensionamento (canto superior esquerdo) */}
          <div
            onPointerDown={startDrag}
            className="absolute top-0 left-0 hidden h-5 w-5 cursor-nwse-resize sm:block"
            title="Redimensionar"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5 text-muted">
              <path d="M2 2 L18 18 M2 8 L12 18 M2 14 L6 18" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </div>
        </div>
      )}
    </>
  );
}
