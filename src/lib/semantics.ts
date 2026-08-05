/**
 * Semântica única de transações, decidida UMA vez na ingestão (sync).
 * Todo consumidor (SQL, UI, assistente) lê `kind`/`valor` — nunca re-deriva sinal.
 */
export type TxKind = "spend" | "income" | "transfer" | "investment";

/** Categorias que movem dinheiro entre contas do próprio usuário (não são consumo). */
export const TRANSFER_CATEGORIES = new Set(["Credit card payment", "Same person transfer"]);

/** Categorias de aporte/resgate — dinheiro muda de forma, não de dono. */
export const INVESTMENT_CATEGORIES = new Set(["Fixed income", "Investments", "Variable income", "Funds"]);

export function classify(
  accountType: string,
  amount: number,
  category?: string | null,
): { kind: TxKind; valor: number } {
  const valor = Math.abs(amount);
  if (category && TRANSFER_CATEGORIES.has(category)) return { kind: "transfer", valor };
  if (category && INVESTMENT_CATEGORIES.has(category)) return { kind: "investment", valor };
  if (accountType === "CREDIT") return { kind: amount > 0 ? "spend" : "income", valor };
  return { kind: amount < 0 ? "spend" : "income", valor };
}

export const KIND_LABEL: Record<TxKind, string> = {
  spend: "Gasto",
  income: "Entrada",
  transfer: "Transferência",
  investment: "Investimento",
};

const CONNECTORS = new Set(["and", "or", "of", "for", "in", "on", "the", "a", "an", "to", "with", "at", "by", "from"]);

/**
 * Fallback de exibição para categoria fora do catálogo (ex.: nova do provedor antes
 * do próximo sync): "taxi and ride-hailing" -> "Taxi And Ride-Hailing".
 * Só para UI — filtros e chaves continuam usando o nome cru do provedor.
 */
export function prettifyCategory(raw: string): string {
  return raw
    .split(/(\s+|-)/)
    .map((part) => {
      const lower = part.toLowerCase();
      if (CONNECTORS.has(lower)) return lower;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join("");
}

/**
 * Normalização da descrição para agrupar recorrências: lowercase, trim,
 * colapso de espaços e remoção de dígitos (nº de cartão, pedido, linha do
 * extrato variam; o nome do estabelecimento não). Persistida como `desc_norm`
 * na ingestão para que filtros SQL usem a MESMA chave da detecção.
 */
export function normalizeDescription(desc: string): string {
  return desc
    .toLowerCase()
    .replace(/[0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
