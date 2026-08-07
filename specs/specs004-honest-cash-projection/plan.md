# Plan: specs004-honest-cash-projection

> **Feature:** `specs004-honest-cash-projection`
> **Spec:** [spec.md](./spec.md)

## Arquitetura

Atualização de comportamento existente em três camadas, sem novos módulos:

1. **Regras de detecção** (`detectRecurrents`, `src/lib/analytics.ts:56-132`):
   janela 120 → 365 dias; construção do map `byMonth` movida para ANTES dos
   filtros; dois filtros novos após os guards existentes (`months.size < 2` na
   linha ~93 e `items.length / months.size > 3` na linha ~97, ambos mantidos):
   - **Estabilidade:** `sums = [...byMonth.values()].map(v => v.sum)`;
     `med = median(sums)` (ordenar; par → média dos dois centrais);
     `stableMonths = sums.filter(s => s >= 0.7 * med && s <= 1.3 * med).length`;
     exigir `stableMonths >= 3`, senão `continue`.
   - **Recency:** `const [ly, lm] = last.day.slice(0, 7).split("-").map(Number)`
     (lm 1-based);
     `missed = (now.getFullYear() * 12 + now.getMonth()) - (ly * 12 + lm - 1)`
     com `now = new Date()`; exigir `missed <= 1`, senão `continue`.
   - `monthly` → `round2(med)` (mediana já computada acima); docstring
     atualizado. `deltaPct` inalterado.
2. **Projeção + premissas** (`buildProjection`, `src/lib/analytics.ts:144-204`):
   retorno vira `{ days, premissas }`. No loop de recorrências (~159–176):
   contador de deltas adicionados por recorrência; contador > 0 → push em
   `premissas.recorrentes` (ordem por `monthly` desc herdada). No loop de
   balloon payments (~186–191): push
   `{ day: due, value, label: "Parcela única de empréstimo" }` em
   `premissas.unicos`; ordenar `unicos` por `day` asc ao final.
3. **Wire/UI:** rota `/api/bank/projection` responde `{ days, premissas }`;
   hook `useProjection` tipa `premissas?` opcional; card de projeção ganha
   rodapé de runway + `<details>` de premissas; RecurrentsCard herda as regras
   (só a janela/title do link mudam); texto do aviso warn reenquadrado.

Consumidores verificados por grep: `detectRecurrents` só é usado por
`/api/bank/recurrents` e `/api/bank/projection` (`src/banco-mcp.ts` não usa);
`buildProjection` só tem o caller `app/api/bank/projection/route.ts:9`.

### Sequência de execução (do plano fonte)

RED (T-001: reescrever `recurrents.test.ts` + criar `projection.test.ts`) →
GREEN backend (T-002: analytics + rota + hooks + overview) → GREEN frontend
(T-003: page.tsx + teste de UI) → validação consolidada (T-004). Passos 3–4
do plano (wire/tipo) são independentes entre si mas anteriores aos passos de
UI; passo 6 (overview) é independente; passos 8–9 (testes novos de projeção e
UI) por último. `npm run typecheck` e `npm test` verdes ao final de cada passo
GREEN/UI.

### Desvio registrado na fase RED (data de execução 2026-08-07)

Sem fake timers (decisão registrada): os testes ancoram em `new Date()`
real. Na data de execução, o baseline (janela 120 dias) divergiu do RED
esperado em dois casos: **AC-001 também falhou no baseline** (a janela de
120 dias cortou a ocorrência do mês -5, deixando `occurrences = 5` em vez
de 6) e **AC-005 passou no baseline** (os créditos grandes do mês -4
ficaram fora da janela, então a regra antiga já não detectava o windfall).
Após o GREEN, ambos os comportamentos são garantidos pelos guards novos
(estabilidade ≥3 meses ±30% da mediana e recency ≤1 ciclo perdido, janela
365 dias) e verificados na suíte verde; detalhes em [spec.md](./spec.md).

Nota: este desvio refere-se aos fixtures originais do T-001; após o
fortalecimento pós-review (fixtures de AC-001 com somas variadas e de AC-005
com 3 meses de ocorrência), ambos os casos são garantidos pelos guards
independentemente do acidente de janela do baseline — estado final em
[spec.md](./spec.md) ("Reforço pós-review").

## Stack e Dependências

| Componente | Tecnologia | Justificativa |
|---|---|---|
| Regras de detecção/projeção | TypeScript (`src/lib/analytics.ts`) | Único dono da lógica; mudança localizada |
| Testes node | vitest 4 (projeto default, tmp dir + `FINMONITOR_DB_PATH` + imports dinâmicos) | Padrão existente de `recurrents.test.ts`; isolamento por `description` única por caso (`recKey`) |
| Testes UI | vitest 4 (projeto `ui`, jsdom) + Testing Library | Padrão existente de `app/__tests__/page.test.tsx` |
| Persistência | better-sqlite3 | Sem mudança de schema; inserts diretos em `projection.test.ts` (accounts/loans não têm upsert no repo) |
| UI | Next.js 16 App Router + React (`app/page.tsx`) | Rodapé + `<details>` sem novos componentes |
| Formatação | `brl()`/`dateBR()` de `@/src/lib/format` | Já importados na página; NBSP do `Intl` pt-BR → asserts por regex |

### Componentes afetados

| Arquivo | Mudança |
|---|---|
| `src/lib/analytics.ts` | `detectRecurrents` (janela, filtros, `monthly`, docstring) e `buildProjection` (shape `{ days, premissas }` + interface `ProjectionPremissas`) |
| `app/api/bank/projection/route.ts` | Wire `{ days: p.days, premissas: p.premissas }` |
| `src/lib/hooks.ts` | `useProjection` tipado; interface `ProjectionPremissas` duplicada (sem importar analytics) |
| `src/lib/overview.ts` | Texto do aviso warn de `firstNegative` |
| `app/page.tsx` | Card de projeção (rodapé runway + `<details>` de premissas); RecurrentsCard (janela 365 dias + title) |
| `src/lib/__tests__/recurrents.test.ts` | Reescrito (T-001) e fortalecido pós-review: 8 casos — AC-003 variável, AC-002 2 meses, AC-001 6 ocorrências (somas variadas 90..120), AC-004a/AC-004b recency, AC-005 windfall 3 meses, AC-006 income positivo, AC-003b clusters ±30% |
| `src/lib/__tests__/projection.test.ts` | Criado (T-001) e fortalecido pós-review: 6 casos — AC-006a (fixture [6..1] + data exata + saldo 800), AC-006b renda antiga, AC-006c windfall, AC-006e income positivo, AC-006f fronteira de horizonte (F dinâmico), AC-006d balloon payment |
| `src/lib/__tests__/projection-route.test.ts` | Criado pós-review (T-002): 1 caso — wire da rota com shape completa do recorrente e balloon dentro do horizonte |
| `src/lib/__tests__/overview.test.ts` | Asserção do texto warn (T-002) |
| `app/__tests__/page.test.tsx` | Teste novo do `<details>` de premissas (AC-007, T-003) + teste RF-008 (janela 365 dias + title do link) |

## Tarefas Derivadas

| ID | Descrição | AC | Dependências |
|---|---|---|---|
| T-001 | test-author RED: reescrever `src/lib/__tests__/recurrents.test.ts` (8 casos) e criar `src/lib/__tests__/projection.test.ts` (6 casos) + `src/lib/__tests__/projection-route.test.ts` (1 caso) | AC-001..AC-006 | — |
| T-002 | backend-developer GREEN: `analytics.ts` (detectRecurrents + buildProjection/premissas) + rota projection + `hooks.ts` + `overview.ts` + asserção `overview.test.ts` | AC-001..AC-006, AC-008 | T-001 |
| T-003 | frontend-developer GREEN: `app/page.tsx` card de projeção + RecurrentsCard + teste de UI em `page.test.tsx` | AC-006, AC-007 | T-001, T-002 |
| T-004 | validator: validação consolidada (typecheck, suíte completa, e2e dados reais) | AC-001..AC-009 | T-002, T-003 |

Ver [tasks.md](./tasks.md) para descrições completas.

Entrega registrada: T-001 em `bb0baad` (testes RED), T-002 em `a082fcb`
(backend + refactor) e T-003 em `f568f73` (frontend), ambos peer-reviews
APROVADO sem P0/P1; T-004 (validação consolidada) permanece pendente.

## Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Limiar de estabilidade ±30% derruba recorrência legítima de alta sazonalidade no futuro | Falso negativo: custo real some da projeção | Contingência documentada: relaxar para ±40% **somente com evidência**; não mudar agora (limiares validados contra dados reais: Enel/Vivo/seguro passam; FGTS/Salary falham por folga larga) |
| Enel cobra em ciclo de ~30 dias → alguns meses civis têm 2 faturas → mediana ≈ R$ 578,82 (≈ 2× a fatura típica) | Valor mensal parece "errado" vs fatura isolada | Nuance aceita e honesta: é o custo mensal verdadeiro do serviço; a mediana das somas mensais é imune ao outlier do mês com 2 faturas (ao contrário da média por ocorrência antiga) |
| `recKey` colide entre casos de teste no tmp DB compartilhado | Testes interferem entre si (falso verde/vermelho) | Padrão existente: cada caso usa `description` única ("NETFLIX.COM ASSINATURA", "SPOTIFY ASSINATURA", …); loan com `description`/category únicas por caso |
| Asserções absolutas de saldo quebram conforme a data de execução avança | Teste de projeção instável no tempo | Casos de `projection.test.ts` usam asserções relativas/invariantes (∃ dia com saldo 900; saldos ∈ {1000, 900, 800}; dias com saldo 1000 = anteriores à primeira queda); horizonte de 60 dias cobre 1 ou 2 ocorrências |
| Dados reais mudam com sync → valores exatos do e2e derivam | Validação AC-009 falha sem bug | Tolerâncias: custo fixo ±R$ 100, `firstNegative` ±3 dias; réplica read-only das regras rodou em 2026-08-07 como referência |
| Campo `premissas` obrigatório quebraria o fixture `ok({ days: [] })` de `page.test.tsx` | Suíte vermelha sem bug | `premissas?` opcional no hook; UI guarda com `projection.data?.premissas &&` antes de renderizar o `<details>` |
| `hooks.ts` importar tipo de analytics criaria acoplamento novo | Quebra o padrão de independência do arquivo | Shape `ProjectionPremissas` duplicada em `hooks.ts` (padrão existente do arquivo) |
