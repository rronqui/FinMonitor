import { BankAuthError } from "./banco-rest";

/** Shared error mapping for /api/bank/* handlers (lockstep across all routes). */
export function bankError(err: unknown): Response {
  if (err instanceof BankAuthError) return Response.json({ error: err.message }, { status: 401 });
  const msg = err instanceof Error ? err.message : String(err);
  return Response.json({ error: msg }, { status: 502 });
}

export interface CategorizeItem {
  transaction_id: string;
  category_id: string;
}

/** Interpreta o payload do provedor: HTTP 200 com `errors[]` significa recusa
 * (parcial ou total). Devolve só os items aceitos e a mensagem de erro agregada. */
export function categorizeOutcome(
  payload: unknown,
  items: CategorizeItem[],
): { okItems: CategorizeItem[]; error: string | null } {
  const errors = Array.isArray((payload as { errors?: unknown[] } | null)?.errors)
    ? (payload as { errors: Array<{ id?: unknown; message?: unknown }> }).errors
    : [];
  if (errors.length === 0) return { okItems: items, error: null };
  const failed = new Set(errors.map((e) => String(e?.id)));
  const okItems = items.filter((it) => !failed.has(it.transaction_id));
  const msgs = [...new Set(errors.map((e) => String(e?.message ?? "erro desconhecido")))];
  return { okItems, error: msgs.join("; ") };
}
