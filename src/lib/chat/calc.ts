/**
 * Avaliador seguro de expressões aritméticas: números, + - * /, parênteses e unário.
 * Sem eval/Function — parser recursivo próprio.
 */
export function evaluateExpression(src: string): number {
  const s = normalize(src);
  let pos = 0;

  function parseExpr(): number {
    let v = parseTerm();
    while (pos < s.length && (s[pos] === "+" || s[pos] === "-")) {
      const op = s[pos++];
      const r = parseTerm();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }

  function parseTerm(): number {
    let v = parseFactor();
    while (pos < s.length && (s[pos] === "*" || s[pos] === "/")) {
      const op = s[pos++];
      const r = parseFactor();
      if (op === "/") {
        if (r === 0) throw new Error("divisão por zero");
        v = v / r;
      } else {
        v = v * r;
      }
    }
    return v;
  }

  function parseFactor(): number {
    const ch = s[pos];
    if (ch === "-") {
      pos++;
      return -parseFactor();
    }
    if (ch === "+") {
      pos++;
      return parseFactor();
    }
    if (ch === "(") {
      pos++;
      const v = parseExpr();
      if (s[pos] !== ")") throw new Error("parêntese não fechado");
      pos++;
      return v;
    }
    const m = /^(\d+(\.\d+)?|\.\d+)/.exec(s.slice(pos));
    if (!m) throw new Error(`expressão inválida em "${s.slice(pos, pos + 12)}"`);
    pos += m[0].length;
    return Number(m[0]);
  }

  if (s.length === 0) throw new Error("expressão vazia");
  const result = parseExpr();
  if (pos !== s.length) throw new Error(`caractere inesperado "${s[pos]}"`);
  if (!Number.isFinite(result)) throw new Error("resultado não finito");
  return Math.round(result * 1e6) / 1e6;
}

/** Ponto = decimal; vírgula só é aceita como decimal quando não há ponto na expressão. */
function normalize(src: string): string {
  const trimmed = src.replace(/\s+/g, "");
  if (!trimmed.includes(".") && trimmed.includes(",")) return trimmed.replaceAll(",", ".");
  return trimmed;
}
