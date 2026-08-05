"use client";

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  AccountsDetailResult,
  AccountsResult,
  Bill,
  BillsResult,
  CategoriesResult,
  ConnectionsResult,
  InvestmentsResult,
  LoansResult,
  Transaction,
  TransactionsResult,
} from "@/src/banco-mcp";
import type { TxKind } from "@/src/lib/semantics";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (body && typeof body.error === "string") msg = body.error;
    } catch {
      // mantém mensagem padrão
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

function postJson<T>(url: string, body: unknown): Promise<T> {
  return fetchJson<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function useConnections(): UseQueryResult<ConnectionsResult> {
  return useQuery({
    queryKey: ["connections"],
    queryFn: () => fetchJson<ConnectionsResult>("/api/bank/connections"),
  });
}

export interface AccountsBundle {
  connections: ConnectionsResult;
  accounts: AccountsResult;
  details: AccountsDetailResult;
}

export function useAccountsBundle(): UseQueryResult<AccountsBundle> {
  return useQuery({
    queryKey: ["accounts"],
    queryFn: () => fetchJson<AccountsBundle>("/api/bank/accounts"),
  });
}

export interface TransactionsParams {
  account_id?: string;
  from?: string;
  to?: string;
  windows?: Array<{ from: string; to: string }>;
  page?: number;
  page_size?: number;
  search_queries?: string[];
  category?: string;
  kind?: TxKind;
  status?: string;
  desc_norm?: string | string[];
}

export interface TransactionsSummary {
  entradas: number;
  saidas: number;
  total: number;
}

export interface StoredTransaction extends Transaction {
  kind: TxKind;
  abs_amount: number;
}

export interface TransactionsPagePayload extends TransactionsResult {
  results: StoredTransaction[];
  summary?: TransactionsSummary;
  breakdown?: Array<{ key: string; name: string; total: number }>;
}

export function useTransactions(params: TransactionsParams): UseQueryResult<TransactionsPagePayload> {
  return useQuery({
    queryKey: ["transactions", params],
    queryFn: () => postJson<TransactionsPagePayload>("/api/bank/transactions", params),
  });
}

export interface DisputedMap {
  [billId: string]: { paymentDate: string; paymentAmount: number };
}

export interface BillsPayload {
  total: number;
  results: Bill[];
  disputed: DisputedMap;
}

export function useBills(accountId: string): UseQueryResult<BillsPayload> {
  return useQuery({
    queryKey: ["bills", accountId],
    queryFn: () => postJson<BillsPayload>("/api/bank/bills", { account_id: accountId }),
    enabled: !!accountId,
  });
}

export function useInvestments(): UseQueryResult<InvestmentsResult> {
  return useQuery({
    queryKey: ["investments"],
    queryFn: () => fetchJson<InvestmentsResult>("/api/bank/investments"),
  });
}

export function useLoans(items: string[]): UseQueryResult<LoansResult> {
  return useQuery({
    queryKey: ["loans", items],
    queryFn: () => postJson<LoansResult>("/api/bank/loans", { items }),
    enabled: items.length > 0,
  });
}

export function useCategories(): UseQueryResult<CategoriesResult> {
  return useQuery({
    queryKey: ["categories"],
    queryFn: () => fetchJson<CategoriesResult>("/api/bank/categories"),
    staleTime: Infinity,
  });
}

export interface SyncMeta {
  syncedAt: string | null;
  syncing: boolean;
  lastError: string | null;
}

export function useSyncMeta(): UseQueryResult<SyncMeta> {
  return useQuery({
    queryKey: ["sync-meta"],
    queryFn: () => fetchJson<SyncMeta>("/api/bank/meta"),
    refetchInterval: 15_000,
  });
}

export interface InsightsPayload {
  categories: Array<{ key: string; name: string; valor: number }>;
  series: Array<{ accountId: string; name: string; points: Array<{ day: string; saldo: number }> }>;
  latest: StoredTransaction[];
  monthly: Array<{ month: string; spend: number; income: number }>;
  investmentSeries: Array<{ day: string; investido: number }>;
  creditOpenTotal: number;
  disputedCycle: { accountName: string; balance: string; paymentDate: string; paymentAmount: number } | null;
  openBill: { accountName: string; balance: string; dueDate?: string; minimumPayment?: string } | null;
  nextBill: Bill | null;
  overdueBills: Bill[];
  disputed: DisputedMap;
}

export function useInsights(): UseQueryResult<InsightsPayload> {
  return useQuery({
    queryKey: ["insights"],
    queryFn: () => fetchJson<InsightsPayload>(`/api/bank/insights`),
  });
}

export function useSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => postJson<Record<string, unknown>>("/api/bank/sync", {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["connections"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["bills"] });
      qc.invalidateQueries({ queryKey: ["investments"] });
      qc.invalidateQueries({ queryKey: ["loans"] });
      qc.invalidateQueries({ queryKey: ["sync-meta"] });
      qc.invalidateQueries({ queryKey: ["insights"] });
      qc.invalidateQueries({ queryKey: ["comparisons"] });
      qc.invalidateQueries({ queryKey: ["recurrents"] });
      qc.invalidateQueries({ queryKey: ["projection"] });
      qc.invalidateQueries({ queryKey: ["budgets-spent"] });
    },
  });
}

export function useDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { item: string; confirm: boolean }) =>
      postJson<Record<string, unknown>>("/api/bank/disconnect", payload),
    onSuccess: () => {
      qc.invalidateQueries();
    },
  });
}

export function useCategorize() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: Array<{ transaction_id: string; category_id: string }>) =>
      postJson<Record<string, unknown>>("/api/bank/categorize", { items }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["insights"] });
    },
    // Sucesso parcial: o backend aplica localmente o que foi aceito antes de
    // reportar erro 502 — o UI precisa refletir essas mudanças também.
    onError: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["insights"] });
    },
  });
}

export interface InvestmentMovementRow {
  id: string;
  investment_id: string;
  date: string;
  type: string;
  net_amount: number;
}

export function useInvestmentMovements(investmentId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["investment-movements", investmentId],
    queryFn: () =>
      fetchJson<{ results: InvestmentMovementRow[] }>(
        `/api/bank/investments/movements?investment_id=${encodeURIComponent(investmentId)}`,
      ),
    enabled,
    staleTime: Infinity,
  });
}

export function useProjection(days = 60) {
  return useQuery({
    queryKey: ["projection", days],
    queryFn: () => fetchJson<{ days: Array<{ day: string; saldo: number }> }>(`/api/bank/projection?days=${days}`),
  });
}

export interface RecurrentItem {
  key: string;
  label: string;
  category: string;
  descNorm: string;
  kind: string;
  monthly: number;
  occurrences: number;
  lastDate: string;
  deltaPct: number | null;
}

export function useRecurrents() {
  return useQuery({
    queryKey: ["recurrents"],
    queryFn: () => fetchJson<{ recorrentes: RecurrentItem[] }>("/api/bank/recurrents"),
  });
}

export interface CategoryDelta {
  key: string;
  name: string;
  current: number;
  previous: number;
  delta: number;
}

export interface WindowComparison {
  current: { spend: number; income: number };
  previous: { spend: number; income: number };
  deltaSpend: number;
  deltaSpendPct: number | null;
  deltaIncome: number;
  deltaIncomePct: number | null;
  categories: { spend: CategoryDelta[]; income: CategoryDelta[] };
}

export interface ComparisonsPayload {
  elapsedDays: number;
  sameWindow: WindowComparison;
  rolling: WindowComparison;
  calendar: {
    current: { spend: number; income: number; days: number; spendPerDay: number; incomePerDay: number };
    previous: { spend: number; income: number; days: number; spendPerDay: number; incomePerDay: number };
    deltaSpendPerDayPct: number | null;
    deltaIncomePerDayPct: number | null;
    categories: { spend: CategoryDelta[]; income: CategoryDelta[] };
  };
}

export function useComparisons() {
  return useQuery({
    queryKey: ["comparisons"],
    queryFn: () => fetchJson<ComparisonsPayload>("/api/bank/comparisons"),
  });
}

export interface BillsComparisonPayload {
  accountId: string;
  current: { dueDate: string; total: number } | null;
  previous: { dueDate: string; total: number } | null;
  delta: number | null;
  deltaPct: number | null;
}

export function useBillsComparison(accountId: string) {
  return useQuery({
    queryKey: ["bills-comparison", accountId],
    queryFn: () => fetchJson<BillsComparisonPayload>(`/api/bank/bills-comparison?account_id=${encodeURIComponent(accountId)}`),
    enabled: !!accountId,
  });
}

export function useBudgetsSpent() {
  return useQuery({
    queryKey: ["budgets-spent"],
    queryFn: () => fetchJson<{ month: string; categories: Array<{ key: string; spent: number }> }>(
      "/api/bank/budgets/spent",
    ),
  });
}

export function useBenchmarks() {
  return useQuery({
    queryKey: ["benchmarks"],
    queryFn: () =>
      fetchJson<{ cdiAnnualPct: number | null; ipcaAnnualPct: number | null; source: string; updatedAt: string }>(
        "/api/bank/benchmarks",
      ),
    staleTime: 24 * 60 * 60_000,
  });
}
