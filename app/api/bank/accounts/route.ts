import * as repo from "@/src/lib/repo";
import { getMeta } from "@/src/lib/db";
import { startSyncLoop } from "@/src/lib/sync";
import { bankError } from "@/src/lib/api";

export async function GET() {
  try {
    startSyncLoop();
    const accounts = repo.readAccounts();
    const connections = repo.readConnections();
    const provider_incident = { degraded: getMeta("provider_degraded") === "1" };
    return Response.json({
      connections: {
        connections,
        count: connections.length,
        add_connection_url: getMeta("add_connection_url") || undefined,
      },
      accounts: { total: accounts.length, results: accounts, provider_incident },
      details: { results: accounts.map((account) => ({ account_id: account.account_id, account })) },
    });
  } catch (err) {
    return bankError(err);
  }
}
