# Spec: specs003-ui-tests-telas

> **Feature:** `specs003-ui-tests-telas`
> **Status:** Approved
> **Autor:** spec-kit-author
> **Data:** 2026-08-05

## Contexto

A specs002 cobriu apenas a Visão Geral (`app/page.tsx`, 11 testes em
`app/__tests__/page.test.tsx` + 14 da lógica extraída em `src/lib/overview.ts`).
As demais 5 telas (`transacoes`, `cartoes`, `investimentos`, `emprestimos`,
`conexoes`) e os 3 componentes compartilhados (`src/components/ui.tsx`,
`sidebar.tsx`, `chat-dock.tsx`) seguem sem nenhuma verificação de
comportamento — 64 testes no total hoje (10 arquivos em
`src/lib/__tests__/*.test.ts` + `app/__tests__/page.test.tsx`).

Esta entrega adiciona **8 arquivos de teste novos** e **2 edições de include**
no `vitest.config.ts` (estender o projeto `ui` para `src/components` E
restringir o projeto default para `src/lib`, evitando duplicidade — o vitest 4
resolve `include` por projeto independentemente, então um arquivo pode
pertencer a mais de um projeto). **Nenhum código de produção muda.** Como todo
o código testado JÁ EXISTE, a fase RED usa a rota documentada para
comportamento já implementado: os testes passam de imediato → **VALIDATE**
(falha nesse cenário indica bug real ou teste errado).

**Issue:** #22 — "Testes de UI de todas as telas e componentes".
**Branch:** `feat/22-testes-de-ui-de-todas-as-telas-e-compone`.

### Decisões já tomadas (registradas)

- **Sem extrações de lógica.** A extração `overview.ts` da specs002 existiu
  para o monólito de ~1220 linhas; nas demais telas a lógica restante é de
  render/filtro e é testável via DOM. Nenhuma função de produção é criada ou
  movida nesta entrega.
- **Padrão a copiar:** `app/__tests__/page.test.tsx` — estado `vi.hoisted` +
  factory de mock de hooks + helpers `ok()/loading()/error()` +
  `afterEach(cleanup)`. **Padrões proibidos:** snapshot tests e asserts de
  className decorativo (constituição art. 5 — sem testes de fachada).
- **Strings formatadas** (valor monetário, data) SEMPRE construídas com
  `brl()`/`dateBR()` importados de `@/src/lib/format` — o `Intl` pt-BR emite
  NBSP (`U+00A0`) e qualquer hardcode quebra. Exceção única documentada:
  deltas percentuais com `toFixed(1).replace(".", ",")` (ex.: `"+20,0%"` na
  comparação de faturas), que não passam por `brl`.
- **Mocks por hooks** (`@/src/lib/hooks`), nunca por `fetch` quando o hook é
  mockado. A ÚNICA exceção é `LoanDetail` de empréstimos, que usa `useQuery`
  + `fetch` diretamente: testa-se com `QueryClientProvider` com
  `retry: false` e `globalThis.fetch` mockado (AC-005).
- **Bug real exposto por teste:** NÃO corrigir nesta entrega (mudaria
  comportamento sem AC); registrar issue via `ship.mjs new --bug` ao final e
  anotar no relatório.

## Requisitos Funcionais

- **RF-001:** Config do vitest ajustada: projeto `ui` passa a cobrir também
  `src/components/**/*.test.tsx` e o projeto default fica restrito a
  `src/lib/**/*.test.*` — nenhum teste roda duplicado, nenhum teste existente
  muda de projeto.
- **RF-002:** Testes de comportamento dos 3 componentes compartilhados
  (`ui.test.tsx`, `sidebar.test.tsx`, `chat-dock.test.tsx`) em
  `src/components/__tests__/`, projeto `ui` (jsdom).
- **RF-003:** Testes de comportamento das 5 telas sem cobertura
  (`conexoes.test.tsx`, `emprestimos.test.tsx`, `cartoes.test.tsx`,
  `investimentos.test.tsx`, `transacoes.test.tsx`) em `app/__tests__/`,
  projeto `ui` (jsdom).
- **RF-004:** Suíte completa verde (64 pré-existentes + novos), typecheck e
  build limpos, diff contra `main` restrito a `vitest.config.ts` + arquivos
  `*.test.tsx` novos.

## Critérios de Aceite

Matriz AC → tarefa → teste:

| AC | Critério (verificável) | Tarefa(s) | Teste previsto |
|---|---|---|---|
| **AC-001** | Primitivas de `src/components/ui.tsx` cobertas: `Card` (title/action/children; sem title → sem heading), `Stat` (label/value/hint; `tone="pos"`/`"neg"` → classes `text-pos`/`text-neg` no valor), `connectionStatusBadge` (`UPDATED`→green/"Atualizada", `LOGIN_ERROR`→red/"Erro de login", desconhecido→yellow/label cru), `billStatusBadge` (PAID/PAST_DUE_UNPAID/PAST_DUE_UNCONFIRMED/OPEN/`undefined`→"—"), `ErrorState` (mensagem; retry presente só com `onRetry`), `EmptyState` (title/hint; âncora `target="_blank"` só com `href`+`linkLabel`), `AmountByKind` (cor por kind + texto `brl(...)`), `KindBadge` (`KIND_LABEL` de `@/src/lib/semantics`), `PageHeader` e a função pura `barFieldFromClick` (`src/components/ui.tsx:175-188`): `{key}`, `{payload:{key}}`, `{activePayload:[…]}` → string; campo não-string/`null`/`undefined` → `null`. | T-002 | `src/components/__tests__/ui.test.tsx` |
| **AC-002** | `src/components/sidebar.tsx` coberto: as 6 rotas (`/`, `/transacoes`, `/cartoes`, `/investimentos`, `/emprestimos`, `/conexoes`) com labels PT-BR renderizadas 2× (nav mobile + aside desktop); estado ativo por pathname (`usePathname` mockado: `/` ativo só em `/` exato, prefixo não casa); `SyncChip` com fake timers (`vi.useFakeTimers()` + `vi.setSystemTime`): `syncing`→"Sincronizando…", `isError`→"Falha ao consultar sync", `syncedAt:null`→"Primeira sincronização…", `timeAgo` ("agora" com 20 s, "há 5 min", "há 2 h") e `lastError` no atributo `title`; rodapé com a versão via `process.env.NEXT_PUBLIC_APP_VERSION` setado manualmente no teste ("0.0.0-test"). | T-003 | `src/components/__tests__/sidebar.test.tsx` |
| **AC-003** | `src/components/chat-dock.tsx` coberto (mocks obrigatórios de `ai`/`@ai-sdk/react`): abrir/fechar (aria-labels "Abrir assistente"/"Fechar assistente"); 4 sugestões visíveis sem mensagens e clique → `sendMessage({text})`; formulário (vazio → enviar disabled; texto → envio + input limpo); busy (`status:"submitted"` → "Analisando…", "Parar processamento" chama `stop`, submit/sugestões viram no-op); `error` visível; render de mensagens (tool-part com `state:"output-available"` → chip "✓", sem estado → chip sem ✓; markdown real renderiza `<strong>`); hidratação da key `finmonitor.chat.v1` (`chat-dock.tsx:18`) com sanitização via `persistableMessages` (`chat-dock.tsx:23-27`): só parts `text` sobrevivem, mensagens sem part text são descartadas, JSON corrompido/não-array → `undefined`; persistência (re-render salva só parts text, teto de 40 mensagens); "Limpar conversa" (habilitado só com mensagens; `setMessages([])` + remoção da key); tamanho default 420×560 e hidratado de `finmonitor.chat.size.v1` (`chat-dock.tsx:19`). | T-004 | `src/components/__tests__/chat-dock.test.tsx` |
| **AC-004** | `app/conexoes/page.tsx` coberta (hooks `useConnections`/`useSync`/`useDisconnect` mockados): loading ("Carregando…" + header "Conexões"); erro → `ErrorState` com retry chamando `refetch`; vazio → EmptyState "Nenhuma conexão" + link "Adicionar banco" com `add_connection_url` (`src/banco-mcp.ts:12-159`); card feliz (nome do conector, badge de status via `connectionStatusBadge` REAL — componente não é mockado, `item_id`, data de conexão via `dateTimeBR`, link "Reconectar" presente só com `reconnect_url`); sincronizar ("Sincronizar" → `sync.mutate`; `isPending` → "Sincronizando…" disabled; erro visível); desconexão em dois passos (1º clique → "Confirmar desconexão?", 2º clique → `disconnect.mutate({item, confirm:true})`; `isPending` → "Removendo…" disabled). | T-005 | `app/__tests__/conexoes.test.tsx` |
| **AC-005** | `app/emprestimos/page.tsx` coberta (hooks `useConnections`/`useLoans` mockados; `LoanDetail` com `useQuery` + `fetch` reais dentro de `QueryClientProvider` com `retry:false` e `globalThis.fetch` mockado): loading/erro/vazio; card de contrato (badge com `loan.type`, `brl(contractAmount)`, "Contrato nº … · vencimento …"); toggle "Detalhes" dispara POST `/api/bank/loans` com `{"loan_ids":[id]}` e renderiza contratada em, CET, periodicidade, linhas de taxa (taxType/calculation + "% a.a."), parcelas (total/restantes); balloon (`Pagamento único (balloon) em {dateBR} · {brl}`) quando sem parcelas; detalhe vazio → "Sem detalhes para este contrato."; fetch com `ok:false` → mensagem do erro; clique novamente colapsa. | T-006 | `app/__tests__/emprestimos.test.tsx` |
| **AC-006** | `app/cartoes/page.tsx` coberta (hooks `useAccountsBundle`/`useBills`/`useBillsComparison` mockados): bundle error → ErrorState; loading → skeleton + header "Cartões"; sem conta `type:"CREDIT"` → "Nenhum cartão de crédito conectado"; painel do cartão (marca/nível, "Fatura atual", "Limite usado {brl} de {brl}" com percentual, "Limite disponível", "Vencimento", "Pagamento mínimo"); ajuste por disputa (`bills.data.disputed` → fatura atual reduzida + texto explicativo com valor e data); tabela de faturas (datas/valores formatados, badges "Paga"/"Em aberto" via `billStatusBadge` real, selo "Pagamento registrado em … — aguardando baixa" para fatura em disputa); filtros (status "Paga" só linhas PAID; `dueRange` futuro sem match → "Nenhuma fatura com esses filtros"; vazio → "Nenhuma fatura"); `BillsComparisonCard` (loading → Skeleton, erro → ErrorState, `current`/`previous` null → "Menos de duas faturas pagas", feliz → totais via `brl` + delta literal `"+20,0%"` — `toFixed(1).replace(".", ",")`, não `brl`); bills error → ErrorState dentro do card "Faturas". | T-007 | `app/__tests__/cartoes.test.tsx` |
| **AC-007** | `app/investimentos/page.tsx` coberta (hooks `useInvestments`/`useBenchmarks`/`useInvestmentMovements` mockados; stub `globalThis.ResizeObserver` para o PieChart): loading/erro/vazio; filtros (tipo derivado das posições visíveis: a opção de um tipo encerrado só surge após marcar "Exibir posições encerradas"; selecionar esse tipo e desmarcar o checkbox → "Nenhuma posição com esse filtro" + hint; checkbox reexibe posição `TOTAL_WITHDRAWAL` com badge "Encerrada"); stats agregados ("Total investido", "Valor atual", "Impostos provisionados", "Rentabilidade" com tom e hint percentual líquido); `rateLabel` literal (`"{rate} {rateType}"` cru, sem vírgula/toFixed; sem rate → "—"); coluna "a.a. realizado" (sem datas → "—"; com ~2 anos de posição → assert em FAIXA do percentual, nunca valor exato); agenda de vencimentos (vazio → "Sem vencimentos informados"; item com nome, "vence {dateBR}", valor); benchmarks (loading → Skeleton; CDI/IPCA formatados, "Ganho real ≈ …"; `cdiAnnualPct:null` → "—"); distribuição por tipo (legenda agrega tipos); expansão de posição (loading/erro/vazio → mensagens; rows `BUY`/`SELL` → "Aplicação"/"Resgate" com `dateBR`; colapso no segundo clique). | T-008 | `app/__tests__/investimentos.test.tsx` |
| **AC-008** | `app/transacoes/page.tsx` coberta (mocks hoisted capturando o payload de `useTransactions`; `useSearchParams` mockado): estados (bundle error, tx loading → 6 skeletons, tx error, vazio → "Nenhuma transação no período"); happy path (subtitle de contagem, linha com data/descrição/valor com cor por kind/KindBadge/badge de status POSTED vs PENDING); summary ("Entradas (filtro atual)"/"Saídas (filtro atual)"/"Resultado (filtro atual)" via `brl`); TODOS os filtros refletidos no payload capturado (conta → `account_id`, período 90 → `from` ISO sem `to`, período personalizado → inputs de data, tipo → `kind:"spend"`, busca → `search_queries`, categoria → `category`); card "Por categoria" com o BarChart presente (clique no Bar não exercido em jsdom — `barFieldFromClick` coberto no AC-001); paginação ("Página X de Y", navegação atualiza `page`, botões desabilitados nos extremos); chip de recorrência (`desc_norm` a partir de `?desc=`; clique limpa); chip multi-janela (pares `fromIso/toIso` → `windows`; clique restaura modo atual com `from`); drill-down do dashboard preservando o TIMESTAMP COMPLETO em `from` (`range=custom&fromIso=…&toIso=…&kind=&category=` refletido nos selects); export CSV (POST com `page_size:5000`; BOM `\uFEFF` + header `data;descricao;categoria;valor;tipo;status`; escape de aspas `""…""`; decimal com vírgula; nome `transacoes-todas-{baseFrom}.csv`; botão disabled sem dados; erro HTTP "Erro 500 ao exportar" e erro de rede visíveis); recategorização via select da linha (`categorize.mutate([{transaction_id, category_id}])`, "salvando…", erro visível). | T-009 | `app/__tests__/transacoes.test.tsx` |
| **AC-009** | Suíte completa verde: os 64 testes pré-existentes seguem verdes + todos os novos; `npm run typecheck` sem erros; `npm run build` ok; `git diff main --stat` mostra APENAS `vitest.config.ts` + arquivos `*.test.tsx` novos — nenhum arquivo de produção tocado. | T-002..T-009 | `npm test` + `npm run typecheck` + `npm run build` + diff do PR |
| **AC-010** | `vitest.config.ts`: projeto `ui` com `include: ["app/**/*.test.tsx", "src/components/**/*.test.tsx"]` e projeto default restrito a `include: ["src/lib/**/*.test.*"]` — cada arquivo de teste pertence a exatamente um projeto (o vitest 4 resolve `include` por projeto independentemente); `npm test` roda cada teste uma única vez. | T-001 | `npm test` (contagem de testes = 64 + novos, sem duplicados) |

## Fora de Escopo

- Screenshots / snapshot visual / testes de pixel.
- Qualquer mudança em código de produção (`app/**/page.tsx`,
  `src/components/*.tsx`, `src/lib/*`, `src/banco-mcp.ts`).
- Extração de lógica para `src/lib` (ao contrário da specs002, nenhuma
  função é movida ou criada).
- Correção de bugs pré-existentes expostos pelos testes (viram issue nova ao
  final, não correção nesta entrega).
- Alteração no workflow de CI (`.github/workflows/ci.yml`) — o gate
  `quality` já roda `npm test` e passa a cobrir os testes novos
  automaticamente.
- `constitution.md`, `progress.json`/`progress.md`.

## Referências

- Issue #22 (FinMonitor); specs002 (`specs/specs002-overview-ui-tests/`) —
  padrão de artefatos espelhado aqui.
- `app/__tests__/page.test.tsx` — padrão de teste a copiar: `vi.hoisted`,
  factory de mock de hooks, helpers `ok()/loading()/error()`, stub
  `ResizeObserver`, `afterEach(cleanup)`.
- `vitest.config.ts:10-21` — projects default (linha 11, include a
  restringir) e `ui` (linha 17, include a estender).
- `src/lib/hooks.ts` — shapes dos payloads a mockar: `AccountsBundle`
  (48-59), `TransactionsPagePayload` (86-90), `BillsPayload` (103-107),
  `SyncMeta` (140-144), `InvestmentMovementRow` (225-231),
  `BillsComparisonPayload` (309-315), payload de benchmarks (334-343).
- `src/banco-mcp.ts:12-159` — tipos das entidades (`Account` com
  `creditData`, `Bill`, `Investment`, `LoanContract`, `ConnectionsResult`
  com `add_connection_url`).
- `src/components/chat-dock.tsx` — constantes assertadas:
  `STORAGE_KEY`/`SIZE_KEY` (18-19), `persistableMessages` (23-27),
  `SUGGESTIONS` (11-16), aria-labels (178, 203, 300, 311).
- `src/lib/format.ts` (`brl`, `dateBR`, `dateTimeBR`, `timeAgo`),
  `src/lib/semantics.ts` (`KIND_LABEL`).
- [plan.md](./plan.md) · [tasks.md](./tasks.md) ·
  [interface-contract.md](./contracts/interface-contract.md)
