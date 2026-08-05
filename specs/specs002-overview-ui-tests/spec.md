# Spec: specs002-overview-ui-tests

> **Feature:** `specs002-overview-ui-tests`
> **Status:** Approved
> **Autor:** spec-kit-author
> **Data:** 2026-08-05

## Contexto

O item 4 da auditoria segue aberto: `app/page.tsx` é um monólito de ~1220 linhas e
nenhum teste de UI existe no projeto — os 39 testes atuais são todos de `src/lib`,
em ambiente node. Duas consequências: (a) a lógica determinística do dashboard
(fluxo diário, orçamentos, destaques, avisos) vive inline no JSX, sem cobertura e
sem como ser testada isoladamente; (b) o comportamento renderizado da página
principal (estados de loading/erro/vazio, KPIs, interações dos cards) não tem
guarda de regressão.

Esta entrega: instala/usa a infraestrutura de testes de componente (jsdom +
Testing Library via projects do vitest), extrai a lógica determinística do
`OverviewPage` para um módulo puro testável (`src/lib/overview.ts`) e cobre o
comportamento da página principal. **Nenhum comportamento observável da página
muda** — a extração é 1:1 e os testes de página passam antes E depois.

**Issue:** #19 — "Testes de UI da visão geral + extração da lógica do dashboard".

### Decisões já tomadas (registradas)

- **Ambiente jsdom via `projects` do vitest 4** (`vitest.config.ts`): o
  vitest 4 não lê `paths` do tsconfig e `environmentMatchGlobs`/pragma
  `// @vitest-environment jsdom` não existem/são reconhecidos nesta versão.
  Projeto default (node) roda `src/**/*.test.*`; projeto `ui` (jsdom) roda
  `app/**/*.test.tsx`. O alias `@` → raiz absoluta é declarado **dentro de
  cada project** (`defineProject`), nunca no topo da config: o vitest 4 não
  propaga `resolve` do topo para os projects, e o projeto default também
  precisa do alias (`overview.ts` importa `../components/ui`, que importa
  `@/src/lib/format`).
- **Acoplamento `overview.ts` → `src/components/ui.tsx` aceito**: o módulo
  importa `billStatusBadge` de `../components/ui` (caminho relativo) para o
  texto de faturas em aberto — sem ciclo (overview → ui → format/semantics).
- **Componentes de render permanecem em `app/page.tsx`** — `ComparisonCard`
  (102-220), `RecurrentsCard` (223-334), `CardBody` (71-84) e `DeltaPill`
  (86-95) são render, não lógica. Só a lógica pura sai para
  `src/lib/overview.ts`.

## Requisitos Funcionais

- **RF-001:** Infraestrutura de testes de componente operacional: testes em
  `app/**/*.test.tsx` rodam em jsdom com alias `@` resolvido, sem afetar a
  suíte existente em `src/`.
- **RF-002:** Novo módulo puro `src/lib/overview.ts` exportando as seis funções
  determinísticas hoje inline em `app/page.tsx`: `isCurrentMonth`,
  `loadBudgets`, `buildFlowData`, `buildBudgetRows`, `buildDestaques`,
  `buildAvisos` (assinaturas completas em
  [interface-contract.md](./contracts/interface-contract.md)).
- **RF-003:** `app/page.tsx` reescrito para importar essas funções de
  `@/src/lib/overview`, preservando wrappers `useMemo` com as mesmas
  dependências e passando dados/`labelOf` como argumentos.
- **RF-004:** Testes de comportamento da página principal
  (`app/__tests__/page.test.tsx`): gating loading/erro/vazio, KPIs, avisos,
  destaques, e interações (ComparisonCard, RecurrentsCard, orçamentos,
  sincronização).
- **RF-005:** Testes unitários da lógica extraída
  (`src/lib/__tests__/overview.test.ts`), escritos antes do módulo existir
  (RED, import guardado).

## Critérios de Aceite

Matriz AC → tarefa → teste:

| AC | Critério (verificável) | Tarefa(s) | Teste previsto |
|---|---|---|---|
| **AC-001** | A infra roda os testes de `app/**/*.test.tsx` em jsdom (projeto `ui`, alias `@` → `.` resolvido, `vitest.config.ts:5-15`) e os 39 testes pré-existentes de `src/` seguem verdes no projeto default (node) — nenhum teste existente duplicado ou perdido. | T-002 | `npm test` (os dois projects) |
| **AC-002** | `isCurrentMonth(monthKey)` retorna `true` para o mês corrente em UTC (`YYYY-MM`) e `false` para qualquer outro mês (ex.: mês anterior). | T-001 | `src/lib/__tests__/overview.test.ts` |
| **AC-003** | `loadBudgets()` retorna `{}` quando o `localStorage` está vazio, o objeto parseado quando há JSON válido, e `{}` quando o JSON está corrompido — lendo a key `finmonitor.budgets.v1` (`app/page.tsx:51`). | T-001 | `src/lib/__tests__/overview.test.ts` |
| **AC-004** | `buildFlowData(series, investmentSeries)` mescla pontos por dia (contas + chave `investimentos`), ordena por dia e calcula `total` = soma das contas + investimentos com round de 2 casas; séries vazias → `[]`. Comportamento idêntico à IIFE atual (`app/page.tsx:388-411`). | T-001 | `src/lib/__tests__/overview.test.ts` |
| **AC-005** | `buildBudgetRows(spentByCat, budgets)` retorna categorias com orçamento (`limit > 0`) + top 5 sem orçamento (merge sem duplicar chave), ordenado por `spent` desc, com teto de 6 linhas — idêntico a `app/page.tsx:437-446`. | T-001 | `src/lib/__tests__/overview.test.ts` |
| **AC-006** | `buildDestaques(args)`: `rolling.deltaSpendPct > 0` → ícone `up` + "subiram", `≤ 0` → `down` + "caíram"; deltas `null` são pulados; maior categoria sempre entra; maior recorrente de gasto só entra se `deltaPct > 5`; projeção negativa → ícone `warn`; teto de 4 itens — idêntico a `app/page.tsx:462-495`. | T-001 | `src/lib/__tests__/overview.test.ts` |
| **AC-007** | `buildAvisos(args)` recebe `today` injetado (nunca `new Date()` solto nos testes): fatura vencendo em 0–3 dias → aviso `yellow` com contagem; `> 3` dias → nada; cada fatura em aberto → aviso `red`; fatura em aberto com valor ≈ balance do `disputedCycle` (tolerância ≤ 15) é suprimida; conexão `LOGIN_ERROR` → aviso `red`; teto de 4 itens — idêntico a `app/page.tsx:498-523`. | T-001 | `src/lib/__tests__/overview.test.ts` |
| **AC-008** | `OverviewPage` renderiza corretamente com hooks mockados: `bundle.isLoading` → header "Visão Geral" + 4 cards de skeleton sem dados; `bundle.isError` → mensagem do erro + botão de retry; conexões vazias → EmptyState "Nenhuma conexão bancária" + link "Adicionar banco"; happy path → KPIs ("Saldo em conta", "Fatura atual dos cartões", "Investimentos", "Limite disponível") com strings `brl` exatas, avisos e destaques renderizados. | T-002 | `app/__tests__/page.test.tsx` |
| **AC-009** | Interações: `ComparisonCard` — clicar em "Entradas" troca o headline para o valor de income; clicar no nome de uma categoria chama `router.push` com `/transacoes?range=custom` contendo as duas janelas (ou 1 merged quando `prevTo === curFrom`) e `kind=`. `RecurrentsCard` — "Custo fixo ≈ {brl}/mês" soma os spend; toggle "Entradas" filtra para não-spend e mostra EmptyState vazio ("Nenhuma entrada recorrente detectada"). Orçamentos — clicar em "definir limite" abre input; digitar valor + blur persiste o objeto em `localStorage["finmonitor.budgets.v1"]` e a barra mostra percentual. Sincronização — clicar em "Sincronizar agora" chama `sync.mutate`; com `isPending` mostra "Sincronizando…" e fica disabled. | T-002 | `app/__tests__/page.test.tsx` |
| **AC-010** | A extração é comportamento-preservante: os testes de página (AC-008/AC-009) passam **antes E depois** da extração; nenhum texto PT-BR nem formatação (`brl`, `dateBR`, strings de avisos/destaques) muda. `npm test` inteiro verde + `npm run typecheck` limpo. | T-003 | suíte completa (prova de equivalência) |

## Fora de Escopo

- Screenshots / snapshot visual / testes de pixel.
- Outras páginas (`transacoes`, `cartoes`, …).
- Qualquer mudança de comportamento da página (bugs pré-existentes expostos
  por testes viram issue nova, não correção nesta entrega).
- Alteração no workflow de CI (`.github/workflows/ci.yml`) — o gate `quality`
  já roda `npm test` e passa a cobrir os testes novos automaticamente.
- `constitution.md` (já criada em specs001) e `progress.json`/`progress.md`.

## Referências

- Issue #19 (FinMonitor).
- `app/page.tsx` — helpers `isCurrentMonth` (56-59), `loadBudgets` (61-68);
  IIFE `flowData` (388-411), `budgetRows` (437-446), `destaques` (462-495),
  `avisos` (498-523); gating (540-571); KPIs (358-364, 619-630); sync
  (1196-1215); orçamentos (1071-1129).
- `vitest.config.ts` — projects default (node) e `ui` (jsdom), cada um com
  `resolve.alias` `@` → raiz absoluta.
- `src/lib/hooks.ts` — shapes dos payloads a mockar: `AccountsBundle` (48-59),
  `InsightsPayload` (154-173), `ComparisonsPayload` (288-307), `RecurrentItem`
  (252-262), `useSync` (175-194).
- `src/lib/__tests__/migrations.test.ts` — padrão do repo para import guardado
  de módulo inexistente na fase RED.
- [plan.md](./plan.md) · [tasks.md](./tasks.md) ·
  [interface-contract.md](./contracts/interface-contract.md)
