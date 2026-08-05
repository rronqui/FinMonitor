import * as repo from "@/src/lib/repo";
import { getLoanDetail } from "@/src/lib/banco-rest";
import { bankError } from "@/src/lib/api";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { items?: string[]; loan_ids?: string[] };
    if (Array.isArray(body.loan_ids)) {
      // detalhe (taxas, parcelas) existe só no provedor — consulta ao vivo
      return Response.json(await getLoanDetail(body.loan_ids));
    }
    const loans = repo.readLoans();
    const byItem = new Map<string, repo.StoredLoan[]>();
    for (const l of loans) {
      const key = l._item_id ?? "";
      const list = byItem.get(key);
      if (list) list.push(l);
      else byItem.set(key, [l]);
    }
    return Response.json({
      results: [...byItem.entries()].map(([item_id, results]) => ({ item_id, total: results.length, results })),
      errors: [],
    });
  } catch (err) {
    return bankError(err);
  }
}
