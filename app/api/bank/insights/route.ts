import * as repo from "@/src/lib/repo";
import { parseAmount } from "@/src/lib/format";
import { bankError } from "@/src/lib/api";
import type { Bill } from "@/src/banco-mcp";

export interface InsightsPayload {
  categories: Array<{ key: string; name: string; valor: number }>;
  series: Array<{ accountId: string; name: string; points: Array<{ day: string; saldo: number }> }>;
  latest: ReturnType<typeof repo.queryLatest>;
  monthly: repo.MonthlyStats[];
  investmentSeries: Array<{ day: string; investido: number }>;
  openBill: { accountName: string; balance: string; dueDate?: string; minimumPayment?: string } | null;
  nextBill: Bill | null;
  overdueBills: Bill[];
  disputed: Record<string, { paymentDate: string; paymentAmount: number }>;
  /** soma de saldos em aberto dos cartões, descontando faturas contestadas embutidas */
  creditOpenTotal: number;
  /** ciclo aberto que embute fatura contestada (pagamento registrado no banco) */
  disputedCycle: { accountName: string; balance: string; paymentDate: string; paymentAmount: number } | null;
}

function dayList(days: number): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

/** Maior fatura contestada cujo valor caiba no saldo do cartão. */
function embeddedDisputed(
  balance: number,
  overdueBills: Bill[],
  disputed: Record<string, { paymentDate: string; paymentAmount: number }>,
): Bill | undefined {
  return overdueBills
    .filter((b) => disputed[b.id] && parseAmount(b.totalAmount) <= balance)
    .sort((x, y) => parseAmount(y.totalAmount) - parseAmount(x.totalAmount))[0];
}

export async function GET() {
  try {
    const accounts = repo.readAccounts();
    const bankAccounts = accounts.filter((a) => a.type === "BANK");

    const series = bankAccounts.map((a) => {
      const deltas = new Map(repo.queryDailyDeltas(a.account_id, 90).map((d) => [d.day, d.delta]));
      const days = dayList(90);
      // caminhada reversa a partir do saldo atual conhecido
      const reversed: Array<{ day: string; saldo: number }> = [];
      let running = parseAmount(a.balance);
      for (const day of [...days].reverse()) {
        reversed.push({ day, saldo: Math.round(running * 100) / 100 });
        running -= deltas.get(day) ?? 0;
      }
      return { accountId: a.account_id, name: a.name, points: reversed.reverse() };
    });

    const creditAccounts = accounts.filter((a) => a.type === "CREDIT");
    const allBills = creditAccounts.flatMap((a) => repo.readBills(a.account_id));
    const today = new Date().toISOString().slice(0, 10);

    const future = allBills
      .filter((b) => (b.dueDate?.slice(0, 10) ?? "") >= today)
      .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
    const nextBill = future[0] ?? null;

    const overdueBills = allBills
      .filter((b) => b.payment_status === "PAST_DUE_UNPAID" || b.payment_status === "PAST_DUE_UNCONFIRMED")
      .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));

    const disputed = repo.detectDisputedBills();

    // fatura em aberto por cartão, descontando fatura contestada embutida no saldo
    const openByCard = creditAccounts
      .filter((a) => parseAmount(a.balance) > 0)
      .map((a) => {
        const bal = parseAmount(a.balance);
        const emb = embeddedDisputed(bal, overdueBills, disputed);
        return { account: a, bal, emb };
      });

    const creditOpenTotal = openByCard.reduce(
      (s, o) => s + Math.max(0, o.bal - (o.emb ? parseAmount(o.emb.totalAmount) : 0)),
      0,
    );

    const top = [...openByCard].sort((a, b) => b.bal - a.bal)[0];
    const openBill =
      top && !top.emb
        ? {
            accountName: top.account.name,
            balance: top.account.balance,
            dueDate: top.account.creditData?.balanceDueDate,
            minimumPayment: top.account.creditData?.minimumPayment,
          }
        : null;

    const disputedCard = openByCard.find((o) => o.emb);
    const disputedCycle = disputedCard
      ? {
          accountName: disputedCard.account.name,
          balance: disputedCard.account.balance,
          paymentDate: disputed[disputedCard.emb!.id].paymentDate,
          paymentAmount: disputed[disputedCard.emb!.id].paymentAmount,
        }
      : null;
    return Response.json({
      categories: repo.queryCategoryTotals(30, 8),
      series,
      latest: repo.queryLatest(8),
      monthly: repo.queryMonthlyStats(6),
      investmentSeries: repo.queryInvestmentSeries(90),
      openBill,
      nextBill,
      overdueBills,
      disputed,
      creditOpenTotal,
      disputedCycle,
    } satisfies InsightsPayload);
  } catch (err) {
    return bankError(err);
  }
}
