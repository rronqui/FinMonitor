import * as repo from "@/src/lib/repo";
import { startSyncLoop } from "@/src/lib/sync";
import { bankError } from "@/src/lib/api";

export async function GET() {
  try {
    startSyncLoop();
    return Response.json(repo.syncInfo());
  } catch (err) {
    return bankError(err);
  }
}
