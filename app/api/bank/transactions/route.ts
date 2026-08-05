import * as repo from "@/src/lib/repo";
import type { TxKind } from "@/src/lib/semantics";
import { bankError } from "@/src/lib/api";

export interface TransactionsRequestBody {
  account_id?: string;
  from?: string;
  to?: string;
  windows?: Array<{ from?: string; to?: string }>;
  page?: number;
  page_size?: number;
  search_queries?: string[];
  category?: string;
  kind?: TxKind;
  status?: string;
  desc_norm?: string | string[];
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as TransactionsRequestBody;
    const ISO_PREFIX = /^\d{4}-\d{2}-\d{2}/;
    const windows = (body.windows ?? [])
      .filter(
        (w) =>
          typeof w.from === "string" &&
          ISO_PREFIX.test(w.from) &&
          typeof w.to === "string" &&
          ISO_PREFIX.test(w.to),
      )
      .map((w) => ({ from: w.from as string, to: w.to as string }));
    const filters = {
      accountId: body.account_id || undefined,
      from: body.from,
      to: body.to,
      windows: windows.length > 0 ? windows : undefined,
      search: body.search_queries?.[0],
      category: body.category,
      kind: body.kind,
      status: body.status,
      descNorm: body.desc_norm,
    };
    const pageSize = Math.min(Math.max(1, Math.floor(body.page_size ?? 50)), 5000);
    const pageRaw = Number(body.page ?? 1);
    const page = Number.isFinite(pageRaw) ? Math.max(1, Math.floor(pageRaw)) : 1;
    const payload = repo.queryTransactions({ ...filters, page, pageSize });
    // o gráfico ignora o próprio filtro de categoria para manter o contexto da distribuição
    return Response.json({
      ...payload,
      summary: repo.queryTransactionsSummary(filters),
      breakdown: repo.queryCategoryBreakdown({ ...filters, category: undefined, kind: filters.kind ?? "spend" }),
    });
  } catch (err) {
    return bankError(err);
  }
}
