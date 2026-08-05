# Plan: specs003-ui-tests-telas

> **Feature:** `specs003-ui-tests-telas`
> **Spec:** [spec.md](./spec.md)

## Arquitetura

Entrega **estritamente de testes**: 8 arquivos de teste novos em jsdom + 2
edições de `include` no `vitest.config.ts`. Nenhum código de produção é
criado, movido ou alterado — a lógica das 5 telas restantes é de
render/filtro e é testável via DOM (diferente da specs002, que precisou
extrair a lógica do monólito de ~1220 linhas; aqui não há extrações).

**Config (T-001, pré-requisito):** duas mudanças obrigatórias e acopladas em
`vitest.config.ts`. Se apenas a primeira for feita, o vitest 4 roda cada
teste de componente DUAS VEZES — verificado nesta feature contra o código do
vitest 4.1.10: `globTestFiles` resolve `include` por projeto
independentemente, então um arquivo pode pertencer a mais de um projeto
(hoje só não há duplicidade porque nenhum `.test.tsx` existe em `src/`):

| Projeto | Antes | Depois | Motivo |
|---|---|---|---|
| `ui` (jsdom), `vitest.config.ts:17` | `["app/**/*.test.tsx"]` | `["app/**/*.test.tsx", "src/components/**/*.test.tsx"]` | novos testes junto dos componentes |
| default (node), `vitest.config.ts:11` | `["src/**/*.test.*"]` | `["src/lib/**/*.test.*"]` | o include antigo casaria os novos `.test.tsx` de `src/components` e os duplicaria no ambiente node (onde quebrariam) |

Nada mais muda na config: ambiente jsdom do projeto `ui` e o alias `@` →
raiz dentro de cada `defineProject` já estão corretos (decisão da specs002).

**Padrão de teste** (copiar de `app/__tests__/page.test.tsx`): estado
`vi.hoisted` + `vi.mock("@/src/lib/hooks", () => factory)` + helpers
`ok(data)`/`loading()`/`error(msg)` + `afterEach(cleanup)` de
`@testing-library/react`. **Proibidos:** snapshots e asserts de className
decorativo (constituição art. 5). Asserts de cor semântica (`text-pos`,
`text-neg`, `text-primary`, `text-muted`) são permitidos — são o contrato
observável de `Stat`/`AmountByKind`, não decoração.

**Strings formatadas:** expectativas de valor monetário/data SEMPRE
construídas com `brl()`/`dateBR()`/`dateTimeBR()` importados de
`@/src/lib/format` — o `Intl` pt-BR emite NBSP (`U+00A0`) e qualquer string
hardcoded quebra. Exceção única: deltas percentuais construídos com
`toFixed(1).replace(".", ",")` (ex.: `"+20,0%"` em `BillsComparisonCard`),
assertados como literal porque não passam por `brl`.

**Política de mocks:**

- Hooks de dados mockados em `@/src/lib/hooks` (nunca `fetch` quando o hook
  é mockado). Primitivas de `src/components/ui.tsx` NÃO são mockadas nos
  testes de tela — badges (`connectionStatusBadge`, `billStatusBadge`) e
  `ErrorState`/`EmptyState` são exercidos de verdade.
- Exceção única: `LoanDetail` (`app/emprestimos/page.tsx`) usa `useQuery` +
  `fetch` diretamente → envolver em `QueryClientProvider` com
  `new QueryClient({ defaultOptions: { queries: { retry: false } } })` e
  mockar `globalThis.fetch`.
- `chat-dock.tsx` importa `ai` e `@ai-sdk/react` → mockar ambos
  (`DefaultChatTransport` como classe stub; `useChat` como factory que
  devolve estado hoisted e captura `opts`).
- telas com recharts (`transacoes` BarChart, `investimentos` PieChart) →
  stub `globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }`.
- `sidebar.tsx` lê `process.env.NEXT_PUBLIC_APP_VERSION`, que o Next NÃO
  injeta no vitest → o teste seta o valor manualmente
  (`"0.0.0-test"`) antes do render.

**Fase RED → VALIDATE:** todo o código testado já existe, então os testes
devem passar de imediato; a entrega segue a rota documentada de
comportamento já implementado (VALIDATE). Falha nessa fase = bug real de
produção (→ issue nova via `ship.mjs new --bug`, sem correção aqui) ou
teste errado (corrigir o teste, nunca enfraquecer).

## Stack e Dependências

| Componente | Tecnologia | Justificativa |
|---|---|---|
| Runtime | Next.js 16 + React 19 + TypeScript | stack atual do projeto |
| Testes | vitest 4.1.10 (projects: default node + `ui` jsdom), @testing-library/react 16 | infra já instalada; ambiente por arquivo só via `projects` nesta versão |
| Render testado | recharts, lucide-react, react-markdown, `src/components/*.tsx` | reais em jsdom (sem mock); ResizeObserver stub quando recharts presente |

Nenhuma dependência nova é introduzida nesta entrega.

## Arquivos Afetados

| Arquivo | Mudança |
|---|---|
| `vitest.config.ts` | **editado** — 2 linhas: include do projeto `ui` +1 entrada; include do default restringido a `src/lib` (T-001/AC-010) |
| `src/components/__tests__/ui.test.tsx` | **criado** — primitivas de `ui.tsx` + `barFieldFromClick` (AC-001) |
| `src/components/__tests__/sidebar.test.tsx` | **criado** — rotas, estado ativo, `SyncChip` com fake timers, versão (AC-002) |
| `src/components/__tests__/chat-dock.test.tsx` | **criado** — abrir/fechar, sugestões, envio/busy/erro, mensagens, hidratação/persistência/limpar/tamanho (AC-003) |
| `app/__tests__/conexoes.test.tsx` | **criado** — estados, cards, sincronizar, desconexão em dois passos (AC-004) |
| `app/__tests__/emprestimos.test.tsx` | **criado** — contratos, toggle Detalhes com `LoanDetail` real via QueryClientProvider + fetch mockado, balloon (AC-005) |
| `app/__tests__/cartoes.test.tsx` | **criado** — painel do cartão, disputa, tabela de faturas, filtros, `BillsComparisonCard` (AC-006) |
| `app/__tests__/investimentos.test.tsx` | **criado** — filtros, stats, `rateLabel`, a.a. realizado, agenda, benchmarks, distribuição, expansão (AC-007) |
| `app/__tests__/transacoes.test.tsx` | **criado** — estados, filtros no payload capturado, summary, categoria, paginação, chips de recorrência/multi-janela, drill-down, export CSV, recategorização (AC-008) |

Inalterados: `.github/workflows/ci.yml`, `src/lib/hooks.ts`,
`src/components/*.tsx`, todas as `app/**/page.tsx`, `src/banco-mcp.ts`,
`specs/constitution.md`.

## Tarefas Derivadas

| ID | Descrição | AC | Dependências |
|---|---|---|---|
| T-001 | Config: 2 edits de include em `vitest.config.ts` | AC-010 | — |
| T-002 | `ui.test.tsx` (primitivas + `barFieldFromClick`) | AC-001 | T-001 [P] |
| T-003 | `sidebar.test.tsx` (rotas, ativo, SyncChip fake timers) | AC-002 | T-001 [P] |
| T-004 | `chat-dock.test.tsx` (dock completo) | AC-003 | T-001 [P] |
| T-005 | `conexoes.test.tsx` | AC-004 | T-001 [P] |
| T-006 | `emprestimos.test.tsx` | AC-005 | T-001 [P] |
| T-007 | `cartoes.test.tsx` | AC-006 | T-001 [P] |
| T-008 | `investimentos.test.tsx` | AC-007 | T-001 [P] |
| T-009 | `transacoes.test.tsx` | AC-008 | T-001 [P] |

Onda 1 = T-001 (serial, pré-requisito). Onda 2 = T-002..T-009, TODA em
paralelo (escopos disjuntos: 8 arquivos distintos; nenhum toca o mesmo
globo). Detalhes e globs em [tasks.md](./tasks.md).

REFACTOR: previsto como SKIPPED com razão registrada ("nenhum código de
produção muda — apenas arquivos de teste novos e o include do
`vitest.config.ts`") — rota prevista na skill do orquestrador, nunca
silencioso.

## Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Duplicidade de testes: estender só o include do projeto `ui` deixa os novos `src/components/**/*.test.tsx` também no include do projeto default (`src/**/*.test.*`) | cada teste de componente roda 2× e quebra no ambiente node | T-001 faz as DUAS edições juntas; AC-010 verifica contagem sem duplicados; smoke pós-config mantém os 64 verdes em 11 arquivos |
| Pointer events do redimensionamento do chat-dock (`onPointerDown` → `window.pointermove/up`) não funcionam em jsdom | asserts de resize falham sem bug real | contingência: dropar os asserts de redimensionamento por arraste (manter só tamanho default 420×560 e hidratado de `finmonitor.chat.size.v1`) e anotar no relatório — NUNCA simular o efeito chamando funções internas |
| `NEXT_PUBLIC_APP_VERSION` não é injetado pelo Next no vitest | rodapé da sidebar renderiza versão vazia/undefined no teste | o teste seta `process.env.NEXT_PUBLIC_APP_VERSION = "0.0.0-test"` manualmente antes do render |
| NBSP do `Intl` pt-BR em strings hardcoded | testes quebram por caractere invisível | toda expectativa monetária/de data construída via `brl()`/`dateBR()`/`dateTimeBR()` de `@/src/lib/format` |
| `timeAgo` usa `Math.round` — fronteira de 30 s arredonda para "há 1 min" | teste de "agora" flaky | usar 20 s de defasagem no fixture com fake timers (`vi.setSystemTime`), nunca fronteira de arredondamento |
| Clique no `<Bar>` do recharts não é exercível em jsdom (sem layout real) | caso de filtro-por-clique-na-barra não fecha | não tentar: a função `barFieldFromClick` é testada isoladamente (AC-001) e o card do gráfico é assertado apenas quanto à presença |
| recharts exige APIs de browser ausentes em jsdom | render falha no teste | stub mínimo de `globalThis.ResizeObserver` no topo dos arquivos que usam gráficos |
| Teste expõe bug pré-existente de produção | tentação de corrigir junto | NÃO corrigir nesta entrega (nenhum arquivo de produção pode mudar, AC-009); registrar issue via `ship.mjs new --bug` ao final e anotar no relatório |
| `LoanDetail` dispara refetches/retries do react-query e instabiliza | testes flaky | `QueryClientProvider` com `retry: false` e `globalThis.fetch` mockado (única exceção à política de mocks, documentada acima) |
