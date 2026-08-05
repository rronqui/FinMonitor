# Tasks: specs001-schema-migrations

> Deriva de [plan.md](./plan.md). Convenções: `[P]` = paralelizável.
> Padrão de testes do repo: `src/lib/__tests__/prune.test.ts` — `mkdtempSync` em
> `tmpdir` + `process.env.FINMONITOR_DB_PATH` + `await import("../db")` (import
> dinâmico obrigatório — env lido no load do módulo, `src/lib/db.ts:6`).

## Onda 1 — RED (paralelo, globs disjuntos)

| ID | Descrição | AC | Dependências | Globs permitidos | Status |
|---|---|---|---|---|---|
| T-001 [P] | **test-author, RED** — criar `src/lib/__tests__/migrations.test.ts` com os testes do **mecanismo**: (a) DB novo termina em `CURRENT_SCHEMA_VERSION` com todas as tabelas/colunas finais (AC-001); (b) idempotência — reabrir o DB não re-executa migrações já aplicadas (AC-002); (c) versão futura aborta com erro explícito (AC-003); (d) transacionalidade — uma migração que falha não deixa estado intermediário (AC-004); (e) evidência comportamental da remoção do ad-hoc: DB novo idêntico ao resultado das migrações (AC-008). Testes devem falhar contra o código atual (mecanismo `src/lib/migrations.ts` ainda não existe). | AC-001, AC-002, AC-003, AC-004, AC-008 | — | `src/lib/__tests__/migrations.test.ts` | PENDING |
| T-002 [P] | **test-author, RED** — criar `src/lib/__tests__/migrations-legacy.test.ts` com os testes do **DB legado**: construir manualmente um DB com o schema antigo (tabelas v1 + transações sem `kind`/`abs_amount`/`desc_norm`), abrir via `db()` e assertar dados intactos + derivados corretos (`kind` por categoria+tipo de conta; `abs_amount = ABS(CAST(amount AS REAL))`) (AC-005); correção manual de `kind` sobrevive a reaberturas (AC-006); backfill de `desc_norm` preenche apenas NULLs, idêntico a `normalizeDescription(description ?? '')` (AC-007). | AC-005, AC-006, AC-007 | — | `src/lib/__tests__/migrations-legacy.test.ts` | PENDING |

## Onda 2 — GREEN+REFACTOR (serial, depende da onda 1)

| ID | Descrição | AC | Dependências | Globs permitidos | Status |
|---|---|---|---|---|---|
| T-003 | **backend-developer, GREEN+REFACTOR** — criar `src/lib/migrations.ts` e reescrever `src/lib/db.ts` conforme [plan.md](./plan.md) até a suíte inteira (testes novos + 31 existentes) ficar verde. **Sem alterar testes.** Refactor permitido dentro dos globs após o GREEN. | AC-001, AC-002, AC-003, AC-004, AC-005, AC-006, AC-007, AC-008 | T-001, T-002 | `src/lib/migrations.ts`, `src/lib/db.ts` | PENDING |

## Fora de Escopo

- Down-migrations, CLI de migração.
- Mudanças em `repo.ts`/`analytics.ts` (não necessárias).
- `PRAGMA user_version` (decisão `meta.schema_version`, documentada na spec).
