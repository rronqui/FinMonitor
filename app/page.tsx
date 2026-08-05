"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, Pencil, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import {
  AmountByKind,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Stat,
  barFieldFromClick,
  billStatusBadge,
  connectionStatusBadge,
} from "@/src/components/ui";
import { brl, dateBR, parseAmount } from "@/src/lib/format";
import { prettifyCategory } from "@/src/lib/semantics";
import {
  useAccountsBundle,
  useBudgetsSpent,
  useCategories,
  useComparisons,
  useInvestments,
  useInsights,
  useProjection,
  useRecurrents,
  useSync,
  type CategoryDelta,
  type WindowComparison,
} from "@/src/lib/hooks";
import {
  BUDGETS_KEY,
  buildAvisos,
  buildBudgetRows,
  buildDestaques,
  buildFlowData,
  isCurrentMonth,
  loadBudgets,
} from "@/src/lib/overview";

const SERIES_COLORS = ["#6366F1", "#22C55E", "#EAB308", "#06B6D4"];

type FlowView = "contas" | "investimentos" | "tudo";
type Kind = "spend" | "income";
const KIND_OPTIONS = [
  { value: "spend", label: "Gastos" },
  { value: "income", label: "Entradas" },
] as const;

function KindSelector({ value, onChange }: { value: Kind; onChange: (value: Kind) => void }) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-border text-[10px]">
      {KIND_OPTIONS.map(({ value: option, label }) => (
        <button
          key={option}
          onClick={() => onChange(option)}
          className={`px-2.5 py-1 font-medium ${
            value === option ? "bg-primary/20 text-primary" : "text-muted hover:bg-surface2"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}



/** Gating de erro/loading para o conteúdo de um Card: skeleton → erro → children. */
function CardBody({
  q,
  h,
  children,
}: {
  q: { isLoading: boolean; isError: boolean; error: Error | null; refetch: () => unknown };
  h?: string;
  children: ReactNode;
}) {
  if (q.isLoading) return <Skeleton className={h ?? "h-40 w-full"} />;
  if (q.isError)
    return <ErrorState message={q.error?.message ?? "Erro ao carregar dados"} onRetry={() => q.refetch()} />;
  return <>{children}</>;
}

function DeltaPill({ pct, goodWhenUp }: { pct: number | null; goodWhenUp?: boolean }) {
  if (pct === null) return <span className="text-[10px] text-muted">—</span>;
  const bad = goodWhenUp ? pct < 0 : pct > 0;
  return (
    <span className={`tabular-nums ${bad ? "text-neg" : "text-pos"}`}>
      {pct > 0 ? "+" : ""}
      {pct.toFixed(1).replace(".", ",")}%
    </span>
  );
}

/**
 * Card padronizado de comparação: total + top categorias + seletor Gastos/Entradas.
 * Drill-downs explícitos: nome → duas janelas comparadas; valor anterior → janela
 * anterior; valor atual → janela atual.
 */
function ComparisonCard({
  title,
  window: w,
  kind: initialKind,
  curFrom,
  curTo,
  prevFrom,
  prevTo,
  footnote,
  headline,
}: {
  title: string;
  window: WindowComparison;
  kind: Kind;
  curFrom: string;
  curTo: string;
  prevFrom: string;
  prevTo: string;
  footnote: string;
  headline: (w: WindowComparison, kind: Kind) => { value: string; context: string; delta: number | null };
}) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>(initialKind);
  const h = headline(w, kind);
  const cats = kind === "spend" ? w.categories.spend : w.categories.income;

  const openTx = (wins: Array<{ from: string; to: string }>, category?: string) =>
    router.push(
      `/transacoes?range=custom&${wins
        .map((w) => `fromIso=${encodeURIComponent(w.from)}&toIso=${encodeURIComponent(w.to)}`)
        .join("&")}&kind=${kind}${category ? `&category=${encodeURIComponent(category)}` : ""}`,
    );
  // Janelas contíguas (prevTo === curFrom) viram 1 intervalo; com gap, emite
  // as 2 janelas separadas para o drill-down mostrar exatamente as células.
  const merged =
    prevTo === curFrom
      ? [{ from: prevFrom, to: curTo }]
      : [
          { from: prevFrom, to: prevTo },
          { from: curFrom, to: curTo },
        ];

  return (
    <Card
      title={title}
      action={<KindSelector value={kind} onChange={setKind} />}

    >
      <div className="space-y-3">
        <div>
          <p className={`text-2xl font-bold tabular-nums ${kind === "spend" ? "text-neg" : "text-pos"}`}>{h.value}</p>
          <p className="mt-1 text-xs text-muted">
            {h.context} · <DeltaPill pct={h.delta} goodWhenUp={kind === "income"} />
          </p>
        </div>
        {cats.length === 0 ? (
          <p className="text-[10px] text-muted">Sem {kind === "spend" ? "gastos" : "entradas"} no período.</p>
        ) : (
          <ul className="space-y-2">
            {cats.map((m: CategoryDelta) => (
              <li key={m.key} className="text-xs">
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => openTx(merged, m.key)}
                    className="min-w-0 truncate text-left text-text hover:opacity-80"
                    title="Ver transações das duas janelas comparadas"
                  >
                    {m.name}
                  </button>
                  <span className={`flex shrink-0 items-center gap-1 tabular-nums ${(m.delta > 0) !== (kind === "income") ? "text-neg" : "text-pos"}`}>
                    {m.delta > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    {m.delta > 0 ? "+" : ""}
                    {brl(m.delta)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted">
                  <button
                    onClick={() => openTx([{ from: prevFrom, to: prevTo }], m.key)}
                    className="tabular-nums hover:opacity-80 hover:text-text"
                    title="Ver transações da janela anterior"
                  >
                    {brl(m.previous)}
                  </button>
                  <span>→</span>
                  <button
                    onClick={() => openTx([{ from: curFrom, to: curTo }], m.key)}
                    className="tabular-nums hover:opacity-80 hover:text-text"
                    title="Ver transações da janela atual"
                  >
                    {brl(m.current)}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[10px] text-muted">{footnote}</p>
      </div>
    </Card>
  );
}

/** Card padronizado de recorrentes com seletor Gastos/Entradas, agrupado por categoria. */
function RecurrentsCard() {
  const router = useRouter();
  const recurrents = useRecurrents();
  const categories = useCategories();
  const [kind, setKind] = useState<Kind>("spend");
  const translatedByEn = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories.data?.results ?? []) {
      if (c.description) m.set(c.description, c.descriptionTranslated || prettifyCategory(c.description));
    }
    return m;
  }, [categories.data]);
  const labelOf = (key: string) => translatedByEn.get(key) ?? prettifyCategory(key);

  const all = recurrents.data?.recorrentes ?? [];
  const rows = all.filter((r) => (kind === "spend" ? r.kind === "spend" : r.kind !== "spend"));
  const total = rows.reduce((s, r) => s + r.monthly, 0);
  const byCat = new Map<
    string,
    { monthly: number; occurrences: number; lastDate: string; deltaPct: number | null; descNorms: string[] }
  >();
  for (const r of rows) {
    const cur = byCat.get(r.category) ?? { monthly: 0, occurrences: 0, lastDate: "", deltaPct: null, descNorms: [] };
    cur.monthly += r.monthly;
    cur.occurrences += r.occurrences;
    if (r.lastDate > cur.lastDate) {
      cur.lastDate = r.lastDate;
      cur.deltaPct = r.deltaPct;
    }
    cur.descNorms.push(r.descNorm);
    byCat.set(r.category, cur);
  }
  const cats = [...byCat.entries()]
    .map(([key, v]) => ({ key, category: key, ...v, label: labelOf(key) }))
    .sort((a, b) => b.monthly - a.monthly)
    .slice(0, 6);

  return (
    <Card
      title={kind === "spend" ? "Recorrentes — gastos" : "Recorrentes — entradas"}
      action={<KindSelector value={kind} onChange={setKind} />}
    >
      <CardBody q={recurrents} h="h-32 w-full">
      <div className="space-y-2">
        <p className="text-[10px] text-muted">
          {kind === "spend" ? "Custo fixo" : "Renda recorrente"} ≈{" "}
          <span className={`tabular-nums ${kind === "spend" ? "text-neg" : "text-pos"}`}>{brl(total)}/mês</span>
        </p>
        {cats.length === 0 ? (
          <EmptyState
            title={kind === "spend" ? "Nenhuma recorrência de gasto detectada" : "Nenhuma entrada recorrente detectada"}
          />
        ) : (
          <ul className="space-y-2">
            {cats.map((r) => (
              <li key={r.key} className="flex items-center justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <button
                    onClick={() => {
                      const from = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
                      const to = new Date().toISOString().slice(0, 10);
                      router.push(
                        `/transacoes?range=custom&from=${from}&to=${to}&kind=${kind}&category=${encodeURIComponent(r.category)}&${r.descNorms.map((d) => `desc=${encodeURIComponent(d)}`).join("&")}`,
                      );
                    }}
                    className="block w-full truncate text-left text-text hover:opacity-80"
                    title="Ver transações dos últimos 120 dias"
                  >
                    {r.label}
                  </button>
                  <p className="text-[10px] text-muted">
                    {r.occurrences}× · última {dateBR(r.lastDate)}
                    {r.deltaPct !== null && Math.abs(r.deltaPct) > 0.5 && (
                      <span className={(r.deltaPct > 0) !== (kind === "income") ? "text-neg" : "text-pos"}>
                        {" "}
                        {r.deltaPct > 0 ? "+" : ""}
                        {r.deltaPct.toFixed(0)}%
                      </span>
                    )}
                  </p>
                </div>
                <span className={`shrink-0 tabular-nums ${kind === "spend" ? "text-neg" : "text-pos"}`}>
                  {brl(r.monthly)}/mês
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      </CardBody>
    </Card>
  );
}

export default function OverviewPage() {
  const router = useRouter();
  const bundle = useAccountsBundle();
  const investments = useInvestments();
  const insights = useInsights();
  const categories = useCategories();
  const projection = useProjection(60);
  const recurrents = useRecurrents();
  const comparisons = useComparisons();
  const budgetsSpent = useBudgetsSpent();
  const sync = useSync();
  const [flowView, setFlowView] = useState<FlowView>("tudo");
  const [budgets, setBudgets] = useState<Record<string, number>>(() => loadBudgets());
  const [editingBudget, setEditingBudget] = useState<string | null>(null);

  const connections = bundle.data?.connections.connections ?? [];
  const accounts = bundle.data?.accounts.results ?? [];
  const detailAccounts = (bundle.data?.details.results ?? []).map((d) => d.account);

  const bankAccounts = accounts.filter((a) => a.type === "BANK");
  const creditAccounts = accounts.filter((a) => a.type === "CREDIT");

  // ---- KPIs
  const saldoConta = bankAccounts.reduce((s, a) => s + parseAmount(a.balance), 0);
  const faturaAtual = insights.data?.creditOpenTotal ?? 0;
  const investTotal = (investments.data?.results ?? []).reduce((s, i) => s + parseAmount(i.amountWithdrawal), 0);
  const limiteDisponivel = detailAccounts
    .filter((a) => a.creditData?.availableCreditLimit !== undefined)
    .reduce((s, a) => s + parseAmount(a.creditData!.availableCreditLimit), 0);

  const series = insights.data?.series ?? [];
  const investmentSeries = insights.data?.investmentSeries ?? [];
  const categoryData = insights.data?.categories ?? [];
  const latestTx = insights.data?.latest ?? [];
  const monthly = insights.data?.monthly ?? [];
  const openBill = insights.data?.openBill ?? null;
  const overdueBills = insights.data?.overdueBills ?? [];
  const nextBill = insights.data?.nextBill ?? null;
  const disputedCycle = insights.data?.disputedCycle ?? null;
  const comp = comparisons.data;

  const translatedByEn = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories.data?.results ?? []) {
      if (c.description) m.set(c.description, c.descriptionTranslated || prettifyCategory(c.description));
    }
    return m;
  }, [categories.data]);

  const labelOf = (key: string) => translatedByEn.get(key) ?? prettifyCategory(key);

  // ---- fluxo diário
  const flowData = buildFlowData(series, investmentSeries);
  const flowSeries = [
    ...series.map((s, i) => ({ key: s.accountId, name: s.name, color: SERIES_COLORS[i % SERIES_COLORS.length] })),
    { key: "investimentos", name: "Investimentos", color: "#A855F7" },
    { key: "total", name: "Patrimônio total", color: "#E6E9F0" },
  ];
  const visibleFlowSeries =
    flowView === "contas"
      ? flowSeries.filter((s) => s.key !== "investimentos" && s.key !== "total")
      : flowView === "investimentos"
        ? flowSeries.filter((s) => s.key === "investimentos")
        : flowSeries;
  const isDual = flowView === "tudo";
  const leftSeries = isDual
    ? visibleFlowSeries.filter((s) => s.key === "investimentos" || s.key === "total")
    : visibleFlowSeries;
  const rightSeries = isDual
    ? visibleFlowSeries.filter((s) => s.key !== "investimentos" && s.key !== "total")
    : [];

  // ---- projeção
  const projDays = projection.data?.days ?? [];
  const firstNegative = projDays.find((d) => d.saldo < 0);

  // ---- orçamentos
  const spentByCat = budgetsSpent.data?.categories ?? [];
  const budgetRows = useMemo(() => buildBudgetRows(spentByCat, budgets), [spentByCat, budgets]);

  function setBudget(key: string, value: number) {
    setBudgets((cur) => {
      const next = { ...cur, [key]: value };
      try {
        localStorage.setItem(BUDGETS_KEY, JSON.stringify(next));
      } catch {
        // ignora
      }
      return next;
    });
    setEditingBudget(null);
  }

  // ---- destaques (regras determinísticas, comparações honestas)
  const destaques = useMemo(
    () =>
      buildDestaques({
        comp,
        categoryData,
        recurrents: recurrents.data?.recorrentes,
        firstNegative,
        labelOf,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [comp, categoryData, recurrents.data, firstNegative, translatedByEn],
  );

  // ---- avisos
  const avisos = useMemo(
    () =>
      buildAvisos({
        nextBill,
        overdueBills,
        connections,
        disputedCycle,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nextBill, overdueBills, connections, disputedCycle],
  );

  function openCategory(key: string | null) {
    if (!key) return;
    const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    router.push(`/transacoes?range=custom&from=${from}&kind=spend&category=${encodeURIComponent(key)}`);
  }

  function openMonth(monthKey: string, kind: "spend" | "income") {
    const [y, m] = monthKey.split("-").map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const last = new Date(Date.UTC(y, m, 0));
    router.push(
      `/transacoes?range=custom&from=${first.toISOString().slice(0, 10)}&to=${last.toISOString().slice(0, 10)}&kind=${kind}`,
    );
  }

  if (bundle.isError) {
    return <ErrorState message={bundle.error.message} onRetry={() => bundle.refetch()} />;
  }
  if (bundle.isLoading) {
    return (
      <div>
        <PageHeader title="Visão Geral" subtitle="Suas finanças consolidadas" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-surface p-5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-3 h-8 w-32" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (connections.length === 0) {
    return (
      <div>
        <PageHeader title="Visão Geral" />
        <EmptyState
          title="Nenhuma conexão bancária"
          hint="Autorize um banco pelo Open Finance para começar."
          href={bundle.data?.connections.add_connection_url}
          linkLabel="Adicionar banco"
        />
      </div>
    );
  }

  const conn = connections[0];
  const statusInfo = connectionStatusBadge(conn.status);
  const incident = bundle.data?.accounts.provider_incident;
  const degraded =
    !!incident && typeof incident === "object" && "degraded" in incident && incident.degraded === true;

  // janelas para deep-link dos cards de comparação
  const now = new Date();
  const nowIso = now.toISOString();
  const monthStartIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const rollingFromIso = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const rollingPrevFromIso = new Date(now.getTime() - 60 * 86_400_000).toISOString();
  const prevMonthStartIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString();
  const prevSameWindowEndIso = new Date(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).getTime() +
      (comp?.elapsedDays ?? 0) * 86_400_000,
  ).toISOString();
  const prevMonthEndIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  return (
    <div className="space-y-6">
      <PageHeader title="Visão Geral" subtitle="Suas finanças consolidadas" />

      {degraded && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-2.5 text-xs text-yellow-400">
          Provedor com desempenho degradado — valores podem estar defasados
        </div>
      )}

      {avisos.length > 0 && (
        <div className="space-y-2">
          {avisos.map((a, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-xs ${
                a.tone === "red"
                  ? "border-neg/30 bg-neg/10 text-neg"
                  : "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
              }`}
            >
              <AlertTriangle size={13} /> {a.text}
            </div>
          ))}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Saldo em conta" value={brl(saldoConta)} hint={`${bankAccounts.length} conta(s) banco`} />
        <Stat
          label="Fatura atual dos cartões"
          value={brl(faturaAtual)}
          hint={`${creditAccounts.length} cartão(ões)`}
          tone={faturaAtual > 0 ? "neg" : "default"}
        />
        <Stat label="Investimentos" value={brl(investTotal)} hint="valor de resgate" />
        <Stat label="Limite disponível" value={brl(limiteDisponivel)} hint="cartões de crédito" />
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title="Fluxo diário (90 dias)"
          action={
            <div className="flex overflow-hidden rounded-lg border border-border text-[10px]">
              {(["contas", "investimentos", "tudo"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setFlowView(v)}
                  className={`px-2.5 py-1 font-medium ${
                    flowView === v ? "bg-primary/20 text-primary" : "text-muted hover:bg-surface2"
                  }`}
                >
                  {v === "tudo" ? "Tudo" : v === "contas" ? "Contas" : "Investimentos"}
                </button>
              ))}
            </div>
          }
        >
          <CardBody q={insights} h="h-64 w-full">
          {flowData.length === 0 ? (
            <EmptyState title="Sem transações no período" />
          ) : (
            <>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={flowData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <defs>
                      {leftSeries.map((s) => (
                        <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={s.color} stopOpacity={0.3} />
                          <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid stroke="#1E2532" vertical={false} />
                    <XAxis
                      dataKey="day"
                      tickFormatter={(d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`}
                      stroke="#8B93A7"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={30}
                    />
                    <YAxis
                      yAxisId="left"
                      stroke="#8B93A7"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: number) => `R$ ${(v / 1000).toFixed(0)}k`}
                      width={70}
                    />
                    {isDual && (
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        stroke="#6366F1"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) => `R$ ${(v / 1000).toFixed(1)}k`}
                        width={60}
                      />
                    )}
                    <Tooltip
                      itemStyle={{ color: "#E6E9F0" }}
                      contentStyle={{ background: "#161B27", border: "1px solid #1E2532", borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: "#8B93A7" }}
                      formatter={(v, name) => [
                        brl(Number(v)),
                        visibleFlowSeries.find((s) => s.key === name)?.name ?? String(name),
                      ]}
                    />
                    {leftSeries.map((s) => (
                      <Area
                        key={s.key}
                        yAxisId="left"
                        type="monotone"
                        dataKey={s.key}
                        name={s.key}
                        stroke={s.color}
                        strokeWidth={s.key === "total" ? 2.5 : 2}
                        fill={`url(#grad-${s.key})`}
                      />
                    ))}
                    {rightSeries.map((s) => (
                      <Line
                        key={s.key}
                        yAxisId="right"
                        type="monotone"
                        dataKey={s.key}
                        name={s.key}
                        stroke={s.color}
                        strokeWidth={2}
                        dot={false}
                      />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted">
                {visibleFlowSeries.map((s) => (
                  <span key={s.key} className="flex items-center gap-1">
                    <span
                      className={s.key !== "investimentos" && s.key !== "total" && isDual ? "h-0.5 w-3" : "h-2 w-2 rounded-sm"}
                      style={{ background: s.color }}
                    />{" "}
                    {s.name}
                    {s.key !== "investimentos" && s.key !== "total" && isDual ? " (eixo dir.)" : ""}
                  </span>
                ))}
              </div>
            </>
          )}
          </CardBody>
        </Card>

        <Card title="Gastos por categoria (30 dias, todas as contas) — clique para ver as transações">
          <CardBody q={insights} h="h-64 w-full">
          {categoryData.length === 0 ? (
            <EmptyState title="Sem gastos no período" />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
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
                    width={150}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    itemStyle={{ color: "#E6E9F0" }}
                    contentStyle={{ background: "#161B27", border: "1px solid #1E2532", borderRadius: 8, fontSize: 12 }}
                    formatter={(v) => [brl(Number(v)), "Gasto"]}
                    cursor={{ fill: "#161B27" }}
                  />
                  <Bar
                    dataKey="valor"
                    radius={[0, 4, 4, 0]}
                    barSize={16}
                    cursor="pointer"
                    onClick={(entry) => openCategory(barFieldFromClick(entry, "key"))}
                  >
                    {categoryData.map((c, i) => (
                      <Cell key={c.key} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          </CardBody>
        </Card>
      </div>

      {/* Projeção + comparativo mensal */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Projeção de caixa (60 dias) — estimativa">
          <CardBody q={projection} h="h-56 w-full">
          {projDays.length === 0 ? (
            <EmptyState title="Sem dados suficientes para projetar" />
          ) : (
            <>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={projDays} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="projGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#06B6D4" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#06B6D4" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#1E2532" vertical={false} />
                    <XAxis
                      dataKey="day"
                      tickFormatter={(d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`}
                      stroke="#8B93A7"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={30}
                    />
                    <YAxis
                      stroke="#8B93A7"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: number) => `R$ ${(v / 1000).toFixed(1)}k`}
                      width={70}
                    />
                    <Tooltip
                      itemStyle={{ color: "#E6E9F0" }}
                      contentStyle={{ background: "#161B27", border: "1px solid #1E2532", borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: "#8B93A7" }}
                      formatter={(v) => [brl(Number(v)), "Saldo projetado (estimativa)"]}
                    />
                    <Area type="monotone" dataKey="saldo" stroke="#06B6D4" strokeWidth={2} fill="url(#projGrad)" />
                    {firstNegative && <ReferenceDot x={firstNegative.day} y={0} r={4} fill="#EF4444" stroke="#0B0E14" />}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-[10px] text-muted">
                {firstNegative
                  ? `Atenção: saldo projetado fica negativo em ${dateBR(firstNegative.day)}. `
                  : "Saldo projetado permanece positivo no horizonte de 60 dias. "}
                Estimativa com recorrências e pagamentos únicos conhecidos — não é uma fatura futura.
              </p>
            </>
          )}
          </CardBody>
        </Card>

        {monthly.length > 0 && (
          <Card title="Comparativo mensal — clique numa barra para ver as transações">
            <CardBody q={insights} h="h-56 w-full">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthly} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke="#1E2532" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tickFormatter={(m: string) => `${m.slice(5, 7)}/${m.slice(2, 4)}`}
                    stroke="#8B93A7"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    yAxisId="left"
                    stroke="#8B93A7"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => `R$ ${(v / 1000).toFixed(0)}k`}
                    width={60}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    stroke="#F59E0B"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => `R$ ${(v / 1000).toFixed(0)}k`}
                    width={60}
                  />
                  <Tooltip
                    itemStyle={{ color: "#E6E9F0" }}
                    contentStyle={{ background: "#161B27", border: "1px solid #1E2532", borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: "#8B93A7" }}
                    formatter={(v, name) => [
                      brl(Number(v)),
                      name === "spend" ? "Gastos" : name === "income" ? "Entradas" : "Gastos (tendência)",
                    ]}
                    cursor={{ fill: "#161B27" }}
                  />
                  <Bar
                    yAxisId="left"
                    dataKey="spend"
                    name="spend"
                    fill="#EF4444"
                    radius={[4, 4, 0, 0]}
                    barSize={18}
                    cursor="pointer"
                    onClick={(entry) => {
                      const m = (entry as { payload?: { month?: string } })?.payload?.month;
                      if (m) openMonth(m, "spend");
                    }}
                  >
                    {monthly.map((m) => (
                      <Cell key={m.month} fillOpacity={isCurrentMonth(m.month) ? 0.35 : 1} />
                    ))}
                  </Bar>
                  <Bar
                    yAxisId="left"
                    dataKey="income"
                    name="income"
                    fill="#22C55E"
                    radius={[4, 4, 0, 0]}
                    barSize={18}
                    cursor="pointer"
                    onClick={(entry) => {
                      const m = (entry as { payload?: { month?: string } })?.payload?.month;
                      if (m) openMonth(m, "income");
                    }}
                  >
                    {monthly.map((m) => (
                      <Cell key={m.month} fillOpacity={isCurrentMonth(m.month) ? 0.35 : 1} />
                    ))}
                  </Bar>
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="spend"
                    name="spendLine"
                    stroke="#F59E0B"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "#F59E0B", strokeWidth: 0 }}
                    activeDot={{ r: 4 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-[10px] text-muted">
              Barra esmaecida = mês em curso (parcial). Comparações justas nos cards abaixo.
            </p>
            </CardBody>
          </Card>
        )}
      </div>

      {/* Comparação de períodos: anatomia unificada */}
      {comparisons.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : comparisons.isError ? (
        <ErrorState message={comparisons.error?.message ?? "Erro ao carregar comparações"} onRetry={() => comparisons.refetch()} />
      ) : comp ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <ComparisonCard
            title={`Mesma janela (${comp.elapsedDays}d)`}
            window={comp.sameWindow}
            kind="spend"
            curFrom={monthStartIso}
            curTo={nowIso}
            prevFrom={prevMonthStartIso}
            prevTo={prevSameWindowEndIso}
            footnote={`Comparação justa: só os primeiros ${comp.elapsedDays} dias de cada mês. Clique no nome (duas janelas) ou nos valores (janela específica).`}
            headline={(w, kind) =>
              kind === "spend"
                ? {
                    value: brl(w.current.spend),
                    context: `em gastos, vs ${brl(w.previous.spend)} nos mesmos ${comp.elapsedDays} dias do mês anterior`,
                    delta: w.deltaSpendPct,
                  }
                : {
                    value: brl(w.current.income),
                    context: `em entradas, vs ${brl(w.previous.income)} nos mesmos ${comp.elapsedDays} dias do mês anterior`,
                    delta: w.deltaIncomePct,
                  }
            }
          />
          <ComparisonCard
            title="30 dias móveis"
            window={comp.rolling}
            kind="spend"
            curFrom={rollingFromIso}
            curTo={nowIso}
            prevFrom={rollingPrevFromIso}
            prevTo={rollingFromIso}
            footnote="Janelas sempre completas — sem efeito de virada de mês. Clique no nome (duas janelas) ou nos valores (janela específica)."
            headline={(w, kind) =>
              kind === "spend"
                ? {
                    value: brl(w.current.spend),
                    context: `em gastos; últimos 30 dias vs ${brl(w.previous.spend)} nos 30 anteriores`,
                    delta: w.deltaSpendPct,
                  }
                : {
                    value: brl(w.current.income),
                    context: `em entradas; últimos 30 dias vs ${brl(w.previous.income)} nos 30 anteriores`,
                    delta: w.deltaIncomePct,
                  }
            }
          />
          <ComparisonCard
            title="Mês atual (R$/dia)"
            window={{
              current: { spend: comp.calendar.current.spend, income: comp.calendar.current.income },
              previous: { spend: comp.calendar.previous.spend, income: comp.calendar.previous.income },
              deltaSpend: 0,
              deltaSpendPct: comp.calendar.deltaSpendPerDayPct,
              deltaIncome: 0,
              deltaIncomePct: comp.calendar.deltaIncomePerDayPct,
              categories: comp.calendar.categories,
            }}
            kind="spend"
            curFrom={monthStartIso}
            curTo={nowIso}
            prevFrom={prevMonthStartIso}
            prevTo={prevMonthEndIso}
            footnote={`Mês atual: ${comp.calendar.current.days} dia(s) vs mês anterior completo (${comp.calendar.previous.days} dias), normalizado por média diária. Clique no nome (duas janelas) ou nos valores (janela específica).`}
            headline={(w, kind) =>
              kind === "spend"
                ? {
                    value: `${brl(comp.calendar.current.spendPerDay)}/dia`,
                    context: `em gastos, vs ${brl(comp.calendar.previous.spendPerDay)}/dia no mês anterior`,
                    delta: comp.calendar.deltaSpendPerDayPct,
                  }
                : {
                    value: `${brl(comp.calendar.current.incomePerDay)}/dia`,
                    context: `em entradas, vs ${brl(comp.calendar.previous.incomePerDay)}/dia no mês anterior`,
                    delta: comp.calendar.deltaIncomePerDayPct,
                  }
            }
          />
        </div>
      ) : null}

      {/* Insights row: destaques + recorrentes + orçamentos */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Destaques">
          {destaques.length === 0 ? (
            <EmptyState title="Sem destaques no momento" />
          ) : (
            <ul className="space-y-2">
              {destaques.map((d, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-text">
                  {d.icon === "up" ? (
                    <TrendingUp size={13} className="mt-0.5 shrink-0 text-neg" />
                  ) : d.icon === "down" ? (
                    <TrendingDown size={13} className="mt-0.5 shrink-0 text-pos" />
                  ) : (
                    <AlertTriangle size={13} className="mt-0.5 shrink-0 text-yellow-400" />
                  )}
                  {d.text}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <RecurrentsCard />

        <Card title="Orçamentos por categoria (mês atual)">
          <CardBody q={budgetsSpent} h="h-24 w-full">
          {budgetRows.length === 0 ? (
            <EmptyState title="Sem gastos no mês atual" hint="Defina limites clicando no lápis quando houver gastos." />
          ) : (
            <div className="space-y-3">
              {budgetRows.map((r) => {
                const limit = r.limit ?? 0;
                const pct = limit > 0 ? Math.min(100, (r.spent / limit) * 100) : null;
                const over = limit > 0 && r.spent > limit;
                const warn = limit > 0 && !over && r.spent > limit * 0.8;
                return (
                  <div key={r.key}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs font-medium text-text">{labelOf(r.key)}</p>
                      {editingBudget === r.key ? (
                        <input
                          autoFocus
                          type="number"
                          min={0}
                          step={50}
                          defaultValue={limit || ""}
                          placeholder="limite R$"
                          onBlur={(e) => setBudget(r.key, Number(e.target.value) || 0)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") setBudget(r.key, Number((e.target as HTMLInputElement).value) || 0);
                          }}
                          className="w-24 rounded border border-border bg-surface px-2 py-0.5 text-right text-xs text-text focus:border-primary focus:outline-none"
                        />
                      ) : (
                        <button
                          onClick={() => setEditingBudget(r.key)}
                          className="flex items-center gap-1 text-[10px] text-muted hover:text-text"
                        >
                          <Pencil size={10} /> {limit > 0 ? brl(limit) : "definir limite"}
                        </button>
                      )}
                    </div>
                    <p className="mt-1 text-sm font-semibold tabular-nums text-text">{brl(r.spent)}</p>
                    {pct !== null && (
                      <>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface">
                          <div
                            className={`h-full rounded-full ${over ? "bg-neg" : warn ? "bg-yellow-500" : "bg-pos"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <p className={`mt-1 text-[10px] ${over ? "text-neg" : warn ? "text-yellow-400" : "text-muted"}`}>
                          {pct.toFixed(0)}% do limite{over ? ` · excedeu ${brl(r.spent - limit)}` : ""}
                        </p>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          </CardBody>
        </Card>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Últimas transações">
          <CardBody q={insights} h="h-32 w-full">
          {latestTx.length === 0 ? (
            <EmptyState title="Sem transações" />
          ) : (
            <ul className="divide-y divide-border">
              {latestTx.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate text-text">{t.description}</p>
                    <p className="text-xs text-muted">
                      {dateBR(t.date)}{t.category ? ` · ${labelOf(t.category)}` : ""}
                    </p>
                  </div>
                  <AmountByKind value={t.abs_amount} kind={t.kind} />
                </li>
              ))}
            </ul>
          )}
          </CardBody>
        </Card>

        <Card title="Fatura atual">
          {disputedCycle ? (
            <div className="space-y-3">
              <p className="text-3xl font-bold tabular-nums text-neg">{brl(Math.max(0, parseAmount(disputedCycle.balance) - disputedCycle.paymentAmount))}</p>
              <p className="text-sm text-muted">{disputedCycle.accountName}</p>
              <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400">
                Exclui {brl(disputedCycle.paymentAmount)} pagos em {dateBR(disputedCycle.paymentDate)}; o banco ainda não baixou a fatura.
              </div>
            </div>
          ) : !openBill ? (
            <EmptyState title="Sem faturas em aberto" hint="Nenhum cartão com saldo no ciclo atual." />
          ) : (
            <div className="space-y-3">
              <p className="text-3xl font-bold tabular-nums text-neg">{brl(openBill.balance)}</p>
              <p className="text-sm text-muted">
                {openBill.accountName}
                {openBill.dueDate ? ` · vencimento ${dateBR(openBill.dueDate)}` : ""}
              </p>
              {openBill.minimumPayment !== undefined && (
                <p className="text-xs text-muted">Pagamento mínimo: {brl(openBill.minimumPayment)}</p>
              )}
              {overdueBills.length > 0 && (
                <div className="space-y-1 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400">
                  {overdueBills.map((b) => (
                    <p key={b.id}>
                      Fatura de {dateBR(b.dueDate)} ({brl(b.totalAmount)}) —{" "}
                      {billStatusBadge(b.payment_status).label.toLowerCase()}.
                    </p>
                  ))}
                </div>
              )}
              {nextBill && (
                <p className="text-xs text-muted">
                  Próxima fatura fechada: {brl(nextBill.totalAmount)} em {dateBR(nextBill.dueDate)}.
                </p>
              )}
            </div>
          )}
        </Card>

        <Card title="Saúde da conexão">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-text">{conn.connector_name}</p>
                <p className="text-xs text-muted">item {conn.item_id.slice(0, 8)}…</p>
              </div>
              <Badge tone={statusInfo.tone}>{statusInfo.label}</Badge>
            </div>
            <button
              onClick={() => sync.mutate()}
              disabled={sync.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              <RefreshCw size={13} className={sync.isPending ? "animate-spin" : ""} />
              {sync.isPending ? "Sincronizando…" : "Sincronizar agora"}
            </button>
            {sync.isError && <p className="text-xs text-neg">{sync.error.message}</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
