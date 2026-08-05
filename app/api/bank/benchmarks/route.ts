import { bankError } from "@/src/lib/api";

interface BenchmarksPayload {
  cdiAnnualPct: number | null;
  ipcaAnnualPct: number | null;
  source: string;
  updatedAt: string;
}

interface BcbPoint {
  data: string; // dd/mm/yyyy
  valor: string;
}

const SOURCE = "https://api.bcb.gov.br (séries SGS 432/433)";

function parsePoints(points: BcbPoint[]): Array<{ at: number; v: number }> {
  if (!Array.isArray(points)) return [];
  return points
    .map((p) => {
      const [dd, mm, yyyy] = p.data.split("/");
      return { at: new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd))).getTime(), v: Number(p.valor) };
    })
    .filter((p) => Number.isFinite(p.at) && Number.isFinite(p.v))
    .sort((a, b) => a.at - b.at);
}

/** CDI (série 432): o BCB já informa o valor anualizado — usa a última observação. */
function cdiAnnual(points: BcbPoint[]): number | null {
  const parsed = parsePoints(points);
  return parsed.length > 0 ? parsed[parsed.length - 1].v : null;
}

/** IPCA (série 433): variação mensal — acumula os últimos 12 meses por capitalização. */
function ipcaAnnual(points: BcbPoint[]): number | null {
  const parsed = parsePoints(points);
  if (parsed.length === 0) return null;
  const lastTwelve = parsed.slice(-12);
  const factor = lastTwelve.reduce((acc, p) => acc * (1 + p.v / 100), 1);
  return Math.round((factor - 1) * 10000) / 100;
}

async function fetchSeries(code: number, daily: boolean): Promise<BcbPoint[] | null> {
  try {
    // séries diárias exigem janela explícita; 400 dias cobre os 12 meses + folga
    const ini = new Date(Date.now() - 400 * 86_400_000);
    const dataInicial = `${String(ini.getUTCDate()).padStart(2, "0")}/${String(ini.getUTCMonth() + 1).padStart(2, "0")}/${ini.getUTCFullYear()}`;
    const qs = daily ? `formato=json&dataInicial=${dataInicial}` : "formato=json";
    const res = await fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados?${qs}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as BcbPoint[];
    return Array.isArray(json) ? json : null;
  } catch {
    return null;
  }
}

export async function GET(): Promise<Response> {
  try {
    const [cdi, ipca] = await Promise.all([fetchSeries(432, true), fetchSeries(433, false)]);
    const value: BenchmarksPayload = {
      cdiAnnualPct: cdi ? cdiAnnual(cdi) : null,
      ipcaAnnualPct: ipca ? ipcaAnnual(ipca) : null,
      source: SOURCE,
      updatedAt: new Date().toISOString(),
    };
    return Response.json(value);
  } catch (err) {
    return bankError(err);
  }
}
