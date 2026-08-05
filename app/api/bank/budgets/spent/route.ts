import { budgetsSpent } from "@/src/lib/analytics";
import { bankError } from "@/src/lib/api";

export async function GET() {
  try {
    return Response.json(budgetsSpent());
  } catch (err) {
    return bankError(err);
  }
}
