import { startSyncLoop, syncAll } from "@/src/lib/sync";
import { bankError } from "@/src/lib/api";

export async function POST() {
  try {
    startSyncLoop();
    const result = await syncAll();
    if (!result.ok) return Response.json({ error: result.error }, { status: 502 });
    return Response.json({ ok: true });
  } catch (err) {
    return bankError(err);
  }
}
