"use client";

import type { ReactNode } from "react";
import { brl } from "@/src/lib/format";
import { KIND_LABEL, type TxKind } from "@/src/lib/semantics";

export function Card({
  title,
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold text-text">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "pos" | "neg" | "default";
}) {
  const toneClass = tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-text";
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export type BadgeTone = "green" | "red" | "yellow" | "gray";

const badgeTones: Record<BadgeTone, string> = {
  green: "bg-pos/15 text-pos border-pos/30",
  red: "bg-neg/15 text-neg border-neg/30",
  yellow: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  gray: "bg-muted/15 text-muted border-muted/30",
};

export function Badge({ children, tone = "gray" }: { children: ReactNode; tone?: BadgeTone }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${badgeTones[tone]}`}
    >
      {children}
    </span>
  );
}

export function connectionStatusBadge(status: string): { tone: BadgeTone; label: string } {
  if (status === "UPDATED") return { tone: "green", label: "Atualizada" };
  if (status === "LOGIN_ERROR") return { tone: "red", label: "Erro de login" };
  return { tone: "yellow", label: status };
}

export function billStatusBadge(status: string | undefined): { tone: BadgeTone; label: string } {
  switch (status) {
    case "PAID":
      return { tone: "green", label: "Paga" };
    case "PAST_DUE_UNPAID":
      return { tone: "red", label: "Atrasada (não paga)" };
    case "PAST_DUE_UNCONFIRMED":
      return { tone: "yellow", label: "Vencida (pagamento não confirmado)" };
    case "OPEN":
      return { tone: "gray", label: "Em aberto" };
    default:
      return { tone: "gray", label: status ?? "—" };
  }
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-surface2 ${className}`} />;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-neg/30 bg-neg/10 p-5 text-sm text-text">
      <p className="font-medium text-neg">Erro ao carregar dados</p>
      <p className="mt-1 text-muted">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 rounded-lg border border-border bg-surface2 px-3 py-1.5 text-xs font-medium hover:bg-border"
        >
          Tentar novamente
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  href,
  linkLabel,
}: {
  title: string;
  hint?: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-8 text-center">
      <p className="text-sm font-medium text-text">{title}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {href && linkLabel && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
        >
          {linkLabel}
        </a>
      )}
    </div>
  );
}

/** Cor por semântica persistida (kind), nunca derivada do sinal cru. */
export function AmountByKind({ value, kind }: { value: string | number; kind: TxKind }) {
  const cls =
    kind === "spend" ? "text-neg" : kind === "income" ? "text-pos" : kind === "investment" ? "text-primary" : "text-muted";
  return <span className={`tabular-nums ${cls}`}>{brl(value)}</span>;
}

export function KindBadge({ kind }: { kind: TxKind }) {
  const tone: BadgeTone =
    kind === "spend" ? "red" : kind === "income" ? "green" : kind === "investment" ? "yellow" : "gray";
  return <Badge tone={tone}>{KIND_LABEL[kind]}</Badge>;
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-text">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}


/** Extrai um campo (ex.: "key" ou "name") do payload de uma barra clicada no recharts. */
export function barFieldFromClick(entry: unknown, field: string): string | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  const candidates: unknown[] = [e, e.payload, (e.activePayload as unknown[] | undefined)?.[0]];
  for (const c of candidates) {
    if (c && typeof c === "object") {
      const p = (c as Record<string, unknown>).payload as Record<string, unknown> | undefined;
      const direct = (c as Record<string, unknown>)[field];
      if (typeof direct === "string") return direct;
      if (p && typeof p[field] === "string") return p[field] as string;
    }
  }
  return null;
}
