import { billsComparison } from "@/src/lib/analytics";
import { bankError } from "@/src/lib/api";

export async function GET(req: Request) {
  try {
    const accountId = new URL(req.url).searchParams.get("account_id");
    if (!accountId) return Response.json({ error: "account_id obrigatório" }, { status: 400 });
    return Response.json(billsComparison(accountId));
  } catch (err) {
    return bankError(err);
  }
}
