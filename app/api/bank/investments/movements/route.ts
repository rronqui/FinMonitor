import * as repo from "@/src/lib/repo";
import { bankError } from "@/src/lib/api";

export async function GET(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get("investment_id");
    if (!id) return Response.json({ error: "investment_id obrigatório" }, { status: 400 });
    return Response.json({ results: repo.queryInvestmentMovements(id) });
  } catch (err) {
    return bankError(err);
  }
}
