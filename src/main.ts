import { BancoMcpClient } from "./banco-mcp.js";

try {
  process.loadEnvFile();
} catch {
  // Sem .env — o token pode vir do ambiente.
}

const token = process.env.MCP_AI_TOKEN;
if (!token) {
  console.log("Defina MCP_AI_TOKEN no arquivo .env");
  process.exit(1);
}

const client = new BancoMcpClient(token);

async function main(): Promise<void> {
  console.log("[1/5] Conectando ao servidor Banco MCP…");
  await client.connect();
  console.log("Sessão MCP estabelecida");

  console.log("[2/5] Autenticando…");
  const authMsg = await client.authenticate();
  console.log(authMsg);

  console.log("[3/5] Solicitando conexões Open Finance…");
  const connectMsg = await client.requestConnect();
  console.log(connectMsg);

  console.log("[4/5] Consultando dados bancários…");
  const connections = await client.listConnections();
  for (const c of connections.connections ?? []) {
    console.log(`Conexão: ${c.connector_name} | item=${c.item_id} | status=${c.status}`);
  }
  if ((connections.count ?? 0) === 0) {
    console.log("Nenhuma conexão bancária — abra o link do passo 4 e autorize");
    return;
  }

  const first = connections.connections[0];
  const itemStatus = await client.getItemStatus(first.item_id);
  console.log(`Item ${itemStatus.id}: status=${itemStatus.status} execution=${itemStatus.executionStatus}`);

  const accounts = await client.listAccounts();
  for (const a of accounts.results ?? []) {
    console.log(`Conta: ${a.name} | ${a.type}/${a.subtype} | nº ${a.number} | saldo ${a.balance} ${a.currencyCode}`);
  }

  console.log("[5/5] Extraindo transações e faturas…");
  const bankAccounts = (accounts.results ?? []).filter((a) => a.type === "BANK");
  const creditAccounts = (accounts.results ?? []).filter((a) => a.type === "CREDIT");

  if (bankAccounts[0]) {
    const bank = bankAccounts[0];
    const tx = await client.listTransactions(bank.account_id, { pageSize: 5 });
    console.log(`Transações (${bank.name}): total=${tx.total} páginas=${tx.totalPages}`);
    for (const t of (tx.results ?? []).slice(0, 5)) {
      console.log(`  ${t.date} | ${t.description} | ${t.amount}`);
    }
  }

  if (creditAccounts[0]) {
    const credit = creditAccounts[0];
    const bills = await client.listCreditCardBills(credit.account_id, { pageSize: 3 });
    console.log(`Faturas (${credit.name}): total=${bills.total}`);
    for (const b of (bills.results ?? []).slice(0, 3)) {
      console.log(`  ${b.dueDate} | ${b.totalAmount} | ${b.payment_status ?? ""}`);
    }
  }
}

main()
  .then(() => {
    console.log("OK — fluxo completo concluído");
  })
  .catch(async (err) => {
    console.log(`ERRO: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.close();
  });
