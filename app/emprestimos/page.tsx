"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { LoanContract } from "@/src/banco-mcp";
import { Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton } from "@/src/components/ui";
import { brl, dateBR } from "@/src/lib/format";
import { useConnections, useLoans } from "@/src/lib/hooks";

interface InterestRate {
  taxType?: string | null;
  referentialRateIndexerType?: string | null;
  preFixedRate?: number | null;
  postFixedRate?: number | null;
  calculation?: string | null;
  taxPeriodicity?: string | null;
}

interface LoanDetailPayload {
  results?: Array<{
    loan_id?: string;
    loan?: {
      contractDate?: string;
      dueDate?: string;
      CET?: number;
      installmentPeriodicity?: string;
      interestRates?: InterestRate[];
      installments?: {
        totalNumberOfInstallments?: number;
        contractRemainingNumber?: number;
        dueInstallments?: number;
        paidInstallments?: number;
        pastDueInstallments?: number;
        balloonPayments?: Array<{ dueDate?: string; amount?: { value?: number; currencyCode?: string } }>;
      };
      [key: string]: unknown;
    };
  }>;
  errors?: unknown[];
}

function LoanDetail({ loanId }: { loanId: string }) {
  const detail = useQuery<LoanDetailPayload>({
    queryKey: ["loan", loanId],
    queryFn: async () => {
      const res = await fetch("/api/bank/loans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loan_ids: [loanId] }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
  });

  if (detail.isPending) return <Skeleton className="mt-3 h-16 w-full" />;
  if (detail.isError) return <p className="mt-3 text-xs text-neg">{detail.error.message}</p>;

  const loan = (detail.data?.results ?? []).find((r) => r.loan_id === loanId)?.loan ?? detail.data?.results?.[0]?.loan;
  if (!loan) return <p className="mt-3 text-xs text-muted">Sem detalhes para este contrato.</p>;

  const rates = loan.interestRates ?? [];
  const inst = loan.installments ?? {};
  const installmentRows: Array<[string, number | undefined]> = [
    ["Total de parcelas", inst.totalNumberOfInstallments],
    ["Parcelas restantes", inst.contractRemainingNumber],
    ["Parcelas pagas", inst.paidInstallments],
    ["Parcelas vencidas", inst.pastDueInstallments],
  ];
  const balloon = inst.balloonPayments?.[0];
  const hasInstallments = (inst.totalNumberOfInstallments ?? 0) > 0;

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-border bg-surface2 p-4 text-sm">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {loan.contractDate && (
          <div>
            <p className="text-xs text-muted">Contratado em</p>
            <p className="text-text">{dateBR(loan.contractDate)}</p>
          </div>
        )}
        {loan.CET != null && (
          <div>
            <p className="text-xs text-muted">CET</p>
            <p className="tabular-nums text-text">{loan.CET}%</p>
          </div>
        )}
        {loan.installmentPeriodicity && (
          <div>
            <p className="text-xs text-muted">Periodicidade</p>
            <p className="text-text">{loan.installmentPeriodicity}</p>
          </div>
        )}
      </div>

      {rates.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted">Taxas de juros</p>
          <ul className="space-y-1">
            {rates.map((r, i) => {
              const rate = r.preFixedRate ?? r.postFixedRate;
              const label = [r.taxType, r.referentialRateIndexerType].filter(Boolean).join(" · ") || "Taxa";
              const periodicity = r.taxPeriodicity
                ? r.taxPeriodicity === "YEARLY"
                  ? "a.a."
                  : r.taxPeriodicity === "MONTHLY"
                    ? "a.m."
                    : r.taxPeriodicity
                : "";
              return (
                <li key={i} className="flex justify-between text-text">
                  <span className="text-muted">
                    {label}
                    {r.calculation ? ` (${r.calculation})` : ""}
                  </span>
                  <span className="tabular-nums">{rate !== undefined && rate !== null ? `${rate}% ${periodicity}` : "—"}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {hasInstallments ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {installmentRows.map(([label, v]) =>
            v === undefined || v === null ? null : (
              <div key={label}>
                <p className="text-xs text-muted">{label}</p>
                <p className="tabular-nums text-text">{v}</p>
              </div>
            ),
          )}
        </div>
      ) : balloon ? (
        <p className="text-xs text-muted">
          Pagamento único (balloon) em {balloon.dueDate ? dateBR(balloon.dueDate) : "—"}
          {balloon.amount?.value ? ` · ${brl(balloon.amount.value)}` : ""}.
        </p>
      ) : null}
    </div>
  );
}

function LoanCard({ loan }: { loan: LoanContract }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Badge tone="gray">{loan.type}</Badge>
          <p className="mt-2 text-2xl font-bold tabular-nums text-text">{brl(loan.contractAmount)}</p>
          <p className="mt-1 text-xs text-muted">
            {loan.contractNumber ? `Contrato nº ${loan.contractNumber}` : "Contrato"}
            {loan.dueDate ? ` · vencimento ${dateBR(loan.dueDate)}` : ""}
          </p>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-surface2 px-3 py-2 text-xs font-medium text-text hover:bg-border"
        >
          Detalhes {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>
      {open && <LoanDetail loanId={loan.id} />}
    </Card>
  );
}

export default function LoansPage() {
  const connections = useConnections();
  const items = (connections.data?.connections ?? []).map((c) => c.item_id);
  const loans = useLoans(items);

  if (connections.isError) return <ErrorState message={connections.error.message} onRetry={() => connections.refetch()} />;
  if (loans.isError) return <ErrorState message={loans.error.message} onRetry={() => loans.refetch()} />;
  if (connections.isLoading || (items.length > 0 && loans.isLoading)) {
    return (
      <div>
        <PageHeader title="Empréstimos" subtitle="Contratos ativos" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const contracts = (loans.data?.results ?? []).flatMap((g) => g.results ?? []);

  return (
    <div className="space-y-6">
      <PageHeader title="Empréstimos" subtitle="Contratos ativos" />
      {contracts.length === 0 ? (
        <EmptyState title="Nenhum empréstimo contratado" />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {contracts.map((loan) => (
            <LoanCard key={loan.id} loan={loan} />
          ))}
        </div>
      )}
    </div>
  );
}
