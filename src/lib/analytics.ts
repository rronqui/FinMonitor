import { db } from "./db";
import { parseAmount } from "./format";
import { normalizeDescription, prettifyCategory } from "./semantics";
import type { TxKind } from "./semantics";

const WINDOW_DAYS = 365;

export interface Recurrent {
  key: string;
  label: string;
  category: string;
  monthly: number;
  kind: TxKind;
  descNorm: string;
  occurrences: number;
  lastDate: string;
  deltaPct: number | null;
}

export interface ProjectionPoint {
  day: string;
  saldo: number;
}

export interface ProjectionPremissas {
  recorrentes: Array<{ key: string; label: string; kind: TxKind; monthly: number }>;
  unicos: Array<{ day: string; value: number; label: string }>;
}


/** Arredonda para centavos (evita lixo de ponto flutuante em somas). */
export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function totalsBetween(fromIso: string, toIso: string): Totals {
  const row = db()
    .prepare(
      `SELECT SUM(CASE WHEN kind='spend' THEN abs_amount ELSE 0 END) AS spend,
              SUM(CASE WHEN kind='income' THEN abs_amount ELSE 0 END) AS income
       FROM transactions WHERE date >= ? AND date < ? AND kind IN ('spend','income')`,
    )
    .get(fromIso, toIso) as { spend: number | null; income: number | null };
  return { spend: round2(row.spend ?? 0), income: round2(row.income ?? 0) };
}

function pct(cur: number, prev: number): number | null {
  if (prev <= 0) return null;
  return round2(((cur - prev) / prev) * 100);
}
/** Chave estável de recorrência: categoria + descrição normalizada. */
export function recKey(category: string, description: string): string {
  return `${category}::${normalizeDescription(description)}`;
}

interface RecurrenceAggregate extends Recurrent {
  distinctMonths: number;
  lastDay: number;
}

interface RecurrenceItem {
  day: string;
  abs: number;
  category: string;
  kind: TxKind;
  label: string;
}

/**
 * Recorrências mensais: últimos 12 meses, agrupando (category + descrição
 * normalizada); recorrente = ≥3 meses estáveis dentro de ±30% da mediana e no
 * máximo 1 ciclo mensal perdido desde a última ocorrência. Valor mensal =
 * mediana das somas mensais; projeção repete esse valor no mesmo dia do mês
 * da última ocorrência.
 */
export function detectRecurrents(): RecurrenceAggregate[] {
  const from = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const rows = db()
    .prepare(
      `SELECT t.description, COALESCE(t.category, '') AS category, t.kind, t.abs_amount, substr(t.date, 1, 10) AS day
       FROM transactions t
       WHERE t.kind IN ('spend', 'income') AND t.date >= ?
       ORDER BY t.date ASC`,
    )
    .all(from) as Array<{
    description: string | null;
    category: string;
    kind: TxKind;
    abs_amount: number;
    day: string;
  }>;

  const groups = new Map<string, RecurrenceItem[]>();
  for (const r of rows) {
    const label = r.description ?? "";
    const key = recKey(r.category, label);
    const list = groups.get(key);
    if (list) list.push({ day: r.day, abs: r.abs_amount, category: r.category, kind: r.kind, label });
    else groups.set(key, [{ day: r.day, abs: r.abs_amount, category: r.category, kind: r.kind, label }]);
  }

  const out: RecurrenceAggregate[] = [];
  for (const [key, items] of groups) {
    const months = new Set(items.map((i) => i.day.slice(0, 7)));
    if (months.size < 2) continue;
    // Gastos de frequência variável (corridas, compras avulsas) não são
    // recorrência mensal: exige média de no máximo 3 ocorrências por mês.
    if (items.length / months.size > 3) continue;
    const last = items[items.length - 1];
    // agregado mensal (média de abs_amount por mês) para o deltaPct
    const byMonth = new Map<string, { sum: number; n: number }>();
    for (const i of items) {
      const m = i.day.slice(0, 7);
      const cur = byMonth.get(m) ?? { sum: 0, n: 0 };
      cur.sum += i.abs;
      cur.n += 1;
      byMonth.set(m, cur);
    }
    const sums = [...byMonth.values()].map((v) => v.sum);
    const med = median(sums);
    const stableMonths = sums.filter((s) => s >= 0.7 * med && s <= 1.3 * med).length;
    if (stableMonths < 3) continue;
    const now = new Date();
    const [ly, lm] = last.day.slice(0, 7).split("-").map(Number);
    const missed = now.getFullYear() * 12 + now.getMonth() - (ly * 12 + lm - 1);
    if (missed > 1) continue;
    // agregado mensal (média de abs_amount por mês) para o deltaPct
    const ordered = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    let deltaPct: number | null = null;
    if (ordered.length >= 2) {
      const prev = ordered[ordered.length - 2];
      const curr = ordered[ordered.length - 1];
      const prevAvg = prev[1].sum / prev[1].n;
      const currAvg = curr[1].sum / curr[1].n;
      deltaPct = prevAvg > 0 ? round2(((currAvg - prevAvg) / prevAvg) * 100) : null;
    }
    out.push({
      key,
      label: last.label,
      category: last.category,
      descNorm: normalizeDescription(last.label),
      kind: last.kind,
      monthly: round2(med),
      distinctMonths: months.size,
      occurrences: items.length,
      lastDate: last.day,
      lastDay: Number(last.day.slice(8, 10)),
      deltaPct,
    });
  }
  return out.sort((a, b) => b.monthly - a.monthly);
}

interface LoanBalloonPayment {
  dueDate?: string;
  amount?: { value?: number };
}

/**
 * Saldo projetado dia a dia: soma dos saldos BANK atuais + recorrências
 * mensais detectadas (sinal por kind) + pagamentos únicos conhecidos
 * (balloonPayments dos empréstimos, saída na dueDate).
 */
export function buildProjection(days: number): { days: ProjectionPoint[]; premissas: ProjectionPremissas } {
  const accounts = db()
    .prepare("SELECT type, balance FROM accounts")
    .all() as Array<{ type: string; balance: string | null }>;
  const bankTotal = accounts
    .filter((a) => a.type === "BANK")
    .reduce((s, a) => s + parseAmount(a.balance), 0);

  const deltas = new Map<string, number>();
  const addDelta = (day: string, v: number) => {
    if (!day) return;
    deltas.set(day, (deltas.get(day) ?? 0) + v);
  };
  const premissas: ProjectionPremissas = { recorrentes: [], unicos: [] };

  const horizon = new Date(Date.now() + days * 86_400_000);
  for (const r of detectRecurrents()) {
    const signed = r.kind === "income" ? r.monthly : -r.monthly;
    const anchor = new Date(`${r.lastDate}T00:00:00Z`);
    let y = anchor.getUTCFullYear();
    let m = anchor.getUTCMonth() + 2; // primeira projeção: mês seguinte ao da última ocorrência
    let projectedOccurrences = 0;
    for (let k = 0; k < 12; k++) {
      while (m > 12) {
        m -= 12;
        y += 1;
      }
      const feb = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
      const dim = [31, feb, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
      const dd = new Date(Date.UTC(y, m - 1, Math.min(r.lastDay, dim)));
      if (dd > horizon) break;
      addDelta(dd.toISOString().slice(0, 10), signed);
      projectedOccurrences += 1;
      m += 1;
    }
    if (projectedOccurrences > 0) {
      premissas.recorrentes.push({ key: r.key, label: r.label, kind: r.kind, monthly: r.monthly });
    }
  }

  const loans = db().prepare("SELECT raw FROM loans").all() as Array<{ raw: string }>;
  for (const l of loans) {
    let loan: { balloonPayments?: LoanBalloonPayment[] };
    try {
      loan = JSON.parse(l.raw) as { balloonPayments?: LoanBalloonPayment[] };
    } catch {
      continue;
    }
    for (const bp of loan.balloonPayments ?? []) {
      const value = bp.amount?.value;
      const due = bp.dueDate?.slice(0, 10);
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || !due) continue;
      addDelta(due, -value);
      premissas.unicos.push({ day: due, value, label: "Parcela única de empréstimo" });
    }
  }
  premissas.unicos.sort((a, b) => a.day.localeCompare(b.day));

  const today = new Date();
  const out: ProjectionPoint[] = [];
  let running = bankTotal;
  for (let i = 0; i < days; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    running += deltas.get(day) ?? 0;
    out.push({ day, saldo: round2(running) });
  }
  return { days: out, premissas };
}


/** Gastos do mês corrente por categoria (para budgets). */
export function budgetsSpent(): { month: string; categories: Array<{ key: string; spent: number }> } {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const rows = db()
    .prepare(
      `SELECT COALESCE(t.category, 'Sem categoria') AS key, SUM(t.abs_amount) AS spent
       FROM transactions t
       WHERE t.kind = 'spend' AND substr(t.date, 1, 7) = ?
       GROUP BY key
       ORDER BY spent DESC`,
    )
    .all(month) as Array<{ key: string; spent: number | null }>;
  return {
    month,
    categories: rows.map((r) => ({ key: r.key, spent: round2(r.spent ?? 0) })),
  };
}

export interface CategoryDelta {
  key: string;
  name: string;
  current: number;
  previous: number;
  delta: number;
}

export interface Totals {
  spend: number;
  income: number;
}

export interface WindowComparison {
  current: Totals;
  previous: Totals;
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

function translateName(key: string): string {
  if (key === "Sem categoria") return key;
  const translated = (
    db()
      .prepare("SELECT description_translated FROM categories WHERE description = ?")
      .get(key) as { description_translated: string | null } | undefined
  )?.description_translated?.trim();
  return translated || prettifyCategory(key);
}

function categoriesBetween(fromIso: string, toIso: string, kind: "spend" | "income"): Map<string, number> {
  const rows = db()
    .prepare(
      `SELECT COALESCE(t.category, 'Sem categoria') AS key, SUM(t.abs_amount) AS total
       FROM transactions t
       WHERE t.kind = ? AND t.date >= ? AND t.date < ?
       GROUP BY key`,
    )
    .all(kind, fromIso, toIso) as Array<{ key: string; total: number | null }>;
  return new Map(rows.map((r) => [r.key, r.total ?? 0]));
}

function categoriesDelta(
  curFrom: string,
  curTo: string,
  prevFrom: string,
  prevTo: string,
  kind: "spend" | "income",
): CategoryDelta[] {
  const cur = categoriesBetween(curFrom, curTo, kind);
  const prev = categoriesBetween(prevFrom, prevTo, kind);
  const keys = new Set([...cur.keys(), ...prev.keys()]);
  return [...keys]
    .map((key) => {
      const current = round2(cur.get(key) ?? 0);
      const previous = round2(prev.get(key) ?? 0);
      return { key, name: translateName(key), current, previous, delta: round2(current - previous) };
    })
    .sort((a, b) => b.current - a.current || Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 5);
}

function windowComparison(
  curFrom: string,
  curTo: string,
  prevFrom: string,
  prevTo: string,
): WindowComparison {
  const current = totalsBetween(curFrom, curTo);
  const previous = totalsBetween(prevFrom, prevTo);
  return {
    current,
    previous,
    deltaSpend: round2(current.spend - previous.spend),
    deltaSpendPct: pct(current.spend, previous.spend),
    deltaIncome: round2(current.income - previous.income),
    deltaIncomePct: pct(current.income, previous.income),
    categories: {
      spend: categoriesDelta(curFrom, curTo, prevFrom, prevTo, "spend"),
      income: categoriesDelta(curFrom, curTo, prevFrom, prevTo, "income"),
    },
  };
}
export function comparisons(): ComparisonsPayload {
  const now = new Date();
  const elapsed = now.getUTCDate();
  const curMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const prevWindowEnd = new Date(prevMonthStart.getTime() + elapsed * 86_400_000);
  const prevMonthDays = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).getUTCDate();

  const swCurFrom = curMonthStart.toISOString();
  const swCurTo = now.toISOString();
  const swPrevFrom = prevMonthStart.toISOString();
  const swPrevTo = prevWindowEnd.toISOString();

  const sameWindow = windowComparison(swCurFrom, swCurTo, swPrevFrom, swPrevTo);

  const rolling = windowComparison(
    new Date(now.getTime() - 30 * 86_400_000).toISOString(),
    now.toISOString(),
    new Date(now.getTime() - 60 * 86_400_000).toISOString(),
    new Date(now.getTime() - 30 * 86_400_000).toISOString(),
  );

  const calCurrent = sameWindow.current;
  const calPreviousTotals = totalsBetween(
    prevMonthStart.toISOString(),
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
  );
  const calPrevious = {
    spend: calPreviousTotals.spend,
    income: calPreviousTotals.income,
    days: prevMonthDays,
    spendPerDay: round2(calPreviousTotals.spend / prevMonthDays),
    incomePerDay: round2(calPreviousTotals.income / prevMonthDays),
  };

  return {
    elapsedDays: elapsed,
    sameWindow,
    rolling,
    calendar: {
      current: {
        spend: calCurrent.spend,
        income: calCurrent.income,
        days: elapsed,
        spendPerDay: round2(calCurrent.spend / elapsed),
        incomePerDay: round2(calCurrent.income / elapsed),
      },
      previous: calPrevious,
      deltaSpendPerDayPct: pct(calCurrent.spend / elapsed, calPrevious.spendPerDay),
      deltaIncomePerDayPct: pct(calCurrent.income / elapsed, calPrevious.incomePerDay),
      categories: sameWindow.categories,
    },
  };
}

export interface BillsComparisonPayload {
  accountId: string;
  current: { dueDate: string; total: number } | null;
  previous: { dueDate: string; total: number } | null;
  delta: number | null;
  deltaPct: number | null;
}

/** Fatura fechada (paga) mais recente vs a anterior — comparação 100% completa para crédito. */
export function billsComparison(accountId: string): BillsComparisonPayload {
  const rows = db()
    .prepare(
      `SELECT due_date, total_amount FROM bills
       WHERE account_id = ? AND payment_status = 'PAID'
       ORDER BY due_date DESC LIMIT 2`,
    )
    .all(accountId) as Array<{ due_date: string; total_amount: string }>;
  const current = rows[0] ? { dueDate: rows[0].due_date, total: round2(Number(rows[0].total_amount)) } : null;
  const previous = rows[1] ? { dueDate: rows[1].due_date, total: round2(Number(rows[1].total_amount)) } : null;
  return {
    accountId,
    current,
    previous,
    delta: current && previous ? round2(current.total - previous.total) : null,
    deltaPct: current && previous ? pct(current.total, previous.total) : null,
  };
}
