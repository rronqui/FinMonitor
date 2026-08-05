const brlFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function brl(v: string | number): string {
  return brlFmt.format(Number(v));
}

export function parseAmount(v: string | number | undefined | null): number {
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

export function dateBR(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

export function dateTimeBR(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
