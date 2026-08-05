import * as repo from "@/src/lib/repo";
import { bankError } from "@/src/lib/api";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { account_id: string };
    if (!body.account_id) return Response.json({ error: "account_id obrigatório" }, { status: 400 });
    const results = repo.readBills(body.account_id);
    return Response.json({ total: results.length, results, disputed: repo.detectDisputedBills() });
  } catch (err) {
    return bankError(err);
  }
}
