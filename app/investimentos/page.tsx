"use client";

import { Fragment, useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { Investment } from "@/src/banco-mcp";
import {
  AmountByKind,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Stat,
} from "@/src/components/ui";
import { brl, dateBR, parseAmount } from "@/src/lib/format";
import { useBenchmarks, useInvestmentMovements, useInvestments } from "@/src/lib/hooks";

const PIE_COLORS = ["#6366F1", "#22C55E", "#EAB308", "#EF4444", "#06B6D4", "#A855F7", "#F97316", "#84CC16"];
const MS_YEAR = 365.25 * 86_400_000;

function rateLabel(inv: Investment): string {
  if (inv.rate === undefined && !inv.rateType) return "—";
  const rate = inv.rate !== undefined ? `${inv.rate}%` : "";
  return [rate, inv.rateType].filter(Boolean).join(" ");
}

function netProfit(inv: Investment): number {
  return parseAmount(inv.amountWithdrawal) - parseAmount(inv.amountOriginal) - parseAmount(inv.taxes);
}

function annualizedYield(inv: Investment): number | null {
  const invested = parseAmount(inv.amountOriginal);
  if (invested <= 0) return null;
  const start = inv.purchaseDate ?? inv.issueDate;
  if (!start) return null;
  const years = (Date.now() - new Date(start).getTime()) / MS_YEAR;
  if (years <= 0.01) return null;
  const total = netProfit(inv) / invested;
  return ((1 + total) ** (1 / years) - 1) * 100;
}

function MovementRows({ investmentId }: { investmentId: string }) {
  const mov = useInvestmentMovements(investmentId, true);
  if (mov.isLoading)
    return (
      <tr>
        <td colSpan={9} className="py-2 text-xs text-muted">
          Carregando movimentações…
        </td>
      </tr>
    );
  if (mov.isError)
    return (
      <tr>
        <td colSpan={9} className="py-2 text-xs text-neg">
          {mov.error.message}
        </td>
      </tr>
    );
  const rows = mov.data?.results ?? [];
  if (rows.length === 0)
    return (
      <tr>
        <td colSpan={9} className="py-2 text-xs text-muted">
          Sem movimentações registradas.
        </td>
      </tr>
    );
  return (
    <>
      {rows.map((m) => (
        <tr key={m.id} className="bg-surface2/40">
          <td className="whitespace-nowrap py-1.5 pr-3 text-xs text-muted">{dateBR(m.date)}</td>
          <td className="py-1.5 pr-3 text-xs text-muted" colSpan={3}>
            {m.type === "BUY" ? "Aplicação" : m.type === "SELL" ? "Resgate" : m.type}
          </td>
          <td className="py-1.5 pr-3 text-right">
            <AmountByKind value={m.net_amount} kind={m.type === "BUY" ? "spend" : "income"} />
          </td>
          <td colSpan={4} />
        </tr>
      ))}
    </>
  );
}

export default function InvestmentsPage() {
  const investments = useInvestments();
  const benchmarks = useBenchmarks();
  const [typeFilter, setTypeFilter] = useState("all");
  const [showClosed, setShowClosed] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const rawPositions = investments.data?.results ?? [];
  const allPositions = rawPositions.filter((i) => showClosed || (i.status ?? "ACTIVE") !== "TOTAL_WITHDRAWAL");
  const closedCount = rawPositions.filter((i) => i.status === "TOTAL_WITHDRAWAL").length;
  const positions = typeFilter === "all" ? allPositions : allPositions.filter((i) => i.type === typeFilter);
  const typeOptions = [...new Set(allPositions.map((i) => i.type).filter(Boolean))].sort();

  const agenda = useMemo(
    () =>
      allPositions
        .filter((i) => i.dueDate)
        .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
        .slice(0, 6),
    [allPositions],
  );

  if (investments.isError) {
    return <ErrorState message={investments.error.message} onRetry={() => investments.refetch()} />;
  }
  if (investments.isLoading) {
    return (
      <div>
        <PageHeader title="Investimentos" subtitle="Posições consolidadas" />
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

  if (rawPositions.length === 0) {
    return (
      <div>
        <PageHeader title="Investimentos" subtitle="Posições consolidadas" />
        <EmptyState title="Nenhum investimento encontrado" />
      </div>
    );
  }
  if (positions.length === 0) {
    return (
      <div>
        <PageHeader title="Investimentos" subtitle="Posições consolidadas" />
        <EmptyState title="Nenhuma posição com esse filtro" hint="Ajuste o tipo ou exiba encerradas." />
      </div>
    );
  }

  const totalInvestido = positions.reduce((s, i) => s + parseAmount(i.amountOriginal), 0);
  const valorAtual = positions.reduce((s, i) => s + parseAmount(i.amountWithdrawal), 0);
  const impostos = positions.reduce((s, i) => s + parseAmount(i.taxes), 0);
  const rentabilidade = valorAtual - totalInvestido - impostos;
  // Anualizado líquido: início = data mais antiga das posições (mesma fórmula
  // de annualizedYield). Sem data em nenhuma posição → null (JSX renderiza "—").
  const starts = positions
    .map((i) => i.purchaseDate ?? i.issueDate)
    .filter((d): d is string => !!d)
    .map((d) => new Date(d).getTime())
    .filter(Number.isFinite);
  const years = starts.length > 0 ? (Date.now() - Math.min(...starts)) / MS_YEAR : null;
  const carteiraAay =
    totalInvestido > 0 && years !== null && years > 0.01
      ? ((1 + rentabilidade / totalInvestido) ** (1 / years) - 1) * 100
      : null;

  const byType: Record<string, number> = {};
  for (const inv of positions) {
    const key = inv.type || "OUTROS";
    byType[key] = (byType[key] ?? 0) + parseAmount(inv.amountWithdrawal);
  }
  const donutData = Object.entries(byType)
    .map(([name, valor]) => ({ name, valor: Math.round(valor * 100) / 100 }))
    .sort((a, b) => b.valor - a.valor);

  const b = benchmarks.data;
  const benchRows: Array<{ label: string; value: number | null; color: string }> = [
    { label: "Sua carteira (a.a. realizado)", value: carteiraAay, color: "#A855F7" },
    { label: "CDI", value: b?.cdiAnnualPct ?? null, color: "#6366F1" },
    { label: "IPCA", value: b?.ipcaAnnualPct ?? null, color: "#F59E0B" },
  ];
  const benchMax = Math.max(...benchRows.map((r) => Math.abs(r.value ?? 0)), 1);

  return (
    <div className="space-y-6">
      <PageHeader title="Investimentos" subtitle={`${positions.length} posição(ões) ativas`} />

      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-surface p-4">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Tipo
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
          >
            <option value="all">Todos os tipos</option>
            {typeOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={showClosed}
            onChange={(e) => setShowClosed(e.target.checked)}
            className="h-3.5 w-3.5 accent-[#6366F1]"
          />
          Exibir posições encerradas{closedCount > 0 ? ` (${closedCount})` : ""}
        </label>
        <p className="pb-2 text-[10px] text-muted">Clique numa posição para ver as movimentações (aplicações e resgates).</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Total investido" value={brl(totalInvestido)} />
        <Stat label="Valor atual" value={brl(valorAtual)} hint="valor de resgate" />
        <Stat
          label="Rentabilidade"
          value={brl(rentabilidade)}
          tone={rentabilidade >= 0 ? "pos" : "neg"}
          hint={totalInvestido > 0 ? `${((rentabilidade / totalInvestido) * 100).toFixed(2).replace(".", ",")}% líquido de impostos` : undefined}
        />
        <Stat label="Impostos provisionados" value={brl(impostos)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Distribuição por tipo">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={donutData} dataKey="valor" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {donutData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="#11151F" />
                  ))}
                </Pie>
                <Tooltip
                  itemStyle={{ color: "#E6E9F0" }}
                  contentStyle={{ background: "#161B27", border: "1px solid #1E2532", borderRadius: 8, fontSize: 12 }}
                  formatter={(v) => [brl(Number(v)), "Valor de resgate"]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 flex flex-wrap gap-2">
            {donutData.map((d, i) => (
              <li key={d.name} className="flex items-center gap-1.5 text-xs text-muted">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                {d.name}
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Agenda de vencimentos" action={<span className="text-[10px] text-muted">próximas 6 posições</span>}>
          {agenda.length === 0 ? (
            <EmptyState title="Sem vencimentos informados" />
          ) : (
            <ul className="space-y-2">
              {agenda.map((i) => {
                const due = new Date(i.dueDate as string);
                const monthsLeft = Math.max(0, Math.round((due.getTime() - Date.now()) / (30.44 * 86_400_000)));
                return (
                  <li key={i.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface2/50 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs text-text">{i.name}</p>
                      <p className="text-[10px] text-muted">
                        vence {dateBR(i.dueDate as string)} · em ~{monthsLeft} meses
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold tabular-nums text-text">{brl(i.amountWithdrawal)}</p>
                      <p className="text-[10px] text-muted">{rateLabel(i)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Rentabilidade vs benchmarks" action={<span className="text-[10px] text-muted">12m, anualizado</span>}>
          {benchmarks.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : benchmarks.isError ? (
            <ErrorState message={benchmarks.error?.message ?? "Erro ao carregar benchmarks"} onRetry={() => benchmarks.refetch()} />
          ) : !b ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <ul className="space-y-3">
              {benchRows.map((r) => (
                <li key={r.label}>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted">{r.label}</span>
                    <span className="tabular-nums text-text">
                      {r.value === null ? "—" : `${r.value.toFixed(2).replace(".", ",")}%`}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.min(100, (Math.abs(r.value ?? 0) / benchMax) * 100)}%`, background: r.color }}
                    />
                  </div>
                </li>
              ))}
              {b.cdiAnnualPct !== null && b.ipcaAnnualPct !== null && carteiraAay !== null && (
                <li className="text-[10px] text-muted">
                  Ganho real ≈ {(carteiraAay - b.ipcaAnnualPct).toFixed(2).replace(".", ",")}% a.a. acima da inflação. Fonte:{" "}
                  {b.source}.
                </li>
              )}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Posições">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-3 font-medium">Nome</th>
                <th className="py-2 pr-3 font-medium">Tipo</th>
                <th className="py-2 pr-3 font-medium">Taxa</th>
                <th className="py-2 pr-3 font-medium">Vencimento</th>
                <th className="py-2 pr-3 text-right font-medium">Aplicado</th>
                <th className="py-2 pr-3 text-right font-medium">Resgate</th>
                <th className="py-2 pr-3 text-right font-medium">Lucro líquido</th>
                <th className="py-2 pr-3 text-right font-medium">a.a. realizado</th>
                <th className="py-2 font-medium">Impostos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {positions.map((inv) => {
                const profit = netProfit(inv);
                const aay = annualizedYield(inv);
                const open = expanded === inv.id;
                const closed = inv.status === "TOTAL_WITHDRAWAL";
                return (
                  <Fragment key={inv.id}>
                    <tr
                      className={`cursor-pointer hover:bg-surface2/50 ${closed ? "opacity-60" : ""}`}
                      onClick={() => setExpanded(open ? null : inv.id)}
                    >
                      <td className="max-w-52 truncate py-2 pr-3 text-text" title={inv.name}>
                        <span className="mr-1 inline-block align-middle text-muted">
                          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </span>
                        {inv.name}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge tone={inv.type === "FIXED_INCOME" ? "green" : "gray"}>
                          {inv.subtype ? `${inv.type} · ${inv.subtype}` : inv.type}
                        </Badge>
                        {closed && (
                          <Badge tone="gray">
                            <span className="ml-1">Encerrada</span>
                          </Badge>
                        )}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-muted">{rateLabel(inv)}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-muted">{inv.dueDate ? dateBR(inv.dueDate) : "—"}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums text-muted">
                        {brl(inv.amountOriginal)}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums text-text">
                        {brl(inv.amountWithdrawal)}
                      </td>
                      <td className={`whitespace-nowrap py-2 pr-3 text-right tabular-nums ${profit >= 0 ? "text-pos" : "text-neg"}`}>
                        {brl(profit)}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums text-muted">
                        {aay === null ? "—" : `${aay.toFixed(2).replace(".", ",")}%`}
                      </td>
                      <td className="whitespace-nowrap py-2 text-right tabular-nums text-muted">{brl(inv.taxes)}</td>
                    </tr>
                    {open && <MovementRows investmentId={inv.id} />}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
