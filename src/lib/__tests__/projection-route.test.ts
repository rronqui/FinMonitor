import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type * as dbTypes from "../db";
import type * as repoTypes from "../repo";

let tmpDir: string;
let dbMod: typeof dbTypes;
let repo: typeof repoTypes;
let route: typeof import("../../../app/api/bank/projection/route");

const now = new Date();
const dayInMonth = (monthsBack: number, dayOfMonth: number) =>
  new Date(now.getFullYear(), now.getMonth() - monthsBack, dayOfMonth, 12).toISOString();

const tx = (id: string, date: string, description: string) => ({
  id,
  date,
  description,
  amount: "-100.00",
  category: "streaming",
});

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "finmonitor-test-"));
  process.env.FINMONITOR_DB_PATH = path.join(tmpDir, "test.db");
  // db.ts lê FINMONITOR_DB_PATH no load do módulo; a rota deve ser importada somente depois.
  dbMod = await import("../db");
  repo = await import("../repo");
  dbMod
    .db()
    .prepare("INSERT INTO accounts (account_id, type, raw, balance) VALUES (?, 'BANK', '{}', ?)")
    .run("acc-projection-route", "1000");

  const description = "ROUTE PROJECTION ASSINATURA";
  const rows = [5, 4, 3, 2, 1, 0].map((m) =>
    tx(`projection-route-${m}`, dayInMonth(m, 10), description),
  );
  repo.upsertTransactions("BANK", "acc-projection-route", rows as never[]);

  route = await import("../../../app/api/bank/projection/route");
});

afterAll(() => {
  dbMod.db().close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("GET /api/bank/projection — wire das premissas", () => {
  it("RF-004/RF-005: retorna dias e premissas recorrentes e únicas", async () => {
    const res = await route.GET(new Request("http://localhost/api/bank/projection?days=60"));
    const body = (await res.json()) as {
      days: Array<{ day: string; saldo: number }>;
      premissas?: {
        recorrentes: Array<{ key: string; label: string; kind: string; monthly: number }>;
        unicos: Array<{ day: string; value: number; label: string }>;
      };
    };

    expect(Array.isArray(body.days)).toBe(true);
    expect(body.days).toHaveLength(60);
    expect(body.premissas).toBeDefined();
    expect(body.premissas?.recorrentes).toHaveLength(1);
    expect(body.premissas?.recorrentes[0]?.monthly).toBe(100);
    expect(body.premissas?.unicos).toEqual([]);
  });
});
