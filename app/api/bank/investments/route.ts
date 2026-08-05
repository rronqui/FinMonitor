import * as repo from "@/src/lib/repo";
import { bankError } from "@/src/lib/api";

export async function GET() {
  try {
    const results = repo.readInvestments();
    return Response.json({ total: results.length, page: 1, totalPages: 1, results });
  } catch (err) {
    return bankError(err);
  }
}
