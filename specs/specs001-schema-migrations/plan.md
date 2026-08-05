# Plan: specs001-schema-migrations

> **Feature:** `specs001-schema-migrations`
> **Spec:** [spec.md](./spec.md)

## Arquitetura

**Novo módulo `src/lib/migrations.ts`** com a superfície interna:

- `export const CURRENT_SCHEMA_VERSION: number` — versão final (= 5 nesta entrega).
- `export interface Migration { version: number; name: string; run(d: Database): void }`.
- `export const migrations: Migration[]` — ordenada por `version`.
- `export function migrate(d: Database): void`:
  1. lê `schema_version` da tabela `meta` (ausente/NaN → `0`);
  2. se a versão registrada for maior que `CURRENT_SCHEMA_VERSION`, lança `Error`
     explícito contendo as duas versões (forward-only, AC-003);
  3. aplica cada migração com `version > atual` dentro de
     `d.transaction(() => m.run(d))` (AC-004);
  4. grava a nova versão no `meta` ao final de cada migração (AC-002 — uma
     interrupção no meio retoma da última versão gravada).

**Migrações 1..5** — preservam o SQL atual, extraídas dos blocos ad-hoc:

| v | Conteúdo | Origem |
|---|---|---|
| 1 | As 9 `CREATE TABLE IF NOT EXISTS` + `idx_tx_account_date` | `src/lib/db.ts:15-102` |
| 2 | `ALTER` condicional `kind`/`abs_amount` + backfill (`WHERE kind IS NULL`) | `src/lib/db.ts:106-118` |
| 3 | UPDATE classificação `investment` — agora executa UMA vez | `src/lib/db.ts:119-124` |
| 4 | `CREATE TABLE investment_movements` | `src/lib/db.ts:125-134` |
| 5 | `ALTER` condicional `desc_norm` + backfill com UPDATE único `WHERE desc_norm IS NULL` (sem loop por linha) | `src/lib/db.ts:135-144` |

**`src/lib/db.ts`:** o `d.exec` gigante e o bloco v2-v5 viram uma chamada `migrate(d)`
após os pragmas (`journal_mode = WAL`). A inicialização de DBs novos termina em
`CURRENT_SCHEMA_VERSION` com todas as migrações aplicadas em ordem; idempotência
garantida pelos `IF NOT EXISTS` e pelos guards das migrações.

## Stack e Dependências

| Componente | Tecnologia | Justificativa |
|---|---|---|
| Runtime | Next.js 16 + TypeScript, Node >= 22 | stack atual do projeto |
| Banco | better-sqlite3 ^13 | já em uso; `d.transaction()` nativo para AC-004 |
| Testes | vitest 4 | padrão do repo (`src/lib/__tests__/`) |
| Gerenciador | npm | scripts existentes (`npm test`, `npm run build`) |

Nenhuma dependência nova é introduzida.

## Arquivos Afetados

| Arquivo | Mudança |
|---|---|
| `src/lib/migrations.ts` | **criado** — mecanismo + migrações 1..5 |
| `src/lib/db.ts` | reescrito: blocos ad-hoc (linhas 15-144) substituídos por `migrate(d)` |

## Tarefas Derivadas

| ID | Descrição | AC | Dependências |
|---|---|---|---|
| T-001 | RED: testes do mecanismo (`migrations.test.ts`) | AC-001, AC-002, AC-003, AC-004, AC-008 | — [P] |
| T-002 | RED: testes de DB legado (`migrations-legacy.test.ts`) | AC-005, AC-006, AC-007 | — [P] |
| T-003 | GREEN+REFACTOR: `migrations.ts` + reescrita de `db.ts` | AC-001..AC-008 | T-001, T-002 |

Detalhes, ondas e globs em [tasks.md](./tasks.md).

## Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| DB de produção (`data/finmonitor.db`) já foi aberto pelo código antigo: colunas derivadas podem existir sem `schema_version` | migração 2/5 falharia em `ALTER` duplicado | tolerar colunas já presentes via guard por `PRAGMA table_info`, exatamente como hoje (`src/lib/db.ts:104-106`) |
| Transação única por migração exige que os backfills caibam nela | falha em volumes grandes | volume é local; cabe confortavelmente; nenhuma mudança necessária |
| `env` lido no load do módulo (`FINMONITOR_DB_PATH`, `src/lib/db.ts:6`) | testes apontariam para o DB errado | padrão consolidado do repo: `mkdtempSync` + setar `process.env.FINMONITOR_DB_PATH` **antes** de `await import("../db")` |
| Migração v3 muda de "toda abertura" para "uma vez" | correções manuais passam a sobreviver (mudança intencional) | coberto por AC-006; comportamento novo é o desejado (fix) |

Migrações são **forward-only**: não há down-migrations (política já documentada no
README do projeto; constitution §2).
