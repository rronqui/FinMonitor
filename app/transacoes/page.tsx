"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download } from "lucide-react";
import type { CategoryNode } from "@/src/banco-mcp";
import {
  AmountByKind,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  KindBadge,
  PageHeader,
  Skeleton,
  barFieldFromClick,
} from "@/src/components/ui";
import { brl, dateBR } from "@/src/lib/format";
import { KIND_LABEL, prettifyCategory, type TxKind } from "@/src/lib/semantics";
import { useAccountsBundle, useCategorize, useCategories, useTransactions } from "@/src/lib/hooks";

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// SOMENTE prefixo (sem $) — drill-downs do dashboard passam timestamp completo
// via fromIso (ex.: "2026-08-04T15:00:00.000Z"); com âncora $ quebrariam.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
type RangeKey = "30" | "90" | "365" | "custom";
type KindFilter = "all" | TxKind;

const PIE_COLORS = [
  "#6366F1",
  "#22C55E",
  "#EAB308",
  "#EF4444",
  "#06B6D4",
  "#A855F7",
  "#F97316",
  "#84CC16",
  "#F472B6",
  "#94A3B8",
];

export default function TransactionsPage() {
  const bundle = useAccountsBundle();
  const accounts = bundle.data?.accounts.results ?? [];
  const searchParams = useSearchParams();

  // drill-down vindo da Visão Geral via query string
  const [accountId, setAccountId] = useState("all");
  const [range, setRange] = useState<RangeKey>(() => {
    const r = searchParams.get("range");
    return r === "custom" || r === "30" || r === "90" || r === "365" ? r : "30";
  });
  const [isoOverride, setIsoOverride] = useState<{ from: string; to?: string } | null>(() => {
    const f = searchParams.get("fromIso");
    return f ? { from: f, to: searchParams.get("toIso") ?? undefined } : null;
  });
  // Drill-down "Mesma janela" chega com 2+ pares fromIso/toIso: janelas
  // descontínuas que NÃO podem ser unidas num intervalo único.
  const [windows, setWindows] = useState<Array<{ from: string; to: string }>>(() => {
    const fs = searchParams.getAll("fromIso");
    const ts = searchParams.getAll("toIso");
    const pairs: Array<{ from: string; to: string }> = [];
    for (let i = 0; i < Math.min(fs.length, ts.length); i++) pairs.push({ from: fs[i], to: ts[i] });
    return pairs.length >= 2 ? pairs.filter((p) => ISO_DATE.test(p.from) && ISO_DATE.test(p.to)) : [];
  });
  const [customFrom, setCustomFrom] = useState(() => (isoOverride?.from ?? searchParams.get("from") ?? daysAgoISO(30)).slice(0, 10));
  const [customTo, setCustomTo] = useState(() => (isoOverride?.to ?? searchParams.get("to") ?? "").slice(0, 10));
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(() => searchParams.get("category") ?? "all");
  const [kind, setKind] = useState<KindFilter>(() => {
    const k = searchParams.get("kind");
    return k === "spend" || k === "income" || k === "transfer" || k === "investment" ? k : "all";
  });
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [descNorm, setDescNorm] = useState<string[]>(() => searchParams.getAll("desc").filter(Boolean));
  const [exportError, setExportError] = useState<string | null>(null);
  const customFromSafe = ISO_DATE.test(customFrom) ? customFrom : daysAgoISO(30);
  const customToSafe = customTo && ISO_DATE.test(customTo) ? customTo : undefined;
  const baseFrom = isoOverride && ISO_DATE.test(isoOverride.from) ? isoOverride.from : range === "custom" ? customFromSafe : daysAgoISO(Number(range));
  const baseTo = isoOverride ? (isoOverride.to && ISO_DATE.test(isoOverride.to) ? isoOverride.to : undefined) : range === "custom" ? customToSafe : undefined;
  // Janelas múltiplas substituem from/to; limpar o chip volta ao modo atual
  // (isoOverride = primeira janela), comportamento determinístico.
  const multiWindow = windows.length >= 2;
  const effectiveFrom = multiWindow ? undefined : baseFrom;
  const effectiveTo = multiWindow ? undefined : baseTo;
  const effectiveWindows = multiWindow ? windows : undefined;
  const search_queries = search.trim() ? [search.trim()] : undefined;

  const tx = useTransactions({
    account_id: accountId === "all" ? undefined : accountId,
    from: effectiveFrom,
    to: effectiveTo,
    windows: effectiveWindows,
    page,
    page_size: 50,
    search_queries,
    category: category === "all" ? undefined : category,
    kind: kind === "all" ? undefined : kind,
    status: status === "all" ? undefined : status,
    desc_norm: descNorm.length > 0 ? descNorm : undefined,
  });
  const categories = useCategories();
  const categorize = useCategorize();
  const txs = tx.data?.results ?? [];
  const total = tx.data?.total ?? 0;
  const totalPages = tx.data?.totalPages ?? 1;
  const summary = tx.data?.summary;
  const breakdown = tx.data?.breakdown ?? [];
  const breakdownTotal = breakdown.reduce((s, b) => s + b.total, 0);

  // chave (inglês, p/ filtro) -> rótulo pt-BR (catálogo; fallback formata o nome cru)
  const translatedByEn = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories.data?.results ?? []) {
      if (c.description) m.set(c.description, c.descriptionTranslated || prettifyCategory(c.description));
    }
    return m;
  }, [categories.data]);

  const categoryOptions = useMemo(() => {
    const keys = new Set<string>();
    for (const b of breakdown) keys.add(b.key);
    for (const t of txs) if (t.category) keys.add(t.category);
    for (const c of categories.data?.results ?? []) if (c.description) keys.add(c.description);
    return [...keys]
      .sort((a, b) => a.localeCompare(b))
      .map((en) => ({ value: en, label: translatedByEn.get(en) ?? prettifyCategory(en) }));
  }, [breakdown, txs, categories.data, translatedByEn]);

  const statusOptions = useMemo(
    () => [...new Set(txs.map((t) => t.status).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [txs],
  );

  const categoryOptionsFull = useMemo(() => {
    const cats = (categories.data?.results ?? []) as CategoryNode[];
    const groups: Record<string, CategoryNode[]> = {};
    for (const c of cats) {
      const key = c.parentDescription ?? "Outras";
      (groups[key] ??= []).push(c);
    }
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [categories.data]);

  function toggleCategory(key: string | null) {
    setCategory((cur) => (cur === key ? "all" : (key ?? "all")));
    setPage(1);
  }

  async function exportCsv() {
    setExportError(null);
    try {
      const res = await fetch("/api/bank/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountId === "all" ? undefined : accountId,
          from: effectiveFrom,
          to: effectiveTo,
          windows: effectiveWindows,
          search_queries,
          category: category === "all" ? undefined : category,
          kind: kind === "all" ? undefined : kind,
          status: status === "all" ? undefined : status,
          desc_norm: descNorm.length > 0 ? descNorm : undefined,
          page: 1,
          page_size: 5000,
        }),
      });
      if (!res.ok) {
        setExportError(`Erro ${res.status} ao exportar`);
        return;
      }
      const data = (await res.json()) as { results?: Array<Record<string, unknown>> };
      const all = data.results ?? [];
      const lines = all.map((t) =>
        [
          dateBR(String(t.date)),
          `"${String(t.description ?? "").replace(/"/g, '""')}"`,
          `"${String(t.category ?? "").replace(/"/g, '""')}"`,
          String(t.amount).replace(".", ","),
          KIND_LABEL[(t.kind as keyof typeof KIND_LABEL) ?? "spend"],
          String(t.status),
        ].join(";"),
      );
      const csv = "\uFEFF" + "data;descricao;categoria;valor;tipo;status\n" + lines.join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `transacoes-${accountId === "all" ? "todas" : accountId}-${String(baseFrom).slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    }
  }

  if (bundle.isError) return <ErrorState message={bundle.error.message} onRetry={() => bundle.refetch()} />;

  const selectCls =
    "rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-text focus:border-primary focus:outline-none";

  const chartKindLabel = kind === "all" ? "gastos" : KIND_LABEL[kind].toLowerCase() + "s";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transações"
        subtitle={`${total} transação(ões) no período com os filtros atuais`}
        action={
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={exportCsv}
              disabled={txs.length === 0}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-text hover:bg-surface2 disabled:opacity-40"
            >
              <Download size={13} /> Exportar CSV
            </button>
            {exportError && <p className="text-xs text-neg">{exportError}</p>}
          </div>
        }
      />

      {/* Filters */}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Conta
            <select
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value);
                setPage(1);
              }}
              className={selectCls}
            >
              <option value="all">TUDO (todas as contas)</option>
              {accounts.map((a) => (
                <option key={a.account_id} value={a.account_id}>
                  {a.name} ({a.type})
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted">
            Período
            <select
              value={range}
              onChange={(e) => {
                setRange(e.target.value as RangeKey);
                setPage(1);
              }}
              className={selectCls}
            >
              <option value="30">Últimos 30 dias</option>
              <option value="90">Últimos 90 dias</option>
              <option value="365">Últimos 365 dias</option>
              <option value="custom">Personalizado</option>
            </select>
          </label>

          {range === "custom" && !multiWindow && (
            <>
              <label className="flex flex-col gap-1 text-xs text-muted">
                De
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => {
                    setIsoOverride(null);
                    setCustomFrom(e.target.value);
                    setPage(1);
                  }}
                  className={selectCls}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                Até
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => {
                    setIsoOverride(null);
                    setCustomTo(e.target.value);
                    setPage(1);
                  }}
                  className={selectCls}
                />
              </label>
            </>
          )}

          <label className="flex flex-col gap-1 text-xs text-muted">
            Categoria
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(1);
              }}
              className={selectCls}
            >
              <option value="all">Todas</option>
              {categoryOptions.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted">
            Tipo
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as KindFilter);
                setPage(1);
              }}
              className={selectCls}
            >
              <option value="all">Gastos, entradas, transferências e aportes</option>
              <option value="spend">Só gastos</option>
              <option value="income">Só entradas</option>
              <option value="transfer">Só transferências</option>
              <option value="investment">Só aportes/resgates</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted">
            Status
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className={selectCls}
            >
              <option value="all">Todos</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {s === "POSTED" ? "Confirmada (POSTED)" : s === "PENDING" ? "Pendente (PENDING)" : s}
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-muted">
            Busca
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="ex.: mercado, salário…"
              className={selectCls}
            />
          </label>
          {descNorm.length > 0 && (
            <button
              onClick={() => setDescNorm([])}
              className="flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-primary hover:bg-primary/20"
              title="Remover filtro de recorrência"
            >
              Recorrência específica ativa — clique para limpar
            </button>
          )}
          {multiWindow && (
            <button
              onClick={() => {
                setWindows([]);
                setPage(1);
              }}
              className="flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-primary hover:bg-primary/20"
              title="Remover filtro de janelas comparadas"
            >
              {windows.length} janelas comparadas ativas — clique para limpar
            </button>
          )}
        </div>
      </Card>

      {/* Summary strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">Entradas (filtro atual)</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-pos">{brl(summary?.entradas ?? 0)}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">Saídas (filtro atual)</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-neg">{brl(summary?.saidas ?? 0)}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">Resultado (filtro atual)</p>
          <p
            className={`mt-1 text-lg font-bold tabular-nums ${(summary?.entradas ?? 0) - (summary?.saidas ?? 0) >= 0 ? "text-pos" : "text-neg"}`}
          >
            {brl((summary?.entradas ?? 0) - (summary?.saidas ?? 0))}
          </p>
        </div>
      </div>

      {/* Category chart */}
      {breakdown.length > 0 && (
        <Card title={`Por categoria — ${chartKindLabel} (filtros atuais) — clique na barra para filtrar`}>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={breakdown} layout="vertical" margin={{ top: 4, right: 120, left: 8, bottom: 0 }}>
                <CartesianGrid stroke="#1E2532" horizontal={false} />
                <XAxis
                  type="number"
                  stroke="#8B93A7"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `R$ ${v.toLocaleString("pt-BR")}`}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  stroke="#8B93A7"
                  fontSize={11}
                  width={170}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip itemStyle={{ color: "#E6E9F0" }} contentStyle={{ background: "#161B27", border: "1px solid #1E2532", borderRadius: 8, fontSize: 12 }}
                cursor={{ fill: "#161B27" }}
                formatter={(v) => {
                  const n = Number(v);
                  const pct =
                    breakdownTotal > 0 ? ((n / breakdownTotal) * 100).toFixed(1).replace(".", ",") : "0";
                  return [`${brl(n)} · ${pct}%`, "Total"];
                }} />
                <Bar
                  dataKey="total"
                  radius={[0, 4, 4, 0]}
                  barSize={16}
                  cursor="pointer"
                  onClick={(entry) => toggleCategory(barFieldFromClick(entry, "key"))}
                  label={{
                    position: "right",
                    fontSize: 10,
                    fill: "#8B93A7",
                    formatter: (v) => {
                      const n = Number(v);
                      const pct =
                        breakdownTotal > 0 ? ((n / breakdownTotal) * 100).toFixed(1).replace(".", ",") : "0";
                      return `${brl(n)} · ${pct}%`;
                    },
                  }}
                >
                  {breakdown.map((b, i) => (
                    <Cell
                      key={b.key}
                      fill={PIE_COLORS[i % PIE_COLORS.length]}
                      opacity={category === "all" || category === b.key ? 1 : 0.35}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Table */}
      {tx.isError ? (
        <ErrorState message={tx.error.message} onRetry={() => tx.refetch()} />
      ) : tx.isLoading ? (
        <Card>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="mb-3 h-8 w-full" />
          ))}
        </Card>
      ) : txs.length === 0 ? (
        <EmptyState title="Nenhuma transação no período" hint="Ajuste os filtros ou o período." />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-3 font-medium">Data</th>
                  <th className="py-2 pr-3 font-medium">Descrição</th>
                  <th className="py-2 pr-3 font-medium">Categoria</th>
                  <th className="py-2 pr-3 text-right font-medium">Valor</th>
                  <th className="py-2 pr-3 font-medium">Tipo</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {txs.map((t) => (
                  <tr key={t.id}>
                    <td className="whitespace-nowrap py-2 pr-3 text-muted">{dateBR(t.date)}</td>
                    <td className="max-w-64 truncate py-2 pr-3 text-text" title={t.description}>
                      {t.description}
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        value={String(t.categoryId ?? "")}
                        onChange={(e) => {
                          if (e.target.value) categorize.mutate([{ transaction_id: t.id, category_id: e.target.value }]);
                        }}
                        className="max-w-48 rounded-md border border-border bg-surface2 px-2 py-1 text-xs text-text focus:border-primary focus:outline-none"
                      >
                        {t.categoryId === undefined && <option value="">{t.category ?? "Sem categoria"}</option>}
                        {categoryOptionsFull.map(([group, cats]) => (
                          <optgroup key={group} label={group}>
                            {cats.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.descriptionTranslated}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      {categorize.isPending && <span className="ml-1 text-[10px] text-muted">salvando…</span>}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">
                      <AmountByKind value={t.abs_amount} kind={t.kind} />
                    </td>
                    <td className="py-2 pr-3">
                      <KindBadge kind={t.kind} />
                    </td>
                    <td className="py-2">
                      <Badge tone={t.status === "POSTED" ? "green" : "yellow"}>
                        {t.status === "POSTED" ? "Confirmada" : t.status === "PENDING" ? "Pendente" : t.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="mt-4 flex items-center justify-between text-xs text-muted">
            <span>
              Página {page} de {totalPages} · {total} transações filtradas
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-border bg-surface2 px-3 py-1.5 hover:bg-border disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-lg border border-border bg-surface2 px-3 py-1.5 hover:bg-border disabled:opacity-40"
              >
                Próxima
              </button>
            </div>
          </div>
          {categorize.isError && <p className="mt-2 text-xs text-neg">{categorize.error.message}</p>}
        </Card>
      )}
    </div>
  );
}
