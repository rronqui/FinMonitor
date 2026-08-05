import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

function mcpUrl(): string {
  const url = process.env.MCP_URL;
  if (!url) throw new Error("MCP_URL ausente no .env");
  return url;
}
const PROTOCOL_VERSION = "2025-03-26";

export interface BankConnection {
  connector_id: string;
  connector_name: string;
  item_id: string;
  status: string;
  reconnect_url?: string;
  [key: string]: unknown;
}

export interface ConnectionsResult {
  connections: BankConnection[];
  count: number;
  hint?: string;
  add_connection_url?: string;
  [key: string]: unknown;
}

export interface Account {
  id: string;
  account_id: string;
  type: "BANK" | "CREDIT";
  subtype: string;
  name: string;
  number: string;
  balance: string;
  currencyCode: string;
  bankData?: Record<string, string>;
  creditData?: Record<string, string>;
  [key: string]: unknown;
}

export interface AccountsResult {
  total: number;
  bank: string;
  item_id: string;
  results: Account[];
  [key: string]: unknown;
}

export interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: string;
  type: string;
  status: string;
  category?: string;
  [key: string]: unknown;
}

export interface TransactionsResult {
  total: number;
  page: number;
  totalPages: number;
  results: Transaction[];
  account?: { account_id: string; bank: string; name: string; type: string };
  [key: string]: unknown;
}

export interface Bill {
  id: string;
  dueDate: string;
  totalAmount: string;
  minimumPaymentAmount: string;
  payment_status?: string;
  [key: string]: unknown;
}

export interface BillsResult {
  total: number;
  results: Bill[];
  account?: { account_id: string; name: string };
  [key: string]: unknown;
}

export interface ItemStatus {
  id: string;
  status: string;
  executionStatus: string;
  connector?: { id: number; name: string };
  products?: string[];
  [key: string]: unknown;
}

export interface Investment {
  id: string;
  name: string;
  type: string;
  subtype: string;
  balance: string;
  currencyCode: string;
  status: string;
  amount: string;
  amountOriginal: string;
  amountWithdrawal: string;
  taxes: string;
  rate?: number;
  rateType?: string;
  issuer?: string;
  issueDate?: string;
  purchaseDate?: string;
  dueDate?: string;
  [key: string]: unknown;
}

export interface InvestmentsResult {
  total: number;
  page: number;
  totalPages: number;
  results: Investment[];
  [key: string]: unknown;
}

export interface LoanContract {
  id: string;
  type: string;
  currencyCode: string;
  contractAmount: string;
  dueDate?: string;
  contractNumber?: string;
  [key: string]: unknown;
}

export interface LoansResult {
  results: Array<{ item_id: string; total: number; results: LoanContract[] }>;
  errors: unknown[];
  [key: string]: unknown;
}

export interface CategoryNode {
  id: string;
  description: string;
  descriptionTranslated: string;
  parentId: string | null;
  parentDescription: string | null;
  [key: string]: unknown;
}

export interface CategoriesResult {
  total: number;
  results: CategoryNode[];
  [key: string]: unknown;
}

export interface AccountsDetailResult {
  results: Array<{ account_id: string; account: Account }>;
  [key: string]: unknown;
}

/**
 * Client for the "Banco MCP" (Open Finance Brasil) server at mcp.ai,
 * over Streamable HTTP with a permanent Bearer token.
 */
export class BancoMcpClient {
  private token: string;
  private client?: Client;

  constructor(token: string) {
    this.token = token;
  }

  async connect(): Promise<void> {
    const transport = new StreamableHTTPClientTransport(new URL(mcpUrl()), {
      requestInit: { headers: { Authorization: `Bearer ${this.token}` } },
    });
    this.client = new Client({ name: "finmonitor", version: "0.1.0" });
    await this.client.connect(transport);
  }

  async authenticate(): Promise<string> {
    const result = await this.callTool("authenticate", { token: this.token });
    const text = this.extractSafe(result);
    if (result.isError || !text) {
      throw new Error("authenticate failed: " + (text || "no result text"));
    }
    return text;
  }

  async requestConnect(): Promise<string> {
    const result = await this.callTool("connect", {});
    return this.extract(result);
  }

  async listConnections(): Promise<ConnectionsResult> {
    return this.extractJson<ConnectionsResult>(
      await this.callTool("openfinance_list_connections", {}),
    );
  }

  async getItemStatus(itemId: string): Promise<ItemStatus> {
    return this.extractJson<ItemStatus>(
      await this.callTool("openfinance_get_item_status", { item_id: itemId }),
    );
  }

  async listAccounts(itemId?: string): Promise<AccountsResult> {
    const args: Record<string, unknown> = itemId ? { item: itemId } : {};
    return this.extractJson<AccountsResult>(
      await this.callTool("openfinance_list_accounts", args),
    );
  }

  async listTransactions(
    accountId: string,
    opts?: { page?: number; pageSize?: number; detail?: "compact" | "rich" | "raw" },
  ): Promise<TransactionsResult> {
    const args: Record<string, unknown> = {
      account_id: accountId,
      detail: opts?.detail ?? "compact",
    };
    if (opts?.page !== undefined) args.page = opts.page;
    if (opts?.pageSize !== undefined) args.page_size = opts.pageSize;
    return this.extractJson<TransactionsResult>(
      await this.callTool("openfinance_list_transactions", args),
    );
  }

  async listCreditCardBills(
    accountId: string,
    opts?: { pageSize?: number; includeOpenBill?: boolean },
  ): Promise<BillsResult> {
    const args: Record<string, unknown> = { account_id: accountId };
    if (opts?.pageSize !== undefined) args.page_size = opts.pageSize;
    if (opts?.includeOpenBill !== undefined) args.include_open_bill = opts.includeOpenBill;
    return this.extractJson<BillsResult>(
      await this.callTool("openfinance_list_credit_card_bills", args),
    );
  }

  async close(): Promise<void> {
    await this.client?.close();
  }

  private async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    if (!this.client) throw new Error("not connected — call connect() first");
    return (await this.client.callTool({ name, arguments: args })) as CallToolResult;
  }

  /** Concatenate every text content entry; throw on tool-level errors. */
  private extract(result: CallToolResult): string {
    const text = this.extractSafe(result);
    if (result.isError) {
      throw new Error(text || "tool returned an error without details");
    }
    return text;
  }

  /** Concatenate text content entries without raising on isError. */
  private extractSafe(result: CallToolResult): string {
    return (result.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("\n");
  }

  /** Parse tool text as JSON; fall back to { raw } when the platform appends non-JSON fields. */
  private extractJson<T>(result: CallToolResult): T {
    const text = this.extract(result);
    try {
      return JSON.parse(text) as T;
    } catch {
      return { raw: text } as T;
    }
  }
}

export { PROTOCOL_VERSION };
