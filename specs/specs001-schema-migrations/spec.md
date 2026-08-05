# Spec: specs001-schema-migrations

> **Feature:** `specs001-schema-migrations`
> **Status:** Approved
> **Autor:** spec-kit-author
> **Data:** 2026-08-05

## Contexto

O `db()` em `src/lib/db.ts:10-147` evoluiu por acréscimos ad-hoc: um bloco único de
`CREATE TABLE IF NOT EXISTS` (linhas 15-102) seguido de cinco "migrações" em comentários:

- **v2** (`src/lib/db.ts:106-118`): ALTER condicional adicionando `kind`/`abs_amount` + backfill.
- **v3** (`src/lib/db.ts:119-124`): UPDATE da classificação `investment` que roda em
  **toda** abertura do banco — sobrescrevendo correções manuais de `kind`.
- **v4** (`src/lib/db.ts:125-134`): `CREATE TABLE investment_movements`.
- **v5** (`src/lib/db.ts:135-144`): ALTER condicional `desc_norm` + backfill por linha
  sobre **todas** as linhas, a cada primeira abertura da sessão.

Não há registro persistente de qual versão de schema foi aplicada; os guards são
heurísticos (`PRAGMA table_info`, NULLs). Consequências: trabalho repetido a cada
abertura, comportamento de sobrescrita na v3 e impossibilidade de detectar um banco
mais novo que o código.

**Issue:** #16 — "Migrações de schema versionadas com PRAGMA user_version no db.ts,
substituindo os ALTERs condicionais ad-hoc".

### Decisão registrada: `meta.schema_version` em vez de `PRAGMA user_version`

Acordada com o usuário: a versão do schema será persistida na tabela `meta` existente
(key `schema_version`) em vez do `PRAGMA user_version`. Justificativa: `meta` já é o
mecanismo de metadados do app (`getMeta`/`setMeta`, `src/lib/db.ts:149-159`); o efeito
é o mesmo (schema versionado, forward-only) sem introduzir um segundo mecanismo
(constitution §6). **Se o usuário vetar, volta-se para `PRAGMA user_version`** — a
arquitetura das migrações não muda, apenas onde a versão é lida/gravada.

Nota: os backfills v2/v5 existem apenas para reparar dados legados de versões
anteriores — a ingestão atual já insere `kind`/`abs_amount`/`desc_norm`
(`src/lib/repo.ts:68-73`, comentário na linha 67).

## Requisitos Funcionais

- **RF-001:** Mecanismo de migrações versionadas em `src/lib/migrations.ts`
  (`CURRENT_SCHEMA_VERSION`, lista ordenada de `Migration`s, função `migrate(d)`),
  chamado por `db()` após os pragmas.
- **RF-002:** Versão do schema persistida na tabela `meta` (key `schema_version`);
  ausência/NaN tratada como versão 0.
- **RF-003:** Migrações 1..5 preservando o SQL atual (extraídas dos blocos ad-hoc),
  cada uma aplicada exatamente uma vez por banco.
- **RF-004:** Forward-only: banco com versão maior que `CURRENT_SCHEMA_VERSION`
  aborta com erro explícito.
- **RF-005:** Cada migração executa dentro de uma transação (`d.transaction()`).
- **RF-006:** `db.ts` livre dos blocos ad-hoc: o `d.exec` gigante e os blocos v2-v5
  são substituídos pela chamada `migrate(d)` — substituição, não remendo.

## Critérios de Aceite

| AC | Critério (verificável) | Tarefa(s) | Teste previsto |
|---|---|---|---|
| **AC-001** | DB novo criado por `db()` termina com `schema_version = CURRENT_SCHEMA_VERSION` no `meta` e todas as tabelas/colunas finais presentes (9 tabelas + colunas `kind`/`abs_amount`/`desc_norm` em `transactions` + `investment_movements`). | T-001 | `src/lib/__tests__/migrations.test.ts` |
| **AC-002** | `db()` aplica apenas migrações com versão maior que a registrada no `meta`; reabrir o DB não re-executa migrações já aplicadas (idempotência). | T-001 | `src/lib/__tests__/migrations.test.ts` |
| **AC-003** | DB com `schema_version` maior que `CURRENT_SCHEMA_VERSION` aborta com erro explícito (forward-only, sem corrupção silenciosa). | T-001 | `src/lib/__tests__/migrations.test.ts` |
| **AC-004** | Nenhuma migração roda parcialmente: cada migração é transacional (envolvida em `d.transaction()`); falha numa etapa não deixa schema em estado intermediário. | T-001 | `src/lib/__tests__/migrations.test.ts` |
| **AC-005** | DB com schema antigo (sem `kind`/`abs_amount`/`desc_norm`) e com dados migra para o schema final com dados intactos e colunas derivadas preenchidas corretamente (`kind` por categoria + tipo de conta; `abs_amount = ABS(CAST(amount AS REAL))`). | T-002 | `src/lib/__tests__/migrations-legacy.test.ts` |
| **AC-006** | A classificação `'investment'` (categoria IN (`'Fixed income'`, `'Investments'`, `'Variable income'`, `'Funds'`) com `kind` IN (`'spend'`, `'income'`)) executa UMA vez na migração v3; correções manuais de `kind` feitas depois NÃO são sobrescritas em aberturas subsequentes (fix do comportamento atual, em que o UPDATE roda em toda abertura). | T-002 | `src/lib/__tests__/migrations-legacy.test.ts` |
| **AC-007** | Backfill de `desc_norm` preenche APENAS linhas com `desc_norm` NULL, com resultado idêntico a `normalizeDescription(description ?? '')` — hoje o loop roda sobre TODAS as linhas a cada primeira abertura. | T-002 | `src/lib/__tests__/migrations-legacy.test.ts` |
| **AC-008** | `db.ts` não contém mais `CREATE TABLE IF NOT EXISTS` + ALTERs condicionais ad-hoc fora do mecanismo versionado; o mecanismo antigo foi substituído, não remendado. | T-001 | `src/lib/__tests__/migrations.test.ts` (evidência comportamental: DB novo idêntico ao resultado das migrações) |

## Fora de Escopo

- Down-migrations / rollback (política forward-only, constitution §2).
- CLI de migração.
- Mudanças em `repo.ts`/`analytics.ts` (não necessárias — a ingestão já grava as
  colunas derivadas, `src/lib/repo.ts:67-73`).
- `PRAGMA user_version` — decisão `meta.schema_version` registrada acima.

## Referências

- Issue #16 (FinMonitor).
- `src/lib/db.ts:10-147` — estado atual ad-hoc; `:149-159` — `getMeta`/`setMeta`.
- `src/lib/repo.ts:68-73` — ingestão já insere colunas derivadas.
- `src/lib/semantics.ts` — `normalizeDescription` (backfill v5).
- Padrão de testes: `src/lib/__tests__/prune.test.ts` (mkdtempSync + `FINMONITOR_DB_PATH`
  + `await import("../db")`).
- [plan.md](./plan.md) · [tasks.md](./tasks.md) ·
  [interface-contract.md](./contracts/interface-contract.md)
