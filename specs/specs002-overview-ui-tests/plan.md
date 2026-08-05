# Plan: specs002-overview-ui-tests

> **Feature:** `specs002-overview-ui-tests`
> **Spec:** [spec.md](./spec.md)

## Arquitetura

**Novo módulo puro `src/lib/overview.ts`** com as seis funções determinísticas
hoje inline em `app/page.tsx`, movidas VERBATIM — extração **verificada
byte-identical** no peer review (comportamento idêntico; adaptações
autorizadas: `buildAvisos` recebe `today` como parâmetro opcional com default
`new Date()`, para testabilidade — o texto exato das strings PT-BR não muda —
e `loadBudgets` guarda o acesso com `typeof localStorage !== "undefined"`,
equivalente a `typeof window` no browser, necessário para o módulo rodar no
projeto node). Para o texto de faturas em aberto, o módulo importa
`billStatusBadge` de `../components/ui` (caminho relativo) — acoplamento
aceito, sem ciclo (overview → ui → format/semantics):

| Função | Origem em `app/page.tsx` |
|---|---|
| `isCurrentMonth(monthKey)` | linhas 56-59 |
| `loadBudgets()` | linhas 61-68 (key `finmonitor.budgets.v1`, linha 51) |
| `buildFlowData(series, investmentSeries)` | IIFE `flowData`, linhas 388-411 |
| `buildBudgetRows(spentByCat, budgets)` | linhas 437-446 |
| `buildDestaques(args)` | linhas 462-495 |
| `buildAvisos(args)` | linhas 498-523 |

Assinaturas completas em [contracts/interface-contract.md](./contracts/interface-contract.md);
tipos de payload importados de `src/lib/hooks.ts` (`ComparisonsPayload` 288-307,
`InsightsPayload` 154-173, `RecurrentItem` 252-262).

**`app/page.tsx` reescrito**: remove as definições inline e importa de
`@/src/lib/overview`; os wrappers `useMemo` são preservados com as mesmas
dependências; `destaques`/`avisos` passam `labelOf`/dados como argumentos.
**Permanecem em `page.tsx`** (render, não lógica): `CardBody`, `DeltaPill`,
`ComparisonCard`, `RecurrentsCard`. No REFACTOR foi extraído o componente
compartilhado **`KindSelector`** (+ constante `KIND_OPTIONS`): `ComparisonCard`
e `RecurrentsCard` passam a reutilizar o mesmo seletor Gastos/Entradas —
markup 1:1 com o original, sem mudança de comportamento.

**Testes** (dois arquivos, projetos distintos do vitest):

- `src/lib/__tests__/overview.test.ts` — projeto default (ambiente node, alias `@` → raiz).
  Fase RED: importa o módulo ainda inexistente com import guardado + asserção
  de falha (padrão de `src/lib/__tests__/migrations.test.ts`).
- `app/__tests__/page.test.tsx` — projeto `ui` (jsdom + alias `@` → raiz).
  Setup: `vi.mock("next/navigation", …)` (`useRouter` com spy de `push`);
  `vi.mock("@/src/lib/hooks", …)` com factory para os 9 hooks usados pela
  página (`useAccountsBundle`, `useInvestments`, `useInsights`,
  `useCategories`, `useProjection`, `useRecurrents`, `useComparisons`,
  `useBudgetsSpent`, `useSync`); stub `globalThis.ResizeObserver` (exigido
  pelo `ResponsiveContainer` do recharts em jsdom). Primitivas de
  `src/components/ui.tsx` NÃO são mockadas. Testam comportamento JÁ
  IMPLEMENTADO (passam de imediato — guarda de regressão para a extração).

**Infraestrutura:** `jsdom` + `@testing-library/react` +
`@testing-library/dom` em devDependencies com lockfile commitado (sem
mudança). O `vitest.config.ts` foi **ajustado na entrega**: o alias `@` → raiz
absoluta (`path.dirname(fileURLToPath(import.meta.url))`) é declarado **dentro
de cada `defineProject`** (default e `ui`), nunca no topo da config — (a) o
vitest 4 não propaga `resolve` do topo para os projects e (b) o projeto
default também precisa do alias, pois `overview.ts` importa
`../components/ui`, que importa `@/src/lib/format`. O CI
(`.github/workflows/ci.yml`, gate `quality`: `npm ci → typecheck → test →
build`) roda `npm test` e cobre os testes novos automaticamente — nenhuma
mudança no workflow.

## Stack e Dependências

| Componente | Tecnologia | Justificativa |
|---|---|---|
| Runtime | Next.js 16 + React 19 + TypeScript | stack atual do projeto |
| Testes | vitest 4.1.10 (projects), jsdom, @testing-library/react | infra já instalada; ambiente por arquivo só via `projects` nesta versão |
| Render testado | recharts, lucide-react, `src/components/ui.tsx` | reais em jsdom (sem mock); ResizeObserver stub |
| CI | GitHub Actions (`npm ci` → typecheck → test → build) | inalterado; `npm test` já roda os dois projects |

Nenhuma dependência nova é introduzida nesta entrega.

## Arquivos Afetados

| Arquivo | Mudança |
|---|---|
| `src/lib/overview.ts` | **criado** — 6 funções puras extraídas (verificada byte-identical ao original); importa `billStatusBadge` de `../components/ui` |
| `app/page.tsx` | reescrito: definições inline removidas, imports de `@/src/lib/overview`; REFACTOR extraiu `KindSelector` + `KIND_OPTIONS` compartilhados |
| `vitest.config.ts` | ajustado: alias `@` → raiz absoluta declarado dentro de cada `defineProject` (default e `ui`), não no topo |
| `src/lib/__tests__/overview.test.ts` | **criado** — testes unitários da lógica (AC-002..AC-007) |
| `app/__tests__/page.test.tsx` | **criado** — testes de comportamento da página (AC-008, AC-009) |

Inalterados: `.github/workflows/ci.yml`, `src/lib/hooks.ts`,
`src/components/ui.tsx`, `specs/constitution.md`.

## Tarefas Derivadas

| ID | Descrição | AC | Dependências |
|---|---|---|---|
| T-001 | RED: testes da lógica extraída (`overview.test.ts`) | AC-002..AC-007 | — [P] |
| T-002 | Testes da página (`page.test.tsx`, passam de imediato) | AC-001, AC-008, AC-009 | — [P] |
| T-003 | GREEN+REFACTOR: `overview.ts` + reescrita de `page.tsx` | AC-001..AC-010 | T-001, T-002 |

Detalhes, ondas e globs em [tasks.md](./tasks.md).

## Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| recharts exige APIs de browser ausentes em jsdom além de `ResizeObserver` (ex.: `matchMedia`) | render da página falha no teste | stub mínimo no topo do arquivo de teste; último recurso: `vi.mock("recharts", …)` com `ResponsiveContainer` renderizando children num `div` de tamanho fixo — nunca remover o teste por causa do gráfico |
| `@testing-library/react` latest incompatível com React 19 | testes de componente quebram | pinar `@testing-library/react@^16` (suporta React 19, já é a versão instalada) |
| Teste do Passo de página expõe bug pré-existente na página | tentação de "corrigir" junto | NÃO corrigir nesta entrega (mudaria comportamento sem AC); registrar issue nova ao final e anotar no relatório |
| Extração altera comportamento sutilmente (strings, formatação) | regressão invisível | AC-010: testes de página passam antes E depois — prova de equivalência; review checa diff 1:1 |
| `buildAvisos` com `new Date()` solto | teste de datas flaky | `today?: Date` injetado como parâmetro (única adaptação autorizada); default preserva produção |
| Vitest 4 não propaga `resolve` do topo da config para `projects`; projeto default sem alias `@` não resolve a cadeia `overview.ts` → `../components/ui` → `@/src/lib/format` | testes falham por erro de resolução | **ocorreu na entrega**: alias `@` → raiz absoluta declarado dentro de **cada** `defineProject`, nunca no topo |
| `overview.ts` importa `src/components/ui.tsx` (`billStatusBadge`) | acoplamento lib → components, risco de ciclo | aceito: sem ciclo (overview → ui → format/semantics); import relativo `../components/ui` |
| `loadBudgets` executa em ambiente node (projeto default), sem `localStorage` | teste unitário quebra em runtime | guard `typeof localStorage !== "undefined"` (autorizado; equivalente a `typeof window` no browser) |
