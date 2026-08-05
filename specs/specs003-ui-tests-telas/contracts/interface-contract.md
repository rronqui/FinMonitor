# Interface Contract: specs003-ui-tests-telas

> **Versão:** 0.1.0
> **Status:** NA (justificativa abaixo)

## Escopo

Entrega estritamente de testes: 8 arquivos de teste novos em jsdom
(`src/components/__tests__/*.test.tsx` e `app/__tests__/*.test.tsx`) + 2
edições de `include` no `vitest.config.ts`. Nenhum código de produção é
criado, movido ou alterado.

## Justificativa do NA

Nenhuma fronteira de interface é criada ou alterada: não há API HTTP nova ou
modificada (as rotas `/api/bank/*` e `/api/chat` são apenas consumidas pelos
testes via hooks mockados — única exceção: `LoanDetail`, que exercita o POST
real em `/api/bank/loans` com `fetch` mockado —), nenhum formato externo de
dados e nenhum schema de banco muda. O `git diff` contra `main` deve conter
apenas `vitest.config.ts` e arquivos `*.test.tsx` novos (AC-009), o que é em
si a prova de que nenhuma superfície de contrato tocou. Não há
request/response, erros de API ou estados de UI novos a contratar — os
estados existentes das telas (loading/erro/vazio/happy path) são apenas
**testados**, não alterados.

## Schemas

NA — sem request/response novos.

## Erros

NA — sem API.

## Estados de UI

NA — nenhum estado novo; os estados existentes das telas e componentes são
exercidos pelos testes (AC-001..AC-008), não alterados.

## Changelog

| Versão | Data | Mudança |
|---|---|---|
| 0.1.0 | 2026-08-05 | Documento inicial: status NA explícito e justificado — entrega de testes sem fronteira/API/schema |
