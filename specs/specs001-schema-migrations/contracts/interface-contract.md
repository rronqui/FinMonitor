# Interface Contract: specs001-schema-migrations

> **Versão:** 0.1.0
> **Status:** NA (justificativa abaixo)

## Escopo

Mudança estritamente interna à camada de dados (`src/lib`): substituição dos
`CREATE TABLE IF NOT EXISTS` + ALTERs condicionais ad-hoc em `src/lib/db.ts` por um
mecanismo de migrações versionadas (`src/lib/migrations.ts`).

## Justificativa do NA

Nenhuma fronteira de interface é criada ou alterada: nenhuma API HTTP, nenhum
componente de UI, nenhum formato externo de dados muda. As tabelas e colunas finais
do banco permanecem idênticas às de hoje — apenas o mecanismo que chega até elas é
versionado. Não há request/response, erros de API ou estados de UI a contratar.

## Superfície interna afetada

Única superfície nova (interna ao módulo de dados, não contratada externamente):

```ts
// src/lib/migrations.ts
export const CURRENT_SCHEMA_VERSION: number;
export interface Migration { version: number; name: string; run(d: Database): void }
export const migrations: Migration[]; // ordenadas por version
export function migrate(d: Database): void;
```

A assinatura pública de `db()` em `src/lib/db.ts` não muda.

## Schemas

NA — sem request/response.

## Erros

NA — sem API. (Internamente: `migrate(d)` lança `Error` explícito quando o banco tem
versão maior que `CURRENT_SCHEMA_VERSION` — forward-only, AC-003.)

## Estados de UI

NA — sem UI.

## Changelog

| Versão | Data | Mudança |
|---|---|---|
| 0.1.0 | 2026-08-05 | Documento inicial: status NA justificado; superfície interna `migrations.ts` registrada |
