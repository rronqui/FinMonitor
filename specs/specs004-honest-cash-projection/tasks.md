# Tasks: specs004-honest-cash-projection

> Deriva de [plan.md](./plan.md). Convenções: T-002/T-003 dependem de T-001
> (testes RED primeiro); T-003 depende de T-002 (shape `premissas`);
> T-004 por último. Padrões do repo: testes em tmp dir + `FINMONITOR_DB_PATH`
> + imports dinâmicos de `../db`, `../repo`, `../analytics` (helpers `tx()`,
> `anchor()`, `dayInMonth()` já definidos em `recurrents.test.ts:16-29`);
> isolamento por `description` única por caso (`recKey` colide no tmp DB
> compartilhado); strings formatadas sempre via `brl()`/`dateBR()` de
> `@/src/lib/format` (NBSP do `Intl` pt-BR → asserts por regex);
> `npm run typecheck` e `npm test` verdes ao final de cada passo GREEN/UI.

## Onda 1 — RED (pré-requisito de tudo)

| ID | Descrição | AC | Dependências | Globs permitidos | Status |
|---|---|---|---|---|---|
| T-001 | **test-author RED** — (1) **reescrever** `src/lib/__tests__/recurrents.test.ts` mantendo o padrão existente (tmp dir + `FINMONITOR_DB_PATH` + imports dinâmicos; `repo.upsertTransactions` para fixtures) com 6 casos, cada um com `description` única: **1 (mantido/ajustado)** frequência variável (4 lançamentos/mês durante 3 meses, meses -2..0) NÃO é recorrência; **2 (invertido)** assinatura mensal com só 2 meses de ocorrência (meses -1 e 0) NÃO é recorrência; **3 (novo)** assinatura com 6 ocorrências mensais de mesmo valor (meses -5..0) É recorrência, `monthly` = o valor (mediana das somas mensais), `occurrences` = 6; **4 (novo, recency)** assinatura estável com 7 ocorrências mensais terminando no mês -3 (3 ciclos perdidos) NÃO é detectada; **5 (novo, recency limite)** assinatura estável com ocorrências nos meses -3, -2, -1 (1 ciclo perdido) É detectada; **6 (novo, windfall)** 2 créditos income grandes no mês -4 (10.000 e 20.000) + 1 crédito de 100 no mês 0 NÃO é detectado (estabilidade falha). (2) **criar** `src/lib/__tests__/projection.test.ts` com o mesmo padrão de setup; contas/loans inseridos direto (`dbMod.db().prepare("INSERT INTO accounts (account_id, type, raw, balance) VALUES (?, 'BANK', '{}', ?)").run(...)` e `INSERT INTO loans (id, raw) VALUES (?, ?)` — schema: só `id`/`account_id`, `type`/`raw` NOT NULL); UMA única conta BANK (balance "1000") no `beforeAll` compartilhada por todos os casos; loan só no caso 4; 4 casos: **1** recorrência estável entra — assinatura spend 100/mês (meses -5..0, dia 10) → `buildProjection(60).premissas.recorrentes` contém exatamente 1 item com label e `monthly: 100`; nos `days`: ∃ dia com saldo 900, todo saldo ∈ {1000, 900, 800}, dias com saldo 1000 são exatamente os anteriores à primeira queda (asserções invariantes à data de execução); **2** renda sem evidência recente não entra — income estável meses -9..-3 → 60 dias = saldo da conta, `premissas.recorrentes` vazio; **3** windfall não entra — income 10.000+20.000 no mês -4 e 100 no mês 0 → projeção plana, premissas sem income; **4** balloon payment entra — loan com `raw = JSON.stringify({ balloonPayments: [{ dueDate: <hoje+10 dias em ISO>, amount: { value: 500 } }] })` → saldo cai 500 no dia exato; `premissas.unicos` = `[{ day, value: 500, label: "Parcela única de empréstimo" }]`. Nesta fase os casos novos FALHAM (comportamento antigo) — isso é o RED esperado. Ver "Desvio registrado na fase RED" em [spec.md](./spec.md): com data de execução 2026-08-07 e sem fake timers, AC-001 também falhou no baseline (janela 120 cortou mês -5) e AC-005 passou no baseline (mês -4 fora da janela 120). | AC-001, AC-002, AC-003, AC-004, AC-005, AC-006 | — | `src/lib/__tests__/recurrents.test.ts`, `src/lib/__tests__/projection.test.ts` | DONE |

## Onda 2 — GREEN backend

| ID | Descrição | AC | Dependências | Globs permitidos | Status |
|---|---|---|---|---|---|
| T-002 | **backend-developer GREEN** — faz T-001 passar. (1) `src/lib/analytics.ts` `detectRecurrents` (56-132): `WINDOW_DAYS` 120 → 365; mover construção de `byMonth` (100-107) para ANTES dos filtros; após os guards existentes (93-94 e 97, mantidos) adicionar: **estabilidade** (`sums = [...byMonth.values()].map(v => v.sum)`; `med = median(sums)` — par → média dos dois centrais; `stableMonths = sums.filter(s => s >= 0.7 * med && s <= 1.3 * med).length`; exigir `>= 3` senão `continue`) e **recency** (`const [ly, lm] = last.day.slice(0, 7).split("-").map(Number)`; `missed = (now.getFullYear() * 12 + now.getMonth()) - (ly * 12 + lm - 1)` com `now = new Date()`; exigir `<= 1` senão `continue`); `monthly` → `round2(med)` (linha 123); docstring atualizado (janela 12 meses, ≥3 meses estáveis ±30% da mediana, ≤1 ciclo perdido, valor = mediana das somas mensais); `deltaPct` (109-116) inalterado. (2) `buildProjection` (144-204): assinatura → `{ days: ProjectionPoint[]; premissas: ProjectionPremissas }` com `export interface ProjectionPremissas { recorrentes: Array<{ key: string; label: string; kind: TxKind; monthly: number }>; unicos: Array<{ day: string; value: number; label: string }> }`; loop de recorrências (159-176) com contador de deltas por `r` (incremento no `addDelta` local) → contador > 0 → push `{ key, label, kind, monthly }` (ordem por monthly desc herdada); loop de balloon payments (186-191) → push `{ day: due, value, label: "Parcela única de empréstimo" }`; ordenar `unicos` por `day` asc ao final. (3) `app/api/bank/projection/route.ts` (único caller): `const p = buildProjection(days); return Response.json({ days: p.days, premissas: p.premissas });`. (4) `src/lib/hooks.ts` (245-249): `useProjection` tipa `fetchJson<{ days: Array<{ day: string; saldo: number }>; premissas?: ProjectionPremissas }>`; declarar/exportar `export interface ProjectionPremissas` no próprio arquivo com a MESMA shape (NÃO importar de analytics — shape duplicada é o padrão existente); `premissas` opcional para não quebrar o fixture `ok({ days: [] })`. (5) `src/lib/overview.ts` (97-101): texto do warn → `` `Caixa em conta fica negativo em ${dateBR(firstNegative.day)} (${brl(firstNegative.saldo)}) — resolva com resgate de investimento.` ``; atualizar asserção em `src/lib/__tests__/overview.test.ts:233` para `stringContaining("Caixa em conta fica negativo em")`. Smoke: `npm run typecheck` + `npm test` verdes (recorrents + projection novos passando). | AC-001, AC-002, AC-003, AC-004, AC-005, AC-006, AC-008 | T-001 | `src/lib/analytics.ts`, `app/api/bank/projection/route.ts`, `src/lib/hooks.ts`, `src/lib/overview.ts`, `src/lib/__tests__/overview.test.ts` | DONE |

## Onda 3 — GREEN frontend

| ID | Descrição | AC | Dependências | Globs permitidos | Status |
|---|---|---|---|---|---|
| T-003 | **frontend-developer GREEN** — `app/page.tsx`: (1) card de projeção (717-770): substituir o parágrafo de rodapé (761-766) por `<p className="mt-2 text-[10px] text-muted">` com `firstNegative ? \`Caixa em conta cobre compromissos até ${dateBR(firstNegative.day)}; a partir daí, depende de resgate de investimentos. \` : "Caixa em conta cobre os compromissos conhecidos nos próximos 60 dias. "` + sufixo fixo `"Estimativa só com recorrências comprovadas (≥3 meses estáveis e evidência recente) e pagamentos únicos conhecidos — não é uma fatura futura."`; inserir após esse `<p>` (ainda no fragmento) o `<details className="mt-1 text-[10px] text-muted">` guardado por `projection.data?.premissas && (…recorrentes.length > 0 || …unicos.length > 0)`, com `<summary className="cursor-pointer hover:text-text">O que entra nesta estimativa</summary>` e `<ul className="mt-1 space-y-0.5">`: recorrentes `{r.kind === "income" ? "+" : "−"} {brl(r.monthly)}/mês · {r.label}` (`key={r.key}`) e unicos `− {brl(u.value)} em {dateBR(u.day)} · {u.label}` (`key={\`${u.day}-${i}\`}`). `brl`/`dateBR` já importados; `projection` via `useProjection(60)` (linha 323). (2) RecurrentsCard (282-289): `120 * 86_400_000` → `365 * 86_400_000`; `title` → `"Ver transações dos últimos 12 meses"` (o card herda as regras novas via API — sem outra mudança; fixtures de `page.test.tsx:214-232` mockam a API e não são afetados). (3) `app/__tests__/page.test.tsx`: teste novo no describe existente — `mockState.projection = ok({ days: [{ day: "2026-08-07", saldo: 1000 }], premissas: { recorrentes: [{ key: "k", label: "Seguro", kind: "spend", monthly: 555.59 }], unicos: [] } })` → `render(<OverviewPage />)` → `fireEvent.click(screen.getByText("O que entra nesta estimativa"))` → esperar texto contendo `555,59` (regex `/555,59/` — `brl` usa NBSP); o `beforeEach` existente (linha 97, `mockState.projection = ok({ days: [] })`) já restaura para os demais testes. Smoke: `npm run typecheck` + `npm test` verdes. | AC-006, AC-007 | T-001, T-002 | `app/page.tsx`, `app/__tests__/page.test.tsx` | DONE |

## Onda 4 — Validação consolidada

| ID | Descrição | AC | Dependências | Globs permitidos | Status |
|---|---|---|---|---|---|
| T-004 | **validator** — (1) `npm test` em `D:/Projects/FinMonitor`: suíte inteira verde incluindo os casos novos (estabilidade, recency, windfall, premissas, UI). (2) `npm run typecheck` limpo. (3) Prova end-to-end com dados reais (valores de referência obtidos rodando réplica read-only das regras contra `data/finmonitor.db` em 2026-08-07; `bankTotal` varia com sync → asserções relativas): `npm run start:server` (porta 3000) e: `curl -s "http://localhost:3000/api/bank/projection?days=60"` → (a) nenhum delta diário positivo > R$ 10.000 (salto de +R$ 86,3k em 05/09 desapareceu); (b) `premissas.recorrentes` sem label "SALARIO"/"FGTS" e sem income; (c) contém seguro Porto Seguro `monthly: 555.59` e Enel `monthly: 578.82`; (d) `days[0].saldo` ≈ saldo atual da conta BANK (≈ R$ 5,9k na réplica); (e) `firstNegative` ≈ 2026-10-04 (±3 dias por sync). `curl -s "http://localhost:3000/api/bank/recurrents"` → sem FGTS/Salary/Atacadão; soma dos `monthly` de kind spend ≈ R$ 3.489,01 (±R$ 100); presentes: seguro 555.59, Vivo 367.98, Enel 578.82. UI em `http://localhost:3000`: rodapé "Caixa em conta cobre compromissos até …" com ponto vermelho; `<details>` "O que entra nesta estimativa" lista os compromissos; "Custo fixo ≈" ≈ R$ 3,5k/mês (não ~R$ 8,9k da regra antiga). (4) `npm run stop:server` ao final. | AC-001, AC-002, AC-003, AC-004, AC-005, AC-006, AC-007, AC-008, AC-009 | T-002, T-003 | (somente leitura/execução) | PENDING |

> **Nota:** o e2e do T-004 usa tolerâncias (custo fixo ±R$ 100,
> `firstNegative` ±3 dias) porque os dados reais mudam com sync; os valores
> absolutos da réplica de 2026-08-07 são referência, não contrato.

## Reforço pós-review (fixtures de teste)

Após o deep-review (rodada TestHardening), os fixtures foram fortalecidos sem
renumerar ACs: **AC-001** passou a usar somas mensais variadas 90..120 (asserta
a mediana sob variação real); o windfall do **AC-005** usa 3 meses para
discriminar o filtro de estabilidade; caso positivo de income estável recente
adicionado (`AC-006` em `recurrents.test.ts`, `AC-006e` em
`projection.test.ts`); `AC-006a` asserta a data exata do primeiro delta;
`projection-route.test.ts` cobre o wire da rota (RF-004); `AC-006f` cobre o
off-by-one de horizonte (ocorrência em `today+days` fora de
`today .. today+days-1` não entra). Ver seção "Reforço pós-review" em
[spec.md](./spec.md).

## Fora de Escopo

- Investimentos na projeção (permanecem ignorados por desenho; rodapé
  explicita a dependência de resgate) — ver [spec.md](./spec.md).
- Mudança de regra de balloon payments (continuam entrando).
- Edição de `src/banco-mcp.ts` (não consome `detectRecurrents`).
- Relaxamento do limiar ±30% → ±40% sem evidência (contingência futura).
