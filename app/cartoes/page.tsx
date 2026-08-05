"use client";

import { useState } from "react";
import type { Account } from "@/src/banco-mcp";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  billStatusBadge,
} from "@/src/components/ui";
import { brl, dateBR, parseAmount } from "@/src/lib/format";
import { useAccountsBundle, useBills, useBillsComparison } from "@/src/lib/hooks";

export type DueRange = "all" | "90" | "365" | "future";

const STATUS_FILTERS = ["PAID", "OPEN", "PAST_DUE_UNPAID", "PAST_DUE_UNCONFIRMED"];

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const selectCls =
  "rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-text focus:border-primary focus:outline-none";

function BillsComparisonCard({ accountId }: { accountId: string }) {
  const comparison = useBillsComparison(accountId);
  const c = comparison.data;
  return (
    <Card
      title="Fatura fechada vs anterior"
      action={<span className="text-[10px] text-muted">comparação 100% completa</span>}
    >
      {comparison.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : comparison.isError ? (
        <ErrorState message={comparison.error?.message ?? "Erro ao carregar comparação"} onRetry={() => comparison.refetch()} />
      ) : !c || !c.current || !c.previous ? (
        <EmptyState title="Menos de duas faturas pagas" />
      ) : (
        <div className="space-y-2">
          <div className="flex items-baseline gap-3">
            <p className="text-2xl font-bold tabular-nums text-text">{brl(c.current.total)}</p>
            <p className="text-xs text-muted">
              venc. {dateBR(c.current.dueDate)} vs {brl(c.previous.total)} em {dateBR(c.previous.dueDate)} ·{" "}
              <span className={`tabular-nums ${(c.delta ?? 0) > 0 ? "text-neg" : "text-pos"}`}>
                {(c.deltaPct ?? 0) > 0 ? "+" : ""}
                {(c.deltaPct ?? 0).toFixed(1).replace(".", ",")}%
              </span>
            </p>
          </div>
          <p className="text-[10px] text-muted">
            Faturas fechadas (pagas) são a única comparação completa para cartão — o ciclo atual ainda está aberto.
          </p>
        </div>
      )}
    </Card>
  );
}

function CreditCardPanel({
  account,
  dueRange,
  statusFilter,
}: {
  account: Account;
  dueRange: DueRange;
  statusFilter: string;
}) {
  const bills = useBills(account.account_id);
  const credit = account.creditData ?? {};
  const limit = parseAmount(credit.creditLimit);
  const available = parseAmount(credit.availableCreditLimit);
  const used = Math.max(0, limit - available);
  const usedPct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;

  const disputed = bills.data?.disputed ?? {};
  const bal = parseAmount(account.balance);
  const disputedBill = (bills.data?.results ?? [])
    .filter((b) => disputed[b.id] && parseAmount(b.totalAmount) <= bal)
    .sort((a, b) => parseAmount(b.totalAmount) - parseAmount(a.totalAmount))[0];
  const dispute = disputedBill ? disputed[disputedBill.id] : undefined;
  const embedded = disputedBill ? parseAmount(disputedBill.totalAmount) : 0;
  const adjusted = Math.max(0, bal - embedded);

  const rows = (bills.data?.results ?? []).filter((b) => {
    if (statusFilter !== "all" && (b.payment_status ?? "") !== statusFilter) return false;
    const due = b.dueDate?.slice(0, 10) ?? "";
    if (dueRange !== "all" && !due) return false;
    if (dueRange === "90" && due < daysAgoISO(90)) return false;
    if (dueRange === "365" && due < daysAgoISO(365)) return false;
    if (dueRange === "future" && due < daysAgoISO(0)) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-text">{account.name}</p>
            <p className="mt-0.5 text-xs text-muted">
              {[credit.brand, credit.level].filter(Boolean).join(" · ") || "Cartão de crédito"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted">Fatura atual</p>
            {dispute ? (
              <>
                <p className="text-2xl font-bold tabular-nums text-neg">{brl(adjusted)}</p>
                <p className="mt-1 max-w-56 text-[10px] leading-tight text-yellow-400">
                  Exclui {brl(embedded)} pagos em {dateBR(dispute.paymentDate)} (banco ainda não baixou).
                </p>
              </>
            ) : (
              <p className="text-2xl font-bold tabular-nums text-neg">{brl(account.balance)}</p>
            )}
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-muted">
            <span>
              Limite usado {brl(used)} de {brl(limit)}
            </span>
            <span>{Math.round(usedPct)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface2">
            <div
              className={`h-full rounded-full ${usedPct > 80 ? "bg-neg" : usedPct > 50 ? "bg-yellow-500" : "bg-primary"}`}
              style={{ width: `${usedPct}%` }}
            />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted">Limite disponível</p>
            <p className="font-semibold tabular-nums text-pos">{brl(available)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Vencimento</p>
            <p className="font-semibold text-text">{credit.balanceDueDate ? dateBR(credit.balanceDueDate) : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Pagamento mínimo</p>
            <p className="font-semibold tabular-nums text-text">
              {credit.minimumPayment !== undefined ? brl(credit.minimumPayment) : "—"}
            </p>
          </div>
        </div>
      </Card>

      <BillsComparisonCard accountId={account.account_id} />

      <Card title="Faturas">
        {bills.isError ? (
          <ErrorState message={bills.error.message} onRetry={() => bills.refetch()} />
        ) : bills.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (bills.data?.results ?? []).length === 0 ? (
          <EmptyState title="Nenhuma fatura" />
        ) : rows.length === 0 ? (
          <EmptyState title="Nenhuma fatura com esses filtros" hint="Ajuste o período ou o status." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-3 font-medium">Vencimento</th>
                  <th className="py-2 pr-3 text-right font-medium">Valor total</th>
                  <th className="py-2 pr-3 text-right font-medium">Mínimo</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((b) => {
                  const s = billStatusBadge(b.payment_status);
                  return (
                    <tr key={b.id}>
                      <td className="whitespace-nowrap py-2 pr-3 text-muted">{dateBR(b.dueDate)}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums text-text">
                        {brl(b.totalAmount)}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums text-muted">
                        {brl(b.minimumPaymentAmount)}
                      </td>
                      <td className="py-2">
                        <Badge tone={s.tone}>{s.label}</Badge>
                        {disputed[b.id] && (
                          <span className="ml-2 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-[10px] text-yellow-400">
                            Pagamento registrado em {dateBR(disputed[b.id].paymentDate)} — aguardando baixa
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function CardsPage() {
  const bundle = useAccountsBundle();
  const [dueRange, setDueRange] = useState<DueRange>("all");
  const [statusFilter, setStatusFilter] = useState("all");

  if (bundle.isError) return <ErrorState message={bundle.error.message} onRetry={() => bundle.refetch()} />;
  if (bundle.isLoading) {
    return (
      <div>
        <PageHeader title="Cartões" subtitle="Limites, faturas e pagamentos" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const creditAccounts = (bundle.data?.accounts.results ?? []).filter((a) => a.type === "CREDIT");

  return (
    <div className="space-y-6">
      <PageHeader title="Cartões" subtitle="Limites, faturas e pagamentos" />

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-4">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Período de vencimento
          <select value={dueRange} onChange={(e) => setDueRange(e.target.value as DueRange)} className={selectCls}>
            <option value="all">Todas as faturas</option>
            <option value="90">Últimos 90 dias</option>
            <option value="365">Últimos 365 dias</option>
            <option value="future">A vencer (futuras)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Status
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectCls}>
            <option value="all">Todos</option>
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s === "PAID" ? "Paga" : s === "PAST_DUE_UNPAID" ? "Atrasada (não paga)" : s === "PAST_DUE_UNCONFIRMED" ? "Vencida (não confirmada)" : "Em aberto"}
              </option>
            ))}
          </select>
        </label>
      </div>

      {creditAccounts.length === 0 ? (
        <EmptyState title="Nenhum cartão de crédito conectado" />
      ) : (
        creditAccounts.map((a) => (
          <CreditCardPanel key={a.account_id} account={a} dueRange={dueRange} statusFilter={statusFilter} />
        ))
      )}
    </div>
  );
}
