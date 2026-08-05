import { detectRecurrents } from "@/src/lib/analytics";
import { bankError } from "@/src/lib/api";

export async function GET() {
  try {
    const recorrentes = detectRecurrents().map((r) => ({
      key: r.key,
      label: r.label,
      category: r.category,
      kind: r.kind,
      descNorm: r.descNorm,
      monthly: r.monthly,
      occurrences: r.occurrences,
      lastDate: r.lastDate,
      deltaPct: r.deltaPct,
    }));
    return Response.json({ recorrentes });
  } catch (err) {
    return bankError(err);
  }
}
