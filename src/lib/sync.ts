import * as bank from "./banco-rest";
import * as repo from "./repo";
import { setMeta } from "./db";
import type { Transaction, TransactionsResult } from "../banco-mcp";

const SYNC_INTERVAL_MS = 30 * 60_000;
const MAX_TX_PAGES = 4;
const RATE_MS = 600; // o provedor aplica rate-limit interno (2 req/s); margem de segurança

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/**
 * Sincroniza o provedor Open Finance → snapshot SQLite.
 * Sequencial e com pausa entre chamadas para respeitar o rate-limit do provedor.
 * Idempotente e serializado: chamadas concorrentes são descartadas.
 */
export async function syncAll(): Promise<{ ok: boolean; error?: string }> {
  if (running) return { ok: false, error: "sync já em andamento" };
  running = true;
  repo.setSyncing(true);
  const startedAt = new Date().toISOString();

  try {
    // Fase 1 — rede: coleta tudo em memória. Uma falha de rede no meio NÃO
    // persiste contas novas com transações antigas (intercalação antiga).
    const connections = await bank.listConnections();
    await sleep(RATE_MS);

    const accounts = await bank.listAccounts();
    const incident = accounts.provider_incident;
    await sleep(RATE_MS);

    const txByAccount: Array<{ type: string; account_id: string; rows: Transaction[] }> = [];
    for (const a of accounts.results ?? []) {
      const first = await bank.listTransactions({ account_id: a.account_id, page: 1, page_size: 500 });
      await sleep(RATE_MS);
      const pages: Array<Promise<TransactionsResult>> = [Promise.resolve(first)];
      const extra = Math.min(first.totalPages ?? 1, MAX_TX_PAGES) - 1;
      for (let i = 0; i < extra; i++) {
        pages.push(bank.listTransactions({ account_id: a.account_id, page: i + 2, page_size: 500 }));
        await sleep(RATE_MS);
      }
      const all = await Promise.all(pages);
      const seen = new Set<string>();
      const rows = all.flatMap((p) => p.results).filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
      txByAccount.push({ type: a.type, account_id: a.account_id, rows });
      await sleep(RATE_MS);
    }

    const billsByAccount: Array<{ account_id: string; rows: Awaited<ReturnType<typeof bank.listBills>>["results"] }> = [];
    for (const a of accounts.results ?? []) {
      if (a.type !== "CREDIT") continue;
      const bills = await bank.listBills({ account_id: a.account_id });
      billsByAccount.push({ account_id: a.account_id, rows: bills.results ?? [] });
      await sleep(RATE_MS);
    }

    const investments = await bank.listInvestments();
    await sleep(RATE_MS);

    const movByInvestment: Array<{ investment_id: string; rows: repo.InvestmentMovement[] }> = [];
    for (const inv of investments.results ?? []) {
      const mov = await bank.listInvestmentTransactions(inv.id);
      movByInvestment.push({
        investment_id: inv.id,
        rows: (mov.results ?? []).map((m) => ({
          id: m.id,
          investment_id: inv.id,
          date: m.date,
          type: m.type,
          net_amount: Number(m.netAmount ?? m.amount ?? 0),
        })),
      });
      await sleep(RATE_MS);
    }

    const itemIds = (connections.connections ?? []).map((c) => c.item_id);
    let loansFlat: repo.StoredLoan[] = [];
    if (itemIds.length > 0) {
      const loans = await bank.listLoans(itemIds);
      loansFlat = (loans.results ?? []).flatMap((g) =>
        (g.results ?? []).map((l) => ({ ...l, _item_id: g.item_id })),
      );
      await sleep(RATE_MS);
    }

    const categories = await bank.listCategories();

    // Fase 2 — escritas repo (sem sleep): aplica TUDO só depois que toda a
    // coleta de rede teve sucesso.
    repo.upsertConnections(connections.connections ?? []);
    setMeta("add_connection_url", connections.add_connection_url ?? "");
    repo.upsertAccounts(accounts.results ?? []);
    const degraded =
      incident && typeof incident === "object" && "degraded" in incident && incident.degraded === true;
    setMeta("provider_degraded", degraded ? "1" : "0");
    for (const t of txByAccount) repo.upsertTransactions(t.type, t.account_id, t.rows);
    for (const b of billsByAccount) repo.upsertBills(b.account_id, b.rows);
    repo.upsertInvestments(investments.results ?? []);
    for (const mv of movByInvestment) repo.upsertInvestmentMovements(mv.rows);
    repo.upsertLoans(loansFlat);
    repo.upsertCategories(categories.results ?? []);

    // Fase 3 — poda: o que o provedor não devolveu mais deixa o snapshot.
    // NÃO podar em modo degradado: resposta parcial pode omitir entidades que
    // continuam existindo (mesma postura defensiva da guarda de lista vazia).
    if (!degraded) {
      repo.pruneConnections(itemIds);
      repo.pruneAccounts((accounts.results ?? []).map((a) => a.account_id));
      repo.pruneInvestments((investments.results ?? []).map((i) => i.id));
      repo.pruneLoans(loansFlat.map((l) => l.id));
    }

    repo.setLastSync(new Date().toISOString());
    repo.setLastSyncError(null);
    repo.logSync(startedAt, "ok");
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    repo.setLastSyncError(msg);
    repo.logSync(startedAt, "error", msg);
    return { ok: false, error: msg };
  } finally {
    repo.setSyncing(false);
    running = false;
  }
}



export function startSyncLoop(): void {
  if (timer) return;
  void syncAll();
  timer = setInterval(() => void syncAll(), SYNC_INTERVAL_MS);
  timer.unref?.();
}
