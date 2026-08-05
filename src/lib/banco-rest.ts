/**
 * Data plane for the FinMonitor dashboard: REST mirror of the Banco MCP tools.
 * Same JWT as the MCP client (`.env` MCP_AI_TOKEN), no session lifecycle.
 */
import type {
  AccountsDetailResult,
  AccountsResult,
  BankConnection,
  Bill,
  BillsResult,
  CategoriesResult,
  ConnectionsResult,
  ItemStatus,
  InvestmentsResult,
  LoansResult,
  Transaction,
  TransactionsResult,
} from "../banco-mcp.js";

function openfinanceBase(): string {
  const base = process.env.OPENFINANCE_BASE;
  if (!base) throw new Error("OPENFINANCE_BASE ausente no .env");
  return base;
}

export class BankAuthError extends Error {
  constructor() {
    super("token expirado ou inválido (401)");
    this.name = "BankAuthError";
  }
}
export async function callBank<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const token = process.env.MCP_AI_TOKEN;
  if (!token) throw new Error("MCP_AI_TOKEN ausente");

  const res = await fetch(`${openfinanceBase()}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401) throw new BankAuthError();

  let json: { ok?: boolean; error?: unknown; result?: T };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    throw new Error(`resposta inválida do servidor (${res.status})`);
  }

  if (!res.ok || json.ok === false) {
    const msg = typeof json.error === "string" ? json.error : JSON.stringify(json.error ?? null);
    throw new Error(msg || `erro do servidor (${res.status})`);
  }
  return json.result as T;
}

function clean(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

export function listConnections(): Promise<ConnectionsResult> {
  return callBank<ConnectionsResult>("connections/list");
}

export function getItemStatus(item: string): Promise<ItemStatus> {
  return callBank<ItemStatus>("connections/status", { item });
}

export function forceSync(items: string[]): Promise<ItemStatus | Record<string, unknown>> {
  return callBank("connections/sync", { items });
}

export function disconnectBank(item: string): Promise<Record<string, unknown>> {
  return callBank("connections/disconnect", { item });
}

export function listAccounts(opts?: { item?: string; type?: "BANK" | "CREDIT" }): Promise<AccountsResult> {
  return callBank<AccountsResult>("accounts/list", clean({ item: opts?.item, type: opts?.type }));
}

export interface ListTransactionsParams {
  account_id: string;
  from?: string;
  to?: string;
  page?: number;
  page_size?: number;
  search_queries?: string[];
}

export function listTransactions(p: ListTransactionsParams): Promise<TransactionsResult> {
  return callBank<TransactionsResult>(
    "transactions/list",
    clean({
      account_id: p.account_id,
      from: p.from,
      to: p.to,
      page: p.page,
      page_size: p.page_size,
      search_queries: p.search_queries,
    }),
  );
}

export function updateTransactionCategories(
  items: Array<{ transaction_id: string; category_id: string }>,
): Promise<Record<string, unknown>> {
  return callBank("transactions/category", { items });
}

export function listBills(p: { account_id: string; page?: number; page_size?: number }): Promise<BillsResult> {
  return callBank<BillsResult>("credit-card-bills/list", clean({ ...p }));
}

export function getBillDetail(billIds: string[]): Promise<Record<string, unknown>> {
  return callBank("credit-card-bills/detail", { bill_ids: billIds });
}

export function listInvestments(p?: { item?: string; type?: string }): Promise<InvestmentsResult> {
  return callBank<InvestmentsResult>("investments/list", clean({ item: p?.item, type: p?.type }));
}

export function listLoans(items: string[]): Promise<LoansResult> {
  return callBank<LoansResult>("loans/list", { items });
}

export function getLoanDetail(loanIds: string[]): Promise<Record<string, unknown>> {
  return callBank("loans/detail", { loan_ids: loanIds });
}

export function listCategories(): Promise<CategoriesResult> {
  return callBank<CategoriesResult>("categories/list");
}

export function searchConnectors(keywords: string[]): Promise<Record<string, unknown>> {
  return callBank("connectors/search", { keywords });
}

export type {
  AccountsDetailResult,
  AccountsResult,
  BankConnection,
  Bill,
  BillsResult,
  CategoriesResult,
  ConnectionsResult,
  ItemStatus,
  InvestmentsResult,
  LoansResult,
  Transaction,
  TransactionsResult,
};

export interface InvestmentMovementRaw {
  id: string;
  date: string;
  type: string;
  amount?: string;
  netAmount?: string;
  [key: string]: unknown;
}

export function listInvestmentTransactions(investmentId: string): Promise<{
  total: number;
  results: InvestmentMovementRaw[];
}> {
  return callBank("investments/transactions/list", { investment_id: investmentId });
}
