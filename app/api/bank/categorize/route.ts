import { updateTransactionCategories } from "@/src/lib/banco-rest";
import * as repo from "@/src/lib/repo";
import { syncAll } from "@/src/lib/sync";
import { bankError, categorizeOutcome, type CategorizeItem } from "@/src/lib/api";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { items: Array<{ transaction_id?: string; category_id?: string }> };
    if (
      !Array.isArray(body.items) ||
      body.items.length === 0 ||
      !body.items.every(
        (it) => typeof it.transaction_id === "string" && it.transaction_id !== "" && typeof it.category_id === "string" && it.category_id !== "",
      )
    ) {
      return Response.json({ error: "items com transaction_id e category_id obrigatórios" }, { status: 400 });
    }
    const payload = await updateTransactionCategories(body.items as CategorizeItem[]);
    const { okItems, error } = categorizeOutcome(payload, body.items as CategorizeItem[]);
    if (okItems.length > 0) {
      repo.applyRecategorization(okItems);
      void syncAll();
    }
    if (error) return Response.json({ error }, { status: 502 });
    return Response.json(payload);
  } catch (err) {
    return bankError(err);
  }
}
