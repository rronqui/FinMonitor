import { comparisons } from "@/src/lib/analytics";
import { bankError } from "@/src/lib/api";

export async function GET() {
  try {
    return Response.json(comparisons());
  } catch (err) {
    return bankError(err);
  }
}
