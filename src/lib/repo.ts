import type {
  Account,
  BankConnection,
  Bill,
  CategoryNode,
  Investment,
  LoanContract,
  Transaction,
} from "../banco-mcp";
import { db, getMeta, setMeta } from "./db";
import { classify, normalizeDescription, prettifyCategory, type TxKind } from "./semantics";

export interface StoredLoan extends LoanContract {
  _item_id?: string;
}

export interface StoredTransaction extends Transaction {
  kind: TxKind;
  abs_amount: number;
}

// ---- writes (called by the sync engine)

export function upsertConnections(rows: BankConnection[]): void {
  const d = db();
  const stmt = d.prepare(
    "INSERT INTO connections (item_id, connector_id, connector_name, status, reconnect_url, created_at, raw) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(item_id) DO UPDATE SET connector_id=excluded.connector_id, connector_name=excluded.connector_name, status=excluded.status, reconnect_url=excluded.reconnect_url, created_at=excluded.created_at, raw=excluded.raw",
  );
  d.transaction(() => {
    for (const c of rows) {
      stmt.run(
        c.item_id,
        String(c.connector_id ?? ""),
        c.connector_name ?? "",
        c.status ?? "",
        (c.reconnect_url as string | undefined) ?? null,
        (c.created_at as string | undefined) ?? null,
        JSON.stringify(c),
      );
    }
  })();
}

export function upsertAccounts(rows: Account[]): void {
  const d = db();
  const stmt = d.prepare(
    "INSERT INTO accounts (account_id, type, subtype, name, number, balance, currency_code, bank_data, credit_data, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET type=excluded.type, subtype=excluded.subtype, name=excluded.name, number=excluded.number, balance=excluded.balance, currency_code=excluded.currency_code, bank_data=excluded.bank_data, credit_data=excluded.credit_data, raw=excluded.raw",
  );
  d.transaction(() => {
    for (const a of rows) {
      stmt.run(
        a.account_id,
        a.type,
        a.subtype ?? "",
        a.name ?? "",
        a.number ?? "",
        a.balance ?? "0",
        a.currencyCode ?? "BRL",
        JSON.stringify(a.bankData ?? null),
        JSON.stringify(a.creditData ?? null),
        JSON.stringify(a),
      );
    }
  })();
}

/** Classifica na ingestão: kind/abs_amount persistidos, nunca re-derivados. */
export function upsertTransactions(accountType: string, accountId: string, rows: Transaction[]): void {
  const d = db();
  const del = d.prepare("DELETE FROM transactions WHERE account_id = ?");
  const ins = d.prepare(
    "INSERT INTO transactions (id, account_id, date, description, amount, type, status, category, category_id, kind, abs_amount, desc_norm, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  // guarda contra glitch do provedor: resposta vazia NÃO apaga o snapshot existente
  // (o provedor já retornou results:[] sob rate-limit; apagar destruiria o dashboard).
  if (rows.length === 0 && (d.prepare("SELECT COUNT(*) AS n FROM transactions WHERE account_id = ?").get(accountId) as { n: number }).n > 0) {
    return;
  }
  d.transaction(() => {
    del.run(accountId);
    for (const t of rows) {
      const { kind, valor } = classify(accountType, Number(t.amount), (t.category as string | undefined) ?? null);
      ins.run(
        t.id,
        accountId,
        t.date,
        t.description ?? "",
        t.amount,
        t.type ?? "",
        t.status ?? "",
        (t.category as string | undefined) ?? null,
        (t.categoryId as string | undefined) ?? null,
        kind,
        valor,
        normalizeDescription(t.description ?? ""),
        JSON.stringify(t),
      );
    }
  })();
}

export function upsertBills(accountId: string, rows: Bill[]): void {
  const d = db();
  const del = d.prepare("DELETE FROM bills WHERE account_id = ?");
  const ins = d.prepare(
    "INSERT INTO bills (id, account_id, due_date, total_amount, minimum_payment, payment_status, raw) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  // guarda contra glitch do provedor: resposta vazia NÃO apaga o snapshot existente
  // (mesmo padrão de upsertTransactions).
  if (rows.length === 0 && (d.prepare("SELECT COUNT(*) AS n FROM bills WHERE account_id = ?").get(accountId) as { n: number }).n > 0) {
    return;
  }
  d.transaction(() => {
    del.run(accountId);
    for (const b of rows) {
      ins.run(
        b.id,
        accountId,
        b.dueDate ?? null,
        b.totalAmount ?? "0",
        b.minimumPaymentAmount ?? "0",
        b.payment_status ?? null,
        JSON.stringify(b),
      );
    }
  })();
}

export function upsertInvestments(rows: Investment[]): void {
  const d = db();
  const stmt = d.prepare(
    "INSERT INTO investments (id, name, type, subtype, balance, amount, amount_original, amount_withdrawal, taxes, rate, rate_type, issuer, issue_date, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, type=excluded.type, subtype=excluded.subtype, balance=excluded.balance, amount=excluded.amount, amount_original=excluded.amount_original, amount_withdrawal=excluded.amount_withdrawal, taxes=excluded.taxes, rate=excluded.rate, rate_type=excluded.rate_type, issuer=excluded.issuer, issue_date=excluded.issue_date, raw=excluded.raw",
  );
  d.transaction(() => {
    for (const i of rows) {
      stmt.run(
        i.id,
        i.name ?? "",
        i.type ?? "",
        i.subtype ?? "",
        i.balance ?? "0",
        i.amount ?? "0",
        i.amountOriginal ?? "0",
        i.amountWithdrawal ?? "0",
        i.taxes ?? "0",
        i.rate ?? null,
        i.rateType ?? null,
        i.issuer ?? null,
        i.issueDate ?? null,
        JSON.stringify(i),
      );
    }
  })();
}

export function upsertLoans(rows: StoredLoan[]): void {
  const d = db();
  const stmt = d.prepare(
    "INSERT INTO loans (id, item_id, type, contract_amount, due_date, contract_number, raw) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET item_id=excluded.item_id, type=excluded.type, contract_amount=excluded.contract_amount, due_date=excluded.due_date, contract_number=excluded.contract_number, raw=excluded.raw",
  );
  d.transaction(() => {
    for (const l of rows) {
      stmt.run(
        l.id,
        l._item_id ?? null,
        l.type ?? "",
        l.contractAmount ?? "0",
        l.dueDate ?? null,
        l.contractNumber ?? null,
        JSON.stringify(l),
      );
    }
  })();
}

export function upsertCategories(rows: CategoryNode[]): void {
  const d = db();
  const stmt = d.prepare(
    "INSERT INTO categories (id, description, description_translated, parent_id, parent_description) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET description=excluded.description, description_translated=excluded.description_translated, parent_id=excluded.parent_id, parent_description=excluded.parent_description",
  );
  d.transaction(() => {
    for (const c of rows) {
      stmt.run(c.id, c.description ?? "", c.descriptionTranslated ?? "", c.parentId, c.parentDescription);
    }
  })();
}

/** Aplica recategorização vinda do provedor no snapshot: categoria em INGLÊS
 * (chave do provedor), kind re-derivado. Transações inexistentes são ignoradas. */
export function applyRecategorization(items: Array<{ transaction_id: string; category_id: string }>): void {
  const d = db();
  const catStmt = d.prepare("SELECT description_translated AS t, description AS e FROM categories WHERE id = ?");
  const txStmt = d.prepare("SELECT raw, account_id FROM transactions WHERE id = ?");
  const accStmt = d.prepare("SELECT type FROM accounts WHERE account_id = ?");
  const updStmt = d.prepare("UPDATE transactions SET category = ?, category_id = ?, kind = ?, raw = ? WHERE id = ?");
  d.transaction(() => {
    for (const it of items) {
      const cat = catStmt.get(it.category_id) as { t: string; e: string } | undefined;
      const row = txStmt.get(it.transaction_id) as { raw: string; account_id: string } | undefined;
      if (!row) continue;
      const tx = JSON.parse(row.raw) as Record<string, unknown>;
      // account_id vem da COLUNA da tabela: o raw do provedor NÃO o contém.
      // (Ler do raw deixava undefined -> fallback "BANK" -> sinal invertido
      // para compras no cartão viravam "income".)
      const accType = (accStmt.get(row.account_id) as { type: string } | undefined)?.type ?? "BANK";
      tx.category = cat?.e ?? tx.category; // chave INGLESA; nunca a tradução
      tx.categoryId = it.category_id;
      const { kind } = classify(accType, Number(tx.amount), (tx.category as string) ?? null);
      updStmt.run(String(tx.category ?? ""), it.category_id, kind, JSON.stringify(tx), it.transaction_id);
    }
  })();
}

// ---- reads (called by route handlers and chat tools)

export function readConnections(): BankConnection[] {
  const rows = db().prepare("SELECT raw FROM connections ORDER BY created_at").all() as Array<{ raw: string }>;
  return rows.map((r) => JSON.parse(r.raw) as BankConnection);
}

export function readAccounts(): Account[] {
  const rows = db().prepare("SELECT raw FROM accounts ORDER BY type, name").all() as Array<{ raw: string }>;
  return rows.map((r) => JSON.parse(r.raw) as Account);
}

export interface TxQuery {
  accountId?: string;
  from?: string;
  to?: string;
  /** Janelas explícitas (fim EXCLUSIVO, como analytics.totalsBetween) — drill-down de comparação. */
  windows?: Array<{ from: string; to: string }>;
  search?: string;
  category?: string;
  kind?: TxKind;
  status?: string;
  descNorm?: string | string[];
  page: number;
  pageSize: number;
}
function txWhere(q: Omit<TxQuery, "page" | "pageSize">): { whereSql: string; params: Record<string, unknown> } {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (q.accountId) {
    where.push("t.account_id = @accountId");
    params.accountId = q.accountId;
  }
  if (q.from && /^\d{4}-\d{2}-\d{2}/.test(q.from)) {
    where.push("t.date >= @from");
    params.from = q.from.includes("T") ? q.from : `${q.from}T00:00:00.000Z`;
  }
  if (q.to && /^\d{4}-\d{2}-\d{2}/.test(q.to)) {
    if (q.to.includes("T")) {
      // timestamp: fim EXCLUSIVO, igual às somas server-side (analytics.totalsBetween)
      where.push("t.date < @to");
      params.to = q.to;
    } else {
      // data curta: dia completo (como openMonth precisa)
      where.push("t.date <= @to");
      params.to = `${q.to}T23:59:59.999Z`;
    }
  }
  if (q.windows && q.windows.length > 0) {
    const clauses: string[] = [];
    q.windows.forEach((w, i) => {
      clauses.push(`(t.date >= @wfrom${i} AND t.date < @wto${i})`);
      params[`wfrom${i}`] = w.from;
      params[`wto${i}`] = w.to;
    });
    where.push(`(${clauses.join(" OR ")})`);
  }
  if (q.search) {
    where.push("t.description LIKE @search");
    params.search = `%${q.search}%`;
  }
  if (q.category) {
    where.push("t.category = @category");
    params.category = q.category;
  }
  if (q.status) {
    where.push("t.status = @status");
    params.status = q.status;
  }
  if (q.descNorm) {
    const list = Array.isArray(q.descNorm) ? q.descNorm : [q.descNorm];
    if (list.length > 0) {
      where.push(`t.desc_norm IN (${list.map((_, i) => `@descNorm${i}`).join(", ")})`);
      list.forEach((v, i) => {
        params[`descNorm${i}`] = v;
      });
    }
  }
  if (q.kind) {
    where.push("t.kind = @kind");
    params.kind = q.kind;
  }
  return { whereSql: where.length > 0 ? where.join(" AND ") : "1=1", params };
}

function readTxRows(whereSql: string, params: Record<string, unknown>): StoredTransaction[] {
  const rows = db()
    .prepare(
      `SELECT t.raw, t.kind, t.abs_amount FROM transactions t WHERE ${whereSql} ORDER BY t.date DESC LIMIT @pageSize OFFSET @offset`,
    )
    .all(params) as Array<{ raw: string; kind: TxKind; abs_amount: number }>;
  return rows.map((r) => ({
    ...(JSON.parse(r.raw) as Transaction),
    kind: r.kind,
    abs_amount: r.abs_amount,
  }));
}

export function queryTransactions(q: TxQuery): { total: number; totalPages: number; results: StoredTransaction[] } {
  const { whereSql, params } = txWhere(q);
  const d = db();
  const countRow = d.prepare(`SELECT COUNT(*) AS n FROM transactions t WHERE ${whereSql}`).get(params) as { n: number };
  const total = countRow.n;
  const rows = readTxRows(whereSql, { ...params, pageSize: q.pageSize, offset: (q.page - 1) * q.pageSize });
  return { total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)), results: rows };
}

export function readBills(accountId: string): Bill[] {
  const rows = db()
    .prepare("SELECT raw FROM bills WHERE account_id = ? ORDER BY due_date DESC")
    .all(accountId) as Array<{ raw: string }>;
  return rows.map((r) => JSON.parse(r.raw) as Bill);
}

export function readInvestments(): Investment[] {
  const rows = db().prepare("SELECT raw FROM investments ORDER BY CAST(amount_withdrawal AS REAL) DESC").all() as Array<{ raw: string }>;
  return rows.map((r) => JSON.parse(r.raw) as Investment);
}

export function readLoans(): StoredLoan[] {
  const rows = db().prepare("SELECT raw FROM loans ORDER BY CAST(contract_amount AS REAL) DESC").all() as Array<{ raw: string }>;
  return rows.map((r) => JSON.parse(r.raw) as StoredLoan);
}

export function readCategories(): CategoryNode[] {
  return db()
    .prepare(
      "SELECT id, description, description_translated AS descriptionTranslated, parent_id AS parentId, parent_description AS parentDescription FROM categories ORDER BY id",
    )
    .all() as CategoryNode[];
}

export function queryTransactionsSummary(q: Omit<TxQuery, "page" | "pageSize">): {
  entradas: number;
  saidas: number;
  total: number;
} {
  const { whereSql, params } = txWhere(q);
  const row = db()
    .prepare(
      `SELECT COUNT(*) AS n,
        SUM(CASE WHEN t.kind = 'income' THEN t.abs_amount ELSE 0 END) AS entradas,
        SUM(CASE WHEN t.kind = 'spend' THEN t.abs_amount ELSE 0 END) AS saidas
       FROM transactions t WHERE ${whereSql}`,
    )
    .get(params) as { n: number; entradas: number | null; saidas: number | null };
  return { entradas: row.entradas ?? 0, saidas: row.saidas ?? 0, total: row.n };
}
/** Gastos por categoria com rótulo pt-BR (name) e chave de filtro (key). */
export function queryCategoryTotals(days: number, limit = 8): Array<{ key: string; name: string; valor: number }> {
  const from = `${new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)}T00:00:00.000Z`;
  const rows = db()
    .prepare(
      `SELECT COALESCE(t.category, 'Sem categoria') AS key,
        COALESCE(NULLIF(MAX(c.description_translated), ''), COALESCE(t.category, 'Sem categoria')) AS name,
        ROUND(SUM(t.abs_amount), 2) AS valor
       FROM transactions t
       LEFT JOIN categories c ON c.description = t.category
       WHERE t.kind = 'spend' AND t.date >= ?
       GROUP BY COALESCE(t.category, 'Sem categoria')
       ORDER BY valor DESC
       LIMIT ?`,
    )
    .all(from, limit) as Array<{ key: string; name: string; valor: number }>;
  return rows.map((r) => ({ ...r, name: r.key !== "Sem categoria" && r.name === r.key ? prettifyCategory(r.key) : r.name }));
}
/** Deltas diários por conta com o sinal CRU (o saldo da conta inclui transferências). */
export function queryDailyDeltas(accountId: string, days: number): Array<{ day: string; delta: number }> {
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  return db()
    .prepare(
      `SELECT substr(t.date, 1, 10) AS day, SUM(CAST(t.amount AS REAL)) AS delta
       FROM transactions t
       WHERE t.account_id = ? AND t.date >= ?
       GROUP BY substr(t.date, 1, 10)`,
    )
    .all(accountId, from) as Array<{ day: string; delta: number }>;
}

export function queryLatest(limit: number): StoredTransaction[] {
  const rows = db()
    .prepare(
      `SELECT raw, kind, abs_amount FROM transactions ORDER BY date DESC LIMIT ?`,
    )
    .all(limit) as Array<{ raw: string; kind: TxKind; abs_amount: number }>;
  return rows.map((r) => ({
    ...(JSON.parse(r.raw) as Transaction),
    kind: r.kind,
    abs_amount: r.abs_amount,
  }));
}

/** Distribuição por categoria para um kind (padrão: spend), com rótulo pt-BR. */
export function queryCategoryBreakdown(q: Omit<TxQuery, "page" | "pageSize">): Array<{ key: string; name: string; total: number }> {
  const { whereSql, params } = txWhere({ ...q, category: undefined, kind: q.kind ?? "spend" });
  const rows = db()
    .prepare(
      `SELECT COALESCE(t.category, 'Sem categoria') AS key,
        COALESCE(NULLIF(MAX(c.description_translated), ''), COALESCE(t.category, 'Sem categoria')) AS name,
        ROUND(SUM(t.abs_amount), 2) AS total
       FROM transactions t
       LEFT JOIN categories c ON c.description = t.category
       WHERE ${whereSql}
       GROUP BY COALESCE(t.category, 'Sem categoria')
       ORDER BY total DESC
       LIMIT 10`,
    )
    .all(params) as Array<{ key: string; name: string; total: number }>;
  return rows.map((r) => ({ ...r, name: r.key !== "Sem categoria" && r.name === r.key ? prettifyCategory(r.key) : r.name }));
}
// ---- meta / sync info

export function syncInfo(): { syncedAt: string | null; syncing: boolean; lastError: string | null } {
  return {
    syncedAt: getMeta("last_sync_at") ?? null,
    syncing: getMeta("syncing") === "1",
    lastError: getMeta("last_sync_error") || null,
  };
}

export function setSyncing(on: boolean): void {
  setMeta("syncing", on ? "1" : "0");
}

export function setLastSync(at: string): void {
  setMeta("last_sync_at", at);
}

export function setLastSyncError(err: string | null): void {
  setMeta("last_sync_error", err ?? "");
}

export function logSync(startedAt: string, status: "ok" | "error", detail?: string): void {
  db()
    .prepare("INSERT INTO sync_log (started_at, finished_at, status, detail) VALUES (?, ?, ?, ?)")
    .run(startedAt, new Date().toISOString(), status, detail ?? null);
}

export interface MonthlyStats {
  month: string;
  spend: number;
  income: number;
}

/** Série mensal (spend/income por YYYY-MM) dos últimos `months` meses, transferências excluídas. */
export function queryMonthlyStats(months: number): MonthlyStats[] {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const from = start.toISOString();
  const rows = db()
    .prepare(
      `SELECT substr(date, 1, 7) AS month,
        SUM(CASE WHEN kind = 'spend' THEN abs_amount ELSE 0 END) AS spend,
        SUM(CASE WHEN kind = 'income' THEN abs_amount ELSE 0 END) AS income
       FROM transactions
       WHERE kind IN ('spend', 'income') AND date >= ?
       GROUP BY month
       ORDER BY month`,
    )
    .all(from) as Array<{ month: string; spend: number; income: number }>;

  const out: MonthlyStats[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const row = rows.find((r) => r.month === key);
    out.push({ month: key, spend: Math.round((row?.spend ?? 0) * 100) / 100, income: Math.round((row?.income ?? 0) * 100) / 100 });
  }
  return out;
}

export interface DisputedBill {
  paymentDate: string;
  paymentAmount: number;
}

/**
 * Faturas marcadas como não pagas pelo banco MAS com pagamento registrado na
 * conta corrente (categoria "Credit card payment"): o banco não baixou a fatura.
 * Casamento por valor (tolerância 1% ou R$ 15) E por data (pagamento entre o
 * vencimento e 3 dias depois), simultaneamente.
 */
export function detectDisputedBills(): Record<string, DisputedBill> {
  const d = db();
  const payments = d
    .prepare(
      `SELECT substr(t.date, 1, 10) AS day, t.abs_amount AS v
       FROM transactions t
       WHERE t.category = 'Credit card payment'`,
    )
    .all() as Array<{ day: string; v: number }>;
  const overdue = d
    .prepare(
      `SELECT id, substr(due_date, 1, 10) AS due, CAST(total_amount AS REAL) AS total
       FROM bills
       WHERE payment_status IN ('PAST_DUE_UNPAID', 'PAST_DUE_UNCONFIRMED')`,
    )
    .all() as Array<{ id: string; due: string; total: number }>;

  const out: Record<string, DisputedBill> = {};
  for (const bill of overdue) {
    const tol = Math.max(bill.total * 0.01, 15);
    const due = new Date(bill.due).getTime();
    const hit = payments.find((p) => {
      const payDay = new Date(p.day).getTime();
      const byAmount = Math.abs(p.v - bill.total) <= tol;
      const byDate = payDay >= due - 86_400_000 && payDay <= due + 3 * 86_400_000;
      return byAmount && byDate;
    });
    if (hit) out[bill.id] = { paymentDate: hit.day, paymentAmount: hit.v };
  }
  return out;
}

export interface InvestmentMovement {
  id: string;
  investment_id: string;
  date: string;
  type: string;
  net_amount: number;
}

export function upsertInvestmentMovements(rows: InvestmentMovement[]): void {
  const d = db();
  const stmt = d.prepare(
    "INSERT INTO investment_movements (id, investment_id, date, type, net_amount) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET investment_id=excluded.investment_id, date=excluded.date, type=excluded.type, net_amount=excluded.net_amount",
  );
  d.transaction(() => {
    for (const m of rows) stmt.run(m.id, m.investment_id, m.date, m.type, m.net_amount);
  })();
}

/**
 * Série diária do total investido nos últimos `days` dias: caminhada reversa a
 * partir do valor de resgate atual, subindo BUY e descendo SELL (netAmount).
 */
export function queryInvestmentSeries(days: number): Array<{ day: string; investido: number }> {
  const current = db()
    .prepare("SELECT ROUND(SUM(amount_withdrawal), 2) AS v FROM investments")
    .get() as { v: number | null };
  const moves = db()
    .prepare("SELECT substr(date, 1, 10) AS day, type, net_amount FROM investment_movements")
    .all() as Array<{ day: string; type: string; net_amount: number }>;
  const deltaByDay = new Map<string, number>();
  for (const m of moves) {
    const delta = m.type === "BUY" ? m.net_amount : m.type === "SELL" ? -m.net_amount : 0;
    deltaByDay.set(m.day, (deltaByDay.get(m.day) ?? 0) + delta);
  }
  const out: Array<{ day: string; investido: number }> = [];
  let running = current.v ?? 0;
  for (let i = 0; i < days; i++) {
    const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    out.push({ day, investido: Math.round(running * 100) / 100 });
    running -= deltaByDay.get(day) ?? 0;
  }
  return out.reverse();
}

export function queryInvestmentMovements(investmentId: string): InvestmentMovement[] {
  return db()
    .prepare(
      "SELECT id, investment_id, date, type, net_amount FROM investment_movements WHERE investment_id = ? ORDER BY date DESC",
    )
    .all(investmentId) as InvestmentMovement[];
}

/** Remove entidades que o provedor não devolveu mais. Nomes de tabela/coluna
 * são constantes internas (sem risco de injeção). Cascata: transações, faturas
 * e movimentos das entidades removidas saem junto. */
function pruneTable(table: string, column: string, keepIds: string[]): void {
  // guarda defensiva (mesma de upsertTransactions): resposta VAZIA do
  // provedor não pode limpar o snapshot inteiro.
  if (keepIds.length === 0) return;
  const ph = keepIds.map(() => "?").join(", ");
  db()
    .prepare(`DELETE FROM ${table} WHERE ${column} NOT IN (${ph})`)
    .run(...keepIds);
}

export function pruneConnections(keepIds: string[]): void {
  pruneTable("connections", "item_id", keepIds);
}

export function pruneAccounts(keepIds: string[]): void {
  pruneTable("accounts", "account_id", keepIds);
  pruneTable("transactions", "account_id", keepIds);
  pruneTable("bills", "account_id", keepIds);
}

export function pruneInvestments(keepIds: string[]): void {
  pruneTable("investments", "id", keepIds);
  pruneTable("investment_movements", "investment_id", keepIds);
}

export function pruneLoans(keepIds: string[]): void {
  pruneTable("loans", "id", keepIds);
}
