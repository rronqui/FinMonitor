import * as repo from "@/src/lib/repo";
import { getMeta } from "@/src/lib/db";
import { startSyncLoop } from "@/src/lib/sync";
import { bankError } from "@/src/lib/api";

export async function GET() {
  try {
    startSyncLoop();
    const connections = repo.readConnections();
    return Response.json({
      connections,
      count: connections.length,
      add_connection_url: getMeta("add_connection_url") || undefined,
      hint: connections.length === 0 ? "Nenhuma conexão — autorize um banco pelo link." : undefined,
    });
  } catch (err) {
    return bankError(err);
  }
}
