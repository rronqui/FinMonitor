# Tasks: specs002-overview-ui-tests

> Deriva de [plan.md](./plan.md). Convenções: `[P]` = paralelizável.
> Padrões do repo: import guardado de módulo inexistente na fase RED —
> `src/lib/__tests__/migrations.test.ts`; testes de componente em jsdom com
> stubs de `next/navigation`/`@/src/lib/hooks` e `ResizeObserver`
> (`vitest.config.ts` define os projects default e `ui`, cada um com alias
> `@` → raiz).

## Onda 1 — (paralelo, globs disjuntos)

| ID | Descrição | AC | Dependências | Globs permitidos | Status |
|---|---|---|---|---|---|
| T-001 [P] | **test-author, RED** — criar `src/lib/__tests__/overview.test.ts` (projeto default, ambiente node) testando o módulo `src/lib/overview.ts` AINDA INEXISTENTE: os testes devem falhar por import guardado + asserção (padrão de `migrations.test.ts`). Casos: `isCurrentMonth` mês corrente UTC → true / mês anterior → false (AC-002); `loadBudgets` vazio → `{}`, JSON válido → parseado, JSON corrompido → `{}` na key `finmonitor.budgets.v1` (AC-003); `buildFlowData` mescla por dia, ordena, `total` = contas + investimentos com round de 2 casas, vazio → `[]` (AC-004); `buildBudgetRows` orçamento (>0) + top 5 sem orçamento sem duplicar, `spent` desc, teto 6 (AC-005); `buildDestaques` up "subiram" delta>0, down "caíram" ≤0, pula null, maior categoria entra, recorrente só >5%, projeção negativa warn, teto 4 (AC-006); `buildAvisos` com `today` injetado — vencendo 0–3 dias yellow com contagem, >3 nada, em aberto red, ≈ disputedCycle (tolerância ≤15) suprimida, LOGIN_ERROR red, teto 4 (AC-007). | AC-002, AC-003, AC-004, AC-005, AC-006, AC-007 | — | `src/lib/__tests__/overview.test.ts` | CONCLUÍDO |
| T-002 [P] | **test-author** — criar `app/__tests__/page.test.tsx` (project `ui`, jsdom + alias): `vi.mock("next/navigation")` (`useRouter` com spy de `push`), `vi.mock("@/src/lib/hooks")` com factory para os 9 hooks usados pela página e helpers `ok(data)`/`loading()`/`error(msg)`, stub `globalThis.ResizeObserver`; fixtures com valores pequenos e redondos para assertar a formatação `brl`. Casos: infra roda em jsdom sem quebrar os 39 testes existentes do projeto default (AC-001); loading → header "Visão Geral" + 4 skeletons sem dados; erro → mensagem + botão de retry; conexões vazias → EmptyState "Nenhuma conexão bancária" + link "Adicionar banco"; happy path com KPIs ("Saldo em conta", "Fatura atual dos cartões", "Investimentos", "Limite disponível") com strings `brl` exatas + avisos/destaques (AC-008); interações — ComparisonCard troca kind e drill-down navega (2 janelas ou 1 merged quando `prevTo === curFrom`, com `kind=`), RecurrentsCard soma "Custo fixo ≈ {brl}/mês" e toggle "Entradas" filtra + EmptyState vazio, orçamentos persistem em `localStorage["finmonitor.budgets.v1"]` e barra mostra percentual, "Sincronizar agora" chama `sync.mutate` e estado pending mostra "Sincronizando…" disabled (AC-009). Passam de imediato (comportamento já implementado — guarda de regressão para a extração do T-003). | AC-001, AC-008, AC-009 | — | `app/__tests__/page.test.tsx` | CONCLUÍDO |

> **RED_REVISION (T-001):** a expectativa do teste `sameWindow` do
> `buildDestaques` foi corrigida durante a fase RED para o formato real —
> `±X% em gastos vs mês anterior` (sem "subiram/caíram", que pertence apenas
> ao destaque `rolling`) — após conferência 1:1 com o código de origem.

## Onda 2 — GREEN+REFACTOR (serial, depende da onda 1)

| ID | Descrição | AC | Dependências | Globs permitidos | Status |
|---|---|---|---|---|---|
| T-003 | **backend-developer, GREEN+REFACTOR** — criar `src/lib/overview.ts` movendo VERBATIM as 6 funções de `app/page.tsx` (`isCurrentMonth` 56-59, `loadBudgets` 61-68, fluxo diário 388-411, `budgetRows` 437-446, `destaques` 462-495, `avisos` 498-523; única adaptação: `buildAvisos` recebe `today?: Date` com default `new Date()`); reescrever `app/page.tsx` para importar de `@/src/lib/overview` mantendo wrappers `useMemo` com as mesmas dependências — até `npm test` inteiro verde (39 existentes + T-001 agora verdes + T-002 segue verde — prova de equivalência AC-010) e `npm run typecheck` limpo. **Sem alterar testes** (read-only nesta fase). Componentes de render permanecem em `page.tsx`. | AC-001, AC-002, AC-003, AC-004, AC-005, AC-006, AC-007, AC-008, AC-009, AC-010 | T-001, T-002 | `src/lib/overview.ts`, `app/page.tsx` | CONCLUÍDO |

> **Resultado da execução:** suíte completa 64/64 verde (39 no projeto default
> + 14 em `overview.test.ts` + 11 em `page.test.tsx`), `npm run typecheck` sem
> erros, peer review APROVADO — extração principal verificada byte-identical;
> REFACTOR extraiu `KindSelector` (+ `KIND_OPTIONS`) compartilhado em
> `app/page.tsx` com markup 1:1.

## Fora de Escopo

- Screenshots / snapshot visual / testes de pixel.
- Outras páginas (`transacoes`, `cartoes`, …).
- Mudança de comportamento da página (bug pré-existente exposto por teste →
  issue nova ao final, não correção aqui).
- Alteração em `.github/workflows/ci.yml` e `constitution.md`. (O
  `vitest.config.ts` recebeu ajuste pontual documentado — alias `@` dentro de
  cada project — ver [plan.md](./plan.md).)
