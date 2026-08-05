import { disconnectBank } from "@/src/lib/banco-rest";
import { syncAll } from "@/src/lib/sync";
import { bankError } from "@/src/lib/api";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { item: string; confirm: boolean };
    if (body.confirm !== true) {
      return Response.json({ error: "confirmação obrigatória (confirm: true)" }, { status: 400 });
    }
    const payload = await disconnectBank(body.item);
    void syncAll();
    return Response.json(payload);
  } catch (err) {
    return bankError(err);
  }
}
