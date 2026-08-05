# FinMonitor

Dashboard financeiro pessoal construído sobre **Open Finance Brasil**. O FinMonitor conecta-se às suas contas bancárias via um servidor MCP (Banco MCP / mcp.ai), sincroniza dados para um snapshot SQLite local e apresenta tudo em uma interface web com gráficos, análises e um chat com IA que consulta os seus próprios dados.

## Funcionalidades

- **Dashboard** — visão geral de saldo, gastos e receitas
- **Transações** — extrato consolidado de todas as contas, com categorização automática
- **Cartões** — faturas de cartão de crédito, comparação entre faturas e recorrentes
- **Investimentos** — carteira, aportes/resgates e reconstrução da série investida
- **Empréstimos** — contratos ativos
- **Conexões** — gerenciamento das instituições conectadas (link de autorização Open Finance)
- **Chat com IA** — dock de chat com tool-calling: faz perguntas em linguagem natural e a IA consulta as APIs locais (transações, orçamentos, projeções, insights, benchmarks) para responder

## Arquitetura

- **Frontend:** Next.js 16 (App Router), React 19, Tailwind CSS 4, Recharts, TanStack React Query
- **Backend:** API routes do Next.js (`app/api/`) servindo dados do SQLite
- **Dados:** snapshot local em SQLite (`better-sqlite3`, modo WAL) em `data/finmonitor.db`
- **Integração bancária:** cliente MCP sobre Streamable HTTP (`@modelcontextprotocol/sdk`) falando com o Banco MCP (Open Finance Brasil) hospedado em `api.mcp.ai`
- **IA:** Vercel AI SDK (`ai` + `@ai-sdk/react`) com provedor OpenAI-compatível (padrão: Ollama local); chat usa tool-calling sobre as APIs do próprio app
- **Sincronização:** `syncAll()` coleta conexões, contas, transações (até 4 páginas por conta), faturas, investimentos e empréstimos e persiste tudo em uma transação; respeita o rate-limit do provedor com pausas entre chamadas

```
Banco MCP (Open Finance) ──MCP/HTTP──▶ sync (src/lib/sync.ts) ──▶ SQLite (data/finmonitor.db)
                                                                        │
                                          app/api/* (Next.js) ◀─────────┘
                                                │
                                    Dashboard + páginas + Chat IA
```

## Requisitos

- **Node.js >= 22**
- Uma conta/token no provedor Banco MCP (mcp.ai) com sessão Open Finance autorizada
- (Opcional) Ollama ou outro endpoint OpenAI-compatível para o chat com IA

## Como rodar

```bash
npm install

# configure o ambiente (crie o .env na raiz — ver variáveis abaixo)

npm run dev            # http://localhost:3000
```

Na primeira execução, acesse **Conexões** (ou rode o smoke test) e abra o link de autorização para conectar sua instituição bancária.

### Modo produção (start/stop)

```bash
npm run start:server   # build automático se ausente; sobe em background na porta 3000
npm run stop:server    # encerra o servidor iniciado acima
```

- Log do servidor: `logs/server.log` (acompanhe com `powershell Get-Content logs/server.log -Wait`).
- O servidor roda em background e sobrevive ao fechamento do terminal — use `stop:server` para derrubá-lo.
- Start duplo é bloqueado (avisa se já estiver rodando); o PID fica registrado em `.server.pid`.
- Opções: `node scripts/start.mjs --port 8080 --host 127.0.0.1 --force-build`.
- Para desenvolvimento com hot-reload, use `npm run dev` em vez do start/stop.

### Variáveis de ambiente (`.env`)

Crie um arquivo `.env` na raiz do projeto a partir do `.env.example` (copie e preencha), com as variáveis abaixo.

| Variável | Descrição |
|---|---|
| `MCP_AI_TOKEN` | Token Bearer permanente do Banco MCP (obrigatório) |
| `MCP_URL` | URL do servidor MCP (obrigatório) |
| `OPENFINANCE_BASE` | Base REST Open Finance usada pelo cliente |
| `LLM_BASE_URL` | Endpoint OpenAI-compatível para o chat (ex.: `http://localhost:11434/v1`) |
| `LLM_MODEL` | Modelo usado pelo chat |
| `LLM_API_KEY` | Chave de API do chat (opcional; padrão `"ollama"` — suficiente para Ollama local; obrigatória para provedores hospedados, ex.: OpenAI/Groq) |
> **Atenção:** o `.env` e a pasta `data/` estão no `.gitignore` — nunca versione credenciais nem o banco local.

## Scripts

| Comando | Descrição |
|---|---|
| `npm run dev` | Servidor de desenvolvimento (Next.js) |
| `npm run build` | Build de produção |
| `npm run start:server` | Inicia o servidor de produção em background (build automático se ausente; log em `logs/server.log`) |
| `npm run stop:server` | Para o servidor iniciado por `start:server` |
| `npm run smoke` | Fluxo ponta a ponta via CLI: conecta ao MCP, autentica, lista conexões/contas, extrai transações e faturas (`tsx src/main.ts`) |
| `npm test` | Testes com Vitest (semântica, recorrências, categorização, séries, faturas etc.) |
| `npm run typecheck` | Checagem de tipos (`tsc --noEmit`) |

O start aceita opções: `node scripts/start.mjs --port 8080 --host 127.0.0.1 --force-build`.

## Versionamento e releases

O projeto segue [SemVer](https://semver.org/lang/pt-BR/): **MAJOR** para breaking changes, **MINOR** para novas features, **PATCH** para bugfixes. Enquanto estivermos em `1.x`, breaking changes exigem nota explícita.

Toda mudança no código entra via GitHub: abra uma **issue** (bug ou nova feature), crie uma branch (`fix/#N-…` ou `feat/#N-…`) e abra um **PR** vinculado (`Closes #N`). O merge na `main` é protegido (branch protection + hooks locais impedem push direto).

Os commits usam [Conventional Commits](https://www.conventionalcommits.org/) — o tipo do commit determina o bump de versão (`fix:` → patch, `feat:` → minor, `!` → major), validado por commitlint no hook de commit.

A numeração de versão, o `CHANGELOG.md` e a tag de release são mantidos automaticamente pelo **release-please**: a cada push na `main` ele mantém um PR de release aberto; ao mergeá-lo, a tag `vX.Y.Z` e o GitHub Release são criados. Nunca edite `version` no `package.json` manualmente.

A versão exibida na sidebar vem de `NEXT_PUBLIC_APP_VERSION` (injetado do `package.json` no build). Após um release, atualize o servidor local:

```powershell
git pull
npm run start:server -- --force-build
```

**Antes de qualquer release com mudança de dados**: faça backup de `data/finmonitor.db` (SQLite local, fora do git). Migrações são forward-only — reverter código não reverte schema.

## Estrutura

```
app/                  # páginas e API routes (Next.js App Router)
  api/bank/*          # endpoints servidos do SQLite (sync, transactions, bills, insights…)
  api/chat            # endpoint do chat com IA (tool-calling)
src/
  banco-mcp.ts        # cliente MCP tipado do Banco MCP
  main.ts             # smoke test CLI (npm run smoke)
  lib/
    db.ts             # conexão SQLite + schema/migrações
    banco-rest.ts     # camada REST sobre o provedor Open Finance
    sync.ts           # sincronização provedor → SQLite
    repo.ts           # leitura/escrita no snapshot
    semantics.ts      # normalização de descrições e detecção de recorrências
    analytics.ts      # séries, orçamentos, projeções, insights
  components/chat/    # ferramentas e prompt do chat com IA
data/                 # SQLite local (não versionado)
scripts/              # start/stop do servidor de produção
logs/                 # saída do servidor em produção (não versionado)
```
