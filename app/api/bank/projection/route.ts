import { buildProjection } from "@/src/lib/analytics";
import { bankError } from "@/src/lib/api";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const raw = Number(url.searchParams.get("days") ?? 60);
    const days = Math.min(180, Math.max(1, Number.isFinite(raw) ? Math.floor(raw) : 60));
    return Response.json({ days: buildProjection(days) });
  } catch (err) {
    return bankError(err);
  }
}
