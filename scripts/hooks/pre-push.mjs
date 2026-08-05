// Guardrail local: impede push direto na main — mudanças entram via PR.
// Bypass explícito: git push --no-verify.
const branch = process.env.GIT_PUSH_REF ?? process.env.GIT_REF ?? "";
if (/^refs\/heads\/main$/.test(branch)) {
  console.error("\n[pre-push] Push direto na 'main' está bloqueado.");
  console.error("[pre-push] Crie uma branch, abra um PR e faça o merge via GitHub.\n");
  process.exit(1);
}
process.exit(0);
