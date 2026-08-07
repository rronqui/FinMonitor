# Interface Contract: specs004-honest-cash-projection

> **Versão:** 0.2.1
> **Status:** APPROVED

## Escopo

Fronteiras de interface desta entrega:

1. **Contrato interno** `buildProjection()` em `src/lib/analytics.ts` — shape
   de retorno nova `{ days, premissas }` (quebra de assinatura vs 0.1.0;
   único caller: `app/api/bank/projection/route.ts`).
2. **Wire HTTP** `GET /api/bank/projection` — corpo de resposta novo
   `{ days, premissas }` (antes: só `days`).
3. **Contrato do hook** `useProjection` (`src/lib/hooks.ts`) — `premissas`
   opcional na shape tipada.
4. **Comportamento contratual de `detectRecurrents`** — regras de detecção
   consumidas por `/api/bank/recurrents` e `/api/bank/projection`
   (shape de retorno do item inalterada: `key/label/kind/monthly/occurrences/
   deltaPct`; mudam apenas os critérios de inclusão e o cálculo de `monthly`).

Sem mudança de schema de banco, sem novos endpoints, sem mudança de método ou
parâmetros de query (`?days=60`).

## Schemas

### `ProjectionPremissas` (TypeScript — `src/lib/analytics.ts`; shape idêntica duplicada em `src/lib/hooks.ts`)

```ts
export interface ProjectionPremissas {
  recorrentes: Array<{ key: string; label: string; kind: TxKind; monthly: number }>;
  unicos: Array<{ day: string; value: number; label: string }>;
}
```

- `recorrentes`: somente recorrências que projetaram ≥1 delta no horizonte;
  ordem por `monthly` desc (herdada de `detectRecurrents`). **Horizonte** =
  os dias efetivamente cobertos pelo loop de `days`
  (`today .. today+days-1`); uma recorrência só aparece se ao menos uma
  projeção mensal cair dentro desse intervalo.
- `unicos`: balloon payments de loans, label fixo
  `"Parcela única de empréstimo"`; ordenados por `day` asc. Lista **todos**
  os balloon payments conhecidos, independentemente do horizonte pedido
  (intencional — transparência de compromissos contratuais, mesmo fora dos
  `days` exibidos).

### Request

`GET /api/bank/projection?days=60`

- A rota lê **apenas query params** (`url.searchParams`); qualquer body é
  ignorado (GET sem body).
- Query param `days`: número de dias do horizonte — default `60`, clamp
  `1..180` (`Math.min(180, Math.max(1, …))`; não-numérico → default `60`).

### Response (0.2.0)

```json
{
  "days": [
    { "day": "2026-08-07", "saldo": 5900.0 }
  ],
  "premissas": {
    "recorrentes": [
      { "key": "Insurance::mensalidade de seguro porto seguro", "label": "PORTO SEGURO SEGURO", "kind": "spend", "monthly": 555.59 }
    ],
    "unicos": [
      { "day": "2026-08-17", "value": 500, "label": "Parcela única de empréstimo" }
    ]
  }
}
```

O valor de `key` acima é a key **real** produzida por
`recKey(category, description)` = `` `${category}::${normalizeDescription(description)}` ``
para a linha real (category `Insurance`, description
`MENSALIDADE DE SEGURO   PORTO SEGURO`) — `normalizeDescription` faz
lowercase, remove dígitos e colapsa espaços. `label` permanece a descrição
original (não normalizada).

- `days`: `Array<{ day: string (ISO yyyy-mm-dd); saldo: number }>` — inalterado.
- `premissas`: sempre presente na resposta da rota (as listas podem ser
  vazias). No **hook** `useProjection`, o campo é tipado opcional
  (`premissas?`) para compatibilidade com fixtures mockados sem o campo.

### Wire da rota (`app/api/bank/projection/route.ts`)

```ts
const p = buildProjection(days);
return Response.json({ days: p.days, premissas: p.premissas });
```

### Resposta de `/api/bank/recurrents` — shape inalterada

Mudam apenas os critérios de inclusão (RF-001) e o cálculo de `monthly`
(RF-002); a shape do item permanece
`{ key, label, kind, monthly, occurrences, deltaPct }`.

## Erros

| Código | Descrição | Quando |
|---|---|---|
| — | Nenhum erro novo introduzido | Comportamento de erro da rota e de `detectRecurrents` inalterado vs 0.1.0 |

## Estados de UI

| Estado | Descrição |
|---|---|
| Rodapé runway (com `firstNegative`) | `"Caixa em conta cobre compromissos até {dateBR}; a partir daí, depende de resgate de investimentos. "` + sufixo fixo das premissas |
| Rodapé runway (sem `firstNegative`) | `"Caixa em conta cobre os compromissos conhecidos nos próximos 60 dias. "` + sufixo fixo das premissas |
| Sufixo fixo | `"Estimativa só com recorrências comprovadas (≥3 meses estáveis e evidência recente) e pagamentos únicos conhecidos — não é uma fatura futura."` |
| `<details>` de premissas | Renderizado só quando `premissas` existe E (`recorrentes.length > 0` OU `unicos.length > 0`); `<summary>` `"O que entra nesta estimativa"`; itens recorrentes `"{−|+} {brl(monthly)}/mês · {label}"` (sinal `+` quando `kind === "income"`); itens únicos `"− {brl(value)} em {dateBR(day)} · {label}"` |
| Aviso warn (Visão Geral) | `"Caixa em conta fica negativo em {dateBR} ({brl}) — resolva com resgate de investimento."` |
| Recorrentes sem premissas | `premissas?` ausente ou listas vazias → `<details>` não renderiza; rodapé e demais cards inalterados |

## Changelog

| Versão | Data | Mudança |
|---|---|---|
| 0.2.1 | 2026-08-07 | Correções de documentação pós deep-review: exemplo de response usa a `recKey` real (`Insurance::mensalidade de seguro porto seguro`); seção Request reescrita como URL de exemplo (GET lê só query params, body ignorado); horizonte de `premissas.recorrentes` explicitado (`today .. today+days-1`) e `unicos` sem filtro de horizonte (intencional). Sem mudança de comportamento. |
| 0.2.0 | 2026-08-07 | `buildProjection` retorna `{ days, premissas }`; rota responde `{ days, premissas }`; hook tipa `premissas?` opcional; `detectRecurrents` com janela 365 dias + filtros de estabilidade (≥3 meses ±30% da mediana) e recency (≤1 ciclo perdido); `monthly` = mediana das somas mensais; rodapé de runway + `<details>` de premissas; texto do aviso warn reenquadrado. **Status APPROVED** após peer-review sem P0/P1 (entrega: commits `bb0baad`/`a082fcb`/`f568f73`) |
| 0.1.0 | — | Contrato anterior: `buildProjection` retornava só `days`; rota respondia só `days`; janela 120 dias, ≥2 meses distintos, `monthly` = média por ocorrência |
