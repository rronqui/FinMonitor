# Interface Contract: specs002-overview-ui-tests

> **Versão:** 0.1.1
> **Status:** NA (justificativa abaixo)

## Escopo

Mudança estritamente interna ao frontend: extração da lógica determinística do
`OverviewPage` (`app/page.tsx`) para um módulo puro (`src/lib/overview.ts`) +
testes de componente em jsdom.

## Justificativa do NA

Nenhuma fronteira de interface é criada ou alterada: nenhuma API HTTP, nenhum
formato externo de dados e nenhum comportamento observável da página muda. As
rotas `/api/bank/*` consumidas pelos hooks permanecem idênticas
(`src/lib/hooks.ts`); o HTML/texto renderizado pela Visão Geral é o mesmo
antes e depois (AC-010). Não há request/response, erros de API ou estados de
UI novos a contratar — o contrato relevante é a superfície interna do módulo
extraído, registrada abaixo.

## Superfície interna afetada

Assinaturas exportadas do novo módulo (tipos importados de `src/lib/hooks.ts`):

```ts
// src/lib/overview.ts
import type { ComparisonsPayload, InsightsPayload, RecurrentItem } from "@/src/lib/hooks";

export function isCurrentMonth(monthKey: string): boolean;

export function loadBudgets(): Record<string, number>;

export function buildFlowData(
  series: Array<{ accountId: string; name: string; points: Array<{ day: string; saldo: number } }>,
  investmentSeries: Array<{ day: string; investido: number }>,
): Array<Record<string, number | string>>;

export function buildBudgetRows(
  spentByCat: Array<{ key: string; spent: number }>,
  budgets: Record<string, number>,
): Array<{ key: string; spent: number; limit: number }>;

export function buildDestaques(args: {
  comp: ComparisonsPayload | undefined;
  categoryData: Array<{ key: string; valor: number }>;
  recurrents: RecurrentItem[] | undefined;
  firstNegative: { day: string; saldo: number } | undefined;
  labelOf: (key: string) => string;
}): Array<{ icon: "up" | "down" | "warn"; text: string }>;

export function buildAvisos(args: {
  nextBill: InsightsPayload["nextBill"];
  overdueBills: InsightsPayload["overdueBills"];
  connections: Array<{ status: string; connector_name: string }>;
  disputedCycle: InsightsPayload["disputedCycle"];
  today?: Date; // única adaptação vs código inline; default new Date()
}): Array<{ tone: "yellow" | "red"; text: string }>;
```

Notas:

- `InsightsPayload["nextBill"]` é `Bill | null`, `["overdueBills"]` é `Bill[]`
  e `["disputedCycle"]` é `{ accountName; balance; paymentDate; paymentAmount } | null`
  (`src/lib/hooks.ts:161-164`).
- `ComparisonsPayload` (288-307) e `RecurrentItem` (252-262) de
  `src/lib/hooks.ts`.
- Textos PT-BR e formatação (`brl`, `dateBR`, `billStatusBadge`) saem
  inalterados de `app/page.tsx` — extração 1:1 (AC-010).
- `app/page.tsx` mantém a mesma exportação pública (`export default
  function OverviewPage()`); nenhuma prop/rota muda.

## Schemas

NA — sem request/response.

## Erros

NA — sem API.

## Estados de UI

NA — nenhum estado novo; os estados existentes da página (loading/skeletons,
erro com retry, vazio sem conexões, happy path, pending de sincronização) são
apenas **testados**, não alterados (AC-008, AC-009).

## Changelog

| Versão | Data | Mudança |
|---|---|---|
| 0.1.0 | 2026-08-05 | Documento inicial: status NA justificado; superfície interna `src/lib/overview.ts` (6 assinaturas) registrada |
| 0.1.1 | 2026-08-05 | Registro pós-entrega (status NA permanece): (1) `vitest.config.ts` — alias `@` → raiz absoluta declarado **dentro de cada project** (`defineProject`), não no topo da config (vitest 4 não propaga `resolve` do topo; projeto default também precisa do alias, pois `overview.ts` → `../components/ui` → `@/src/lib/format`); (2) REFACTOR extraiu `KindSelector` + `KIND_OPTIONS` compartilhados em `app/page.tsx`, reutilizados por `ComparisonCard`/`RecurrentsCard`, markup 1:1; (3) `overview.ts` importa `billStatusBadge` de `../components/ui` (caminho relativo) — acoplamento aceito, sem ciclo (overview → ui → format/semantics); (4) `loadBudgets` usa guard `typeof localStorage !== "undefined"` (autorizado; equivalente a `typeof window` no browser) |
