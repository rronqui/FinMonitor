import { tool, type ToolSet } from "ai";
import { z } from "zod";
import * as bank from "../banco-rest";
import * as repo from "../repo";
import { evaluateExpression } from "./calc";
import { syncAll } from "../sync";

/**
 * Ferramentas do assistente: leituras vêm do snapshot SQLite (rápido, estável,
 * offline-friendly); escritas passam pelo provedor e disparam resync.
 */
export const bankTools = {
  list_connections: tool({
    description:
      "Lista as conexões bancárias Open Finance do usuário (banco, item_id, status). Primeiro passo para quase qualquer pergunta; use para descobrir item_id e se a conexão está saudável.",
    inputSchema: z.object({}),
    execute: async () => JSON.stringify({ connections: repo.readConnections() }),
  }),

  get_connection_status: tool({
    description: "Detalha o status de UMA conexão pelo item_id (executionStatus, produtos, conector). Consulta o provedor ao vivo.",
    inputSchema: z.object({
      item: z.string().describe("item_id da conexão (obtido em list_connections)"),
    }),
    execute: async ({ item }) => JSON.stringify(await bank.getItemStatus(item)),
  }),

  list_accounts: tool({
    description:
      "Lista as contas do usuário (BANK = conta corrente/poupança, CREDIT = cartão de crédito). Retorna account_id, que é OBRIGATÓRIO para list_transactions e list_credit_card_bills. Nunca confunda account_id com item_id.",
    inputSchema: z.object({
      item: z.string().optional().describe("Filtra por item_id da conexão"),
      type: z.enum(["BANK", "CREDIT"]).optional().describe("Filtra por tipo de conta"),
    }),
    execute: async ({ item, type }) => {
      let results = repo.readAccounts();
      if (type) results = results.filter((a) => a.type === type);
      if (item) results = results.filter((a) => a.item_id === item);
      return JSON.stringify({ total: results.length, results });
    },
  }),

  get_accounts_detail: tool({
    description: "Detalhes completos de contas específicas (limite de crédito, vencimento de fatura, pagamento mínimo).",
    inputSchema: z.object({
      account_ids: z.array(z.string()).describe("Lista de account_id (de list_accounts)"),
    }),
    execute: async ({ account_ids }) => {
      const wanted = new Set(account_ids);
      const results = repo
        .readAccounts()
        .filter((a) => wanted.has(a.account_id))
        .map((account) => ({ account_id: account.account_id, account }));
      return JSON.stringify({ results });
    },
  }),
  list_transactions: tool({
    description:
      "Transações de UMA conta; exige account_id obtido via list_accounts. Use from/to ISO YYYY-MM-DD para períodos (ex.: últimos 30 dias). Cada linha traz 'kind' ('spend' = gasto, 'income' = entrada, 'transfer' = transferência entre contas próprias, 'investment' = aporte/resgate) e 'abs_amount' (magnitude positiva). Para total de gastos, prefira get_spend_summary; use esta ferramenta só quando o usuário quiser linhas individuais.",
    inputSchema: z.object({
      account_id: z.string().describe("account_id da conta (de list_accounts)"),
      from: z.string().optional().describe("Data inicial ISO YYYY-MM-DD"),
      to: z.string().optional().describe("Data final ISO YYYY-MM-DD"),
      page_size: z.number().optional().describe("Quantidade por página (máx. 500)"),
      search_queries: z.array(z.string()).optional().describe("Termos de busca por texto"),
    }),
    execute: async ({ account_id, from, to, page_size, search_queries }) =>
      JSON.stringify(
        repo.queryTransactions({
          accountId: account_id,
          from,
          to,
          search: search_queries?.[0],
          page: 1,
          pageSize: Math.min(page_size ?? 100, 500),
        }),
      ),
  }),

  get_spend_summary: tool({
    description:
      "RESUMO PRONTO de gastos (kind='spend', transferências excluídas): total e top 10 por categoria, no período from/to (ISO). Use PRIMEIRO para perguntas de 'quanto gastei' — não some linhas manualmente; deixe a agregação com esta ferramenta. Opcional: account_id para uma conta só.",
    inputSchema: z.object({
      from: z.string().optional().describe("Data inicial ISO YYYY-MM-DD"),
      to: z.string().optional().describe("Data final ISO YYYY-MM-DD"),
      account_id: z.string().optional().describe("Restringe a uma conta (de list_accounts)"),
    }),
    execute: async ({ from, to, account_id }) => {
      const q = { accountId: account_id, from, to };
      const summary = repo.queryTransactionsSummary(q);
      const byCategory = repo.queryCategoryBreakdown({ ...q, kind: "spend" });
      return JSON.stringify({ totalGastos: summary.saidas, totalEntradas: summary.entradas, porCategoria: byCategory });
    },
  }),
  list_credit_card_bills: tool({
    description: "Faturas de UM cartão de crédito (vencimento, valor total, mínimo, status de pagamento). Exige account_id de conta CREDIT.",
    inputSchema: z.object({
      account_id: z.string().describe("account_id do cartão (de list_accounts, tipo CREDIT)"),
    }),
    execute: async ({ account_id }) => {
      const results = repo.readBills(account_id);
      return JSON.stringify({ total: results.length, results });
    },
  }),

  get_credit_card_bill: tool({
    description: "Detalhe de faturas específicas de cartão (pagamentos, encargos). Consulta o provedor ao vivo.",
    inputSchema: z.object({
      bill_ids: z.array(z.string()).describe("Lista de ids de fatura"),
    }),
    execute: async ({ bill_ids }) => JSON.stringify(await bank.getBillDetail(bill_ids)),
  }),

  list_investments: tool({
    description: "Posições de investimento (tipo, valor aplicado amountOriginal, valor de resgate amountWithdrawal, impostos, taxa).",
    inputSchema: z.object({
      item: z.string().optional().describe("Filtra por item_id da conexão"),
      type: z.string().optional().describe("Filtra por tipo (ex.: FIXED_INCOME)"),
    }),
    execute: async ({ type }) => {
      let results = repo.readInvestments();
      if (type) results = results.filter((i) => i.type === type);
      return JSON.stringify({ total: results.length, results });
    },
  }),

  list_loans: tool({
    description: "Empréstimos contratados (tipo, valor contratado, vencimento).",
    inputSchema: z.object({
      items: z.array(z.string()).describe("item_id(s) das conexões (de list_connections)"),
    }),
    execute: async ({ items }) => {
      const wanted = new Set(items);
      const byItem = new Map<string, repo.StoredLoan[]>();
      for (const l of repo.readLoans()) {
        if (l._item_id && !wanted.has(l._item_id)) continue;
        const key = l._item_id ?? "";
        const list = byItem.get(key);
        if (list) list.push(l);
        else byItem.set(key, [l]);
      }
      return JSON.stringify({
        results: [...byItem.entries()].map(([item_id, results]) => ({ item_id, total: results.length, results })),
        errors: [],
      });
    },
  }),

  get_loan_detail: tool({
    description: "Detalhe de contratos de empréstimo específicos (taxas, parcelas). Consulta o provedor ao vivo.",
    inputSchema: z.object({
      loan_ids: z.array(z.string()).describe("Lista de ids de contrato"),
    }),
    execute: async ({ loan_ids }) => JSON.stringify(await bank.getLoanDetail(loan_ids)),
  }),

  list_categories: tool({
    description: "Catálogo de categorias de transação (id e descrição em português). Use quando o usuário quiser recategorizar.",
    inputSchema: z.object({}),
    execute: async () => { const results = repo.readCategories(); return JSON.stringify({ total: results.length, results }); },
  }),

  search_bank_connectors: tool({
    description: "Busca instituições/bancos disponíveis para conectar no Open Finance. Consulta o provedor ao vivo.",
    inputSchema: z.object({
      keywords: z.array(z.string()).describe("Termos da busca (ex.: nome do banco)"),
    }),
    execute: async ({ keywords }) => JSON.stringify(await bank.searchConnectors(keywords)),
  }),

  force_sync: tool({
    description: "Força sincronização de uma ou mais conexões bancárias e atualiza o snapshot local. Ação de escrita: use só quando o usuário pedir para atualizar/sincronizar.",
    inputSchema: z.object({
      items: z.array(z.string()).describe("item_id(s) a sincronizar"),
    }),
    execute: async ({ items }) => { const out = await bank.forceSync(items); void syncAll(); return JSON.stringify(out); },
  }),

  calculate: tool({
    description:
      "Calculadora: avalia expressões aritméticas (números, + - * /, parênteses, vírgula ou ponto decimal). Use SEMPRE para somas, totais, percentuais e médias — nunca calcule de cabeça. Para várias contas de uma vez, use o campo expressions (array de strings); para uma só, expression.",
    inputSchema: z.object({
      expression: z
        .string()
        .optional()
        .describe("Uma expressão, ex.: \"180.77 + 13.38\""),
      expressions: z
        .array(z.string())
        .optional()
        .describe("Várias expressões de uma vez, ex.: [\"180.77 + 13.38\", \"200 / 4\"]"),
    }),
    execute: async ({ expression, expressions }) => {
      const list = expressions && expressions.length > 0 ? expressions : expression ? [expression] : [];
      if (list.length === 0) return JSON.stringify({ error: "nenhuma expressão informada" });
      const results = list.map((e) => {
        try {
          return { expression: e, result: evaluateExpression(e) };
        } catch (err) {
          return { expression: e, error: err instanceof Error ? err.message : String(err) };
        }
      });
      return JSON.stringify(expressions && expressions.length > 0 ? results : results[0]);
    },
  }),
} satisfies ToolSet;
