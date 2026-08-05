# Constitution: FinMonitor

> Princípios constitucionais do projeto. Toda spec, plan e tarefa deve respeitá-los;
> mudanças nestes princípios exigem aprovação explícita do usuário.

1. **Dados primeiro.** Nenhuma migração ou mudança de schema pode perder dados.
   Dados legados são preservados intactos e derivados (colunas calculadas) são
   preenchidos corretamente na migração — nunca apagados, truncados ou sobrescritos.
2. **Forward-only.** Migrações avançam o schema para a frente; não existem
   down-migrations (política já documentada no README do projeto). Banco com versão
   à frente do código é erro explícito, nunca corrupção silenciosa.
3. **Conventional Commits.** Todo commit segue o padrão (`feat:`, `fix:`, `chore:`...)
   validado pelo commitlint; o release-please deriva o SemVer daqui.
4. **CI como gate.** `typecheck`, `npm test` e `npm run build` no CI são a definição
   de pronto. Nada mergeia com CI vermelho.
5. **Sem testes de fachada.** Todo teste defende um contrato observável e falha
   diante de um bug plausível. Proibido testar plumbing, texto-fonte ou defaults
   incidentais; proibido mockar o que o teste deveria exercer.
6. **Um mecanismo por preocupação.** Metadados do app vivem na tabela `meta`;
   não se introduz segundo mecanismo (ex.: PRAGMA user_version) para o que `meta`
   já resolve.
