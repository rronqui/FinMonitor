import * as repo from "@/src/lib/repo";
import { bankError } from "@/src/lib/api";

export async function GET() {
  try {
    const results = repo.readCategories();
    return Response.json({ total: results.length, results });
  } catch (err) {
    return bankError(err);
  }
}
