import type { ComparisonsPayload, InsightsPayload, RecurrentItem } from "./hooks";
import { brl, dateBR, parseAmount } from "./format";
import { billStatusBadge } from "../components/ui";

export const BUDGETS_KEY = "finmonitor.budgets.v1";
 

export function isCurrentMonth(monthKey: string): boolean {
  const now = new Date();
  return monthKey === `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function loadBudgets(): Record<string, number> {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(BUDGETS_KEY) : null;
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function buildFlowData(
  series: Array<{ accountId: string; name: string; points: Array<{ day: string; saldo: number }> }>,
  investmentSeries: Array<{ day: string; investido: number }>,
): Array<Record<string, number | string>> {
  if (series.length === 0 && investmentSeries.length === 0) {
    return [] as Array<Record<string, number | string>>;
  }
  const byDay = new Map<string, Record<string, number | string>>();
  for (const s of series) {
    for (const p of s.points) {
      const row = byDay.get(p.day) ?? { day: p.day };
      row[s.accountId] = p.saldo;
      byDay.set(p.day, row);
    }
  }
  for (const p of investmentSeries) {
    const row = byDay.get(p.day) ?? { day: p.day };
    row.investimentos = p.investido;
    byDay.set(p.day, row);
  }
  const out = [...byDay.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)));
  for (const row of out) {
    const contas = series.reduce((s, acc) => s + Number(row[acc.accountId] ?? 0), 0);
    row.total = Math.round((contas + Number(row.investimentos ?? 0)) * 100) / 100;
  }
  return out;
}

export function buildBudgetRows(
  spentByCat: Array<{ key: string; spent: number }>,
  budgets: Record<string, number>,
): Array<{ key: string; spent: number; limit: number }> {
  const withBudget = spentByCat
    .filter((s) => (budgets[s.key] ?? 0) > 0)
    .map((s) => ({ ...s, limit: budgets[s.key] }));
  const top = [...spentByCat].sort((a, b) => b.spent - a.spent).slice(0, 5);
  const merged = new Map<string, (typeof withBudget)[number]>();
  for (const r of withBudget) merged.set(r.key, r);
  for (const r of top) if (!merged.has(r.key)) merged.set(r.key, { ...r, limit: budgets[r.key] ?? 0 });
  return [...merged.values()].sort((a, b) => b.spent - a.spent).slice(0, 6);
}

export function buildDestaques(args: {
  comp: ComparisonsPayload | undefined;
  categoryData: Array<{ key: string; valor: number }>;
  recurrents: RecurrentItem[] | undefined;
  firstNegative: { day: string; saldo: number } | undefined;
  labelOf: (key: string) => string;
}): Array<{ icon: "up" | "down" | "warn"; text: string }> {
  const { comp, categoryData, recurrents, firstNegative, labelOf } = args;
  const out: Array<{ icon: "up" | "down" | "warn"; text: string }> = [];
  if (comp) {
    if (comp.rolling.deltaSpendPct !== null) {
      out.push({
        icon: comp.rolling.deltaSpendPct > 0 ? "up" : "down",
        text: `Gastos dos últimos 30 dias ${comp.rolling.deltaSpendPct > 0 ? "subiram" : "caíram"} ${Math.abs(comp.rolling.deltaSpendPct).toFixed(0)}% vs os 30 dias anteriores (${brl(comp.rolling.current.spend)} vs ${brl(comp.rolling.previous.spend)}).`,
      });
    }
    if (comp.sameWindow.deltaSpendPct !== null) {
      out.push({
        icon: comp.sameWindow.deltaSpendPct > 0 ? "up" : "down",
        text: `Mesma janela (${comp.elapsedDays} dias): ${comp.sameWindow.deltaSpendPct > 0 ? "+" : ""}${comp.sameWindow.deltaSpendPct.toFixed(0)}% em gastos vs mês anterior (${brl(comp.sameWindow.current.spend)} vs ${brl(comp.sameWindow.previous.spend)}).`,
      });
    }
  }
  const topCat = [...categoryData].sort((a, b) => b.valor - a.valor)[0];
  if (topCat) out.push({ icon: "down", text: `Maior categoria em 30 dias: ${labelOf(topCat.key)} (${brl(topCat.valor)}).` });
  const biggestRise = [...(recurrents ?? [])]
    .filter((r) => r.kind === "spend" && r.deltaPct !== null && r.deltaPct > 5)
    .sort((a, b) => (b.deltaPct ?? 0) - (a.deltaPct ?? 0))[0];
  if (biggestRise)
    out.push({
      icon: "up",
      text: `Gasto recorrente com ${labelOf(biggestRise.category)} subiu ${biggestRise.deltaPct?.toFixed(0)}% na última recorrência.`,
    });
  if (firstNegative)
    out.push({
      icon: "warn",
      text: `Caixa em conta fica negativo em ${dateBR(firstNegative.day)} (${brl(firstNegative.saldo)}) — resolva com resgate de investimento.`,
    });
  return out.slice(0, 4);
}

export function buildAvisos(args: {
  nextBill: InsightsPayload["nextBill"];
  overdueBills: InsightsPayload["overdueBills"];
  connections: Array<{ status: string; connector_name: string }>;
  disputedCycle: InsightsPayload["disputedCycle"];
  today?: Date;
}): Array<{ tone: "yellow" | "red"; text: string }> {
  const { nextBill, overdueBills, connections, disputedCycle, today = new Date() } = args;
  const out: Array<{ tone: "yellow" | "red"; text: string }> = [];
  if (nextBill?.dueDate) {
    const due = new Date(nextBill.dueDate.slice(0, 10) + "T00:00:00Z");
    const todayMidnightUtc = new Date(today.toISOString().slice(0, 10) + "T00:00:00Z");
    const days = Math.round((due.getTime() - todayMidnightUtc.getTime()) / 86_400_000);
    if (days >= 0 && days <= 3)
      out.push({
        tone: "yellow",
        text: `Fatura de ${brl(nextBill.totalAmount)} vence em ${days} dia(s) (${dateBR(nextBill.dueDate)}).`,
      });
  }
  for (const b of overdueBills) {
    if (disputedCycle && Math.abs(parseAmount(b.totalAmount) - parseAmount(disputedCycle.balance)) <= 15) continue;
    out.push({
      tone: "red",
      text: `Fatura de ${dateBR(b.dueDate)} (${brl(b.totalAmount)}) em aberto: ${billStatusBadge(b.payment_status).label.toLowerCase()}.`,
    });
  }
  for (const c of connections) {
    if (c.status === "LOGIN_ERROR") out.push({ tone: "red", text: `Conexão ${c.connector_name} com erro de login — reconecte.` });
  }
  return out.slice(0, 4);
}
