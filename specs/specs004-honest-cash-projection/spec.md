# Spec: specs004-honest-cash-projection

> **Feature:** `specs004-honest-cash-projection`
> **Status:** Approved
> **Autor:** spec-kit-author
> **Data:** 2026-08-07

## Contexto

O card "Projeção de caixa (60 dias)" e o card "Recorrentes — gastos/entradas"
compartilham `detectRecurrents()` (`src/lib/analytics.ts`). Com os dados reais
do usuário, a regra atual (janela de 120 dias, ≥2 meses distintos, média
simples por ocorrência) produz três mentiras:

1. **Renda fantasma:** o saque único do FGTS (R$ 428k em abril + R$ 3,7k em
   agosto) passa no filtro de "≥2 meses distintos" e vira "renda mensal" de
   R$ 86,4k, inflando todo o segundo mês da projeção.
2. **Salário ressuscitado:** o salário histórico (sem contrato ativo hoje, sem
   previsão de volta) ou contamina o grupo com verbas rescisórias ou seria
   projetado como renda futura falsa.
3. **Custo fixo falso:** compras avulsas (Atacadão, restaurantes) com 2+ meses
   distintos entram como "custo fixo".

O usuário está sem contrato de trabalho e pediu a versão mais honesta
possível: projeção = caixa atual + compromissos com evidência + pagamentos
únicos conhecidos; renda só com evidência recente; suposições visíveis na UI;
alarme de negativo reenquadrado como *runway* ("cobre até X; depois depende de
resgate de investimentos").

**Estado final esperado:** curva descendente de compromissos reais
(~R$ 4–5k/mês), sem salto de FGTS, sem salário projetado, card de recorrentes
com o mesmo critério e premissas listadas sob o gráfico.

Esta feature **ATUALIZA comportamento existente** (`detectRecurrents` /
`buildProjection` em `src/lib/analytics.ts`), não é feature nova.

**Issue:** #25 — "Projeção de caixa e recorrentes honestos".
**Branch:** `feat/25-projecao-de-caixa-e-recorrentes-honestos`.

### Decisões já tomadas (registradas)

- **Limiares derivados dos dados reais:** estabilidade = soma mensal dentro de
  ±30% da mediana por ≥3 meses; recency = no máximo 1 ciclo mensal perdido.
  Eletricidade (variação sazonal ~±20%) e Vivo/seguro passam; FGTS e Salary
  falham por folga larga. Fallback documentado: se uma recorrência legítima de
  alta sazonalidade cair fora no futuro, relaxar para ±40% — **não mudar agora
  sem evidência**.
- **Mediana das somas mensais** como valor mensal (não média por ocorrência):
  imune a outliers de meses com 2 faturas. Nuance aceita: a Enel cobra em
  ciclo de ~30 dias, então alguns meses civis têm 2 faturas e a mediana sai
  ≈ R$ 578,82 (≈ 2× a fatura típica de ~R$ 370) — é o custo mensal verdadeiro
  do serviço, então o valor é honesto, apenas maior que uma fatura isolada.
- **Projeção continua ignorando investimentos** (CDB ~R$ 750k) por desenho — o
  rodapé novo torna isso explícito ("depende de resgate de investimentos"), em
  vez de fingir solvência ou quebramento.
- **Renda projetada = zero por padrão** enquanto não houver evidência recente;
  quando o usuário voltar a receber salário, 3 meses estáveis + ocorrência
  recente o reintroduzem automaticamente, sem configuração.
- **Balloon payments continuam entrando** na projeção (compromisso contratual
  conhecido) — sem mudança de regra; passam a ser listados em
  `premissas.unicos`.
- **Consumidores herdam as regras sem edição própria:** os únicos consumidores
  de `detectRecurrents` são `/api/bank/recurrents` e `/api/bank/projection`
  (`src/banco-mcp.ts` não a usa); o único caller de `buildProjection` é
  `app/api/bank/projection/route.ts`.
- **Hooks não importam analytics:** a interface `ProjectionPremissas` é
  duplicada em `src/lib/hooks.ts` com a mesma shape (padrão existente do
  arquivo), campo `premissas` opcional para não quebrar fixtures de teste que
  mockam `ok({ days: [] })`.

### Desvio registrado na fase RED (data de execução 2026-08-07)

Os testes ancoram em data real (`anchor()`/`dayInMonth()` sobre
`new Date()`); **não usamos fake timers** (decisão registrada — mantém o
padrão do repo e deixa os guards de recency exercitarem o relógio real).
Consequência observada no RED, na data de execução 2026-08-07:

- **AC-001 também falhou no baseline:** a ocorrência do mês -5 (dia 15,
  ~5 meses atrás) ficou fora da janela antiga de 120 dias, então a regra
  antiga contava só 5 ocorrências e a asserção `occurrences = 6` já falhava
  antes do GREEN.
- **AC-005 passou no baseline:** os créditos grandes do mês -4 (dias 5 e 6)
  ficaram fora da janela de 120 dias, então a regra antiga via menos de
  2 meses distintos e já não detectava o windfall antes do GREEN.

Após o GREEN (janela 365 dias + guards de estabilidade e recency), ambos os
comportamentos passam a ser garantidos pelos guards novos e foram
verificados na suíte verde — o estado final não depende do acidente de
janela do baseline.

## Requisitos Funcionais

- **RF-001:** `detectRecurrents` (`src/lib/analytics.ts`) passa a usar janela
  de 12 meses (`WINDOW_DAYS` 120 → 365) e dois filtros novos após os guards
  existentes (`months.size < 2` e `items.length / months.size > 3`):
  (a) **estabilidade** — mediana das somas mensais (map `byMonth`, cuja
  construção é movida para antes dos filtros); exigir ≥3 meses com soma dentro
  de ±30% da mediana (`s >= 0.7 * med && s <= 1.3 * med`); mediana com número
  par de elementos = média dos dois centrais após ordenação;
  (b) **recency** — no máximo 1 ciclo mensal perdido desde a última ocorrência:
  `const [ly, lm] = last.day.slice(0, 7).split("-").map(Number)` (lm 1-based);
  `missed = (now.getFullYear() * 12 + now.getMonth()) - (ly * 12 + lm - 1)`
  com `now = new Date()`; exigir `missed <= 1` (0 = última ocorrência no mês
  corrente).
- **RF-002:** `monthly` deixa de ser média por ocorrência e passa a ser
  `round2(mediana das somas mensais)` (a mediana já computada no filtro de
  estabilidade). Docstring de `detectRecurrents` atualizado: janela 12 meses,
  recorrente = ≥3 meses estáveis dentro de ±30% da mediana E no máximo 1 ciclo
  mensal perdido desde a última ocorrência; valor mensal = mediana das somas
  mensais. `deltaPct` permanece inalterado.
- **RF-003:** `buildProjection(days)` passa a retornar
  `{ days: ProjectionPoint[]; premissas: ProjectionPremissas }` com
  `premissas: { recorrentes: Array<{ key; label; kind: TxKind; monthly }>;
  unicos: Array<{ day: string; value: number; label: string }> }`.
  `recorrentes` contém somente as recorrências que projetaram ≥1 delta no
  horizonte (contador por recorrência no loop), herdando a ordem por `monthly`
  desc de `detectRecurrents`. `unicos` contém os balloon payments de loans com
  label fixo `"Parcela única de empréstimo"`, ordenados por `day` asc.
- **RF-004:** a rota `app/api/bank/projection/route.ts` (único caller de
  `buildProjection`) passa a responder `{ days, premissas }`
  (`Response.json({ days: p.days, premissas: p.premissas })`).
- **RF-005:** o hook `useProjection` (`src/lib/hooks.ts`) passa a tipar o
  resultado como `fetchJson<ProjectionPayload>` (interface nomeada
  `ProjectionPayload { days: Array<{ day: string; saldo: number }>;
  premissas?: ProjectionPremissas }` entregue); a interface `ProjectionPremissas` é
  declarada/exportada no próprio `hooks.ts` com a MESMA shape do RF-003 (sem
  importar de analytics — manter independência; shape duplicada é o padrão
  existente). Campo `premissas` opcional para não quebrar o fixture
  `ok({ days: [] })` de `app/__tests__/page.test.tsx`.
- **RF-006:** UI do card de projeção (`app/page.tsx` ~717–770): o rodapé é
  reenquadrado como runway —
  com `firstNegative`: `"Caixa em conta cobre compromissos até {dateBR};
  a partir daí, depende de resgate de investimentos. "`;
  sem: `"Caixa em conta cobre os compromissos conhecidos nos próximos 60
  dias. "`;
  sufixo fixo: `"Estimativa só com recorrências comprovadas (≥3 meses estáveis
  e evidência recente) e pagamentos únicos conhecidos — não é uma fatura
  futura."`. Logo após, um `<details>` com `<summary>` "O que entra nesta
  estimativa" lista as premissas (renderizado só quando `premissas` existe e
  alguma lista é não-vazia): recorrentes como `"− {brl(monthly)}/mês · {label}"`
  (ou `"+"` quando `kind === "income"`) e únicos como
  `"− {brl(value)} em {dateBR(day)} · {label}"`. `brl` e `dateBR` já estão
  importados na página.
- **RF-007:** o aviso warn de `firstNegative` em `buildDestaques`
  (`src/lib/overview.ts:97-101`) passa a ser
  `"Caixa em conta fica negativo em {dateBR} ({brl}) — resolva com resgate de
  investimento."`; a asserção correspondente em
  `src/lib/__tests__/overview.test.ts:233` atualiza de
  `stringContaining("Projeção de caixa fica negativa em")` para
  `stringContaining("Caixa em conta fica negativo em")`.
- **RF-008:** o link do RecurrentsCard (`app/page.tsx:282-289`) usa janela de
  365 dias (`120 * 86_400_000` → `365 * 86_400_000`) e
  `title="Ver transações dos últimos 12 meses"`. O card já consome
  `detectRecurrents` via `/api/bank/recurrents`, então herda as regras novas
  sem outra mudança.

## Critérios de Aceite

- **AC-001:** recorrência com 6 meses estáveis de mesmo valor (meses -5..0) é
  detectada com `monthly` = mediana das somas mensais (= o valor) e
  `occurrences` = 6 (T-001/T-002; teste 3 de `recurrents.test.ts`).
- **AC-002:** assinatura mensal com só 2 meses de ocorrência (meses -1 e 0)
  NÃO é recorrência — estabilidade exige ≥3 meses estáveis (teste 2,
  comportamento invertido vs regra antiga).
- **AC-003:** frequência variável (4 lançamentos/mês durante 3 meses, meses
  -2..0) NÃO é recorrência — guard `items.length / months.size > 3` mantido
  (teste 1, ajustado).
- **AC-004:** assinatura estável terminando no mês -3 (3 ciclos perdidos) NÃO
  é detectada (teste 4); assinatura estável com ocorrências nos meses
  -3, -2, -1 (1 ciclo perdido) É detectada (teste 5) — fronteira do recency.
- **AC-005:** windfall income (2 créditos grandes no mês -4 — 10.000 e
  20.000 — + 1 crédito de 100 no mês 0) NÃO é detectado: a estabilidade falha
  (teste 6).
- **AC-006:** `buildProjection`: recorrência estável entra em `days` (saldos
  corretos, invariantes à data de execução) e em `premissas.recorrentes`;
  renda estável sem evidência recente (meses -9..-3) não entra (projeção plana,
  `premissas.recorrentes` vazio); windfall não entra; balloon payment de loan
  entra em `days` no dia exato e em `premissas.unicos` com
  `label: "Parcela única de empréstimo"` (T-001/T-002; casos 1–4 de
  `projection.test.ts`).
- **AC-007:** a UI renderiza o `<details>` "O que entra nesta estimativa" e,
  após o clique, exibe o valor formatado via `brl` (regex `/555,59/`, pois
  `brl` usa NBSP) (T-003; teste novo em `page.test.tsx`).
- **AC-008:** o texto do aviso warn de `firstNegative` é
  `"Caixa em conta fica negativo em …"` (T-002; asserção atualizada em
  `overview.test.ts`).
- **AC-009:** comportamento end-to-end com dados reais (réplica read-only das
  regras validada em 2026-08-07): `/api/bank/recurrents` e
  `/api/bank/projection` sem FGTS, sem Salary, sem Atacadão; `premissas` de
  income vazia; custo fixo (soma dos `monthly` de kind spend) ≈ R$ 3.489,01
  (±R$ 100 por sync) com seguro 555,59, Vivo 367,98 e Enel 578,82 presentes;
  nenhum delta diário positivo > R$ 10.000 (o salto de +R$ 86,3k desaparece);
  `firstNegative` ≈ 2026-10-04 (±3 dias de tolerância por sync recente); UI
  com rodapé de runway, `<details>` de premissas e "Custo fixo ≈" ≈ R$ 3,5k/mês
  (não ~R$ 8,9k da regra antiga).

## Fora de Escopo

- Projeção incluindo investimentos (CDB ~R$ 750k) — permanece ignorada por
  desenho; o rodapé explicita a dependência de resgate.
- Mudança de regra de balloon payments — continuam entrando como compromisso
  contratual conhecido.
- Edição de `src/banco-mcp.ts` — não consome `detectRecurrents`.
- Relaxamento do limiar de estabilidade para ±40% — contingência futura
  documentada, não aplicar sem evidência.
- Reintrodução manual/configurável de salário — volta automática quando houver
  3 meses estáveis + evidência recente, sem configuração.
- Testes em `src/lib/__tests__/recurrents.test.ts` e `projection.test.ts` são
  escritos pelo test-author (T-001); este artefato não implementa código.

## Referências

- Plano fonte de verdade: `local://honest-cash-projection-plan.md`
- Issue #25 — projeção de caixa e recorrentes honestos
- [plan.md](./plan.md) · [tasks.md](./tasks.md) ·
  [interface-contract.md](./contracts/interface-contract.md)
- Specs relacionadas: specs002-overview-ui-tests (extração de `overview.ts`),
  specs003-ui-tests-telas (cobertura de UI existente em `page.test.tsx`)
