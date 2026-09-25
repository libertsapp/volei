# Terça no Supabase — etapa 6b (virada da produção) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer a página de produção do Terça (`https://libertsapp.github.io/volei/`) falar com a Edge Function `terca-api-teste` no Supabase em vez do Apps Script, com volta atrás em minutos.

**Architecture:** Nenhum código novo de backend. A virada é (1) rotacionar as senhas do Apps Script, (2) integrar `origin/main`, o v12.7 do front e a branch `terca-supabase-migracao` na `main`, (3) trocar `SHEET_API_URL` no `volei-dashboard.html` e subir para `Ver.: 13.0`, (4) publicar em duas etapas (integração primeiro, virada depois), (5) testar em produção e limpar. Produção é servida pelo `index.html`, que uma GitHub Action (`.github/workflows/sync-index.yml`) copia do `volei-dashboard.html` a cada push que o altere.

**Tech Stack:** git, GitHub Pages + Action, Node.js (checagem de sintaxe), Supabase CLI (`npx supabase`), PowerShell/Bash, `curl.exe`.

**Spec:** `docs/superpowers/specs/2026-09-25-terca-supabase-etapa-6b-virada-design.md`

## Global Constraints

- Só o **Terça**. Não editar, adicionar ao git nem publicar `volei-meme-dashboard*.html` (está untracked na raiz) nem `apps-script-codigo-volei-meme.gs`. A única coisa do Meme é trocar a senha no editor do Apps Script (Task 1).
- Nunca `git add -A` nem `git add .`: adicionar arquivos pelo nome. Continuam untracked e fora dos commits: `CLAUDE.md`, `docs/superpowers/financeiro-*.md`, `docs/superpowers/plans/2026-09-1*`, `docs/superpowers/plans/2026-09-22*`, `docs/superpowers/specs/2026-09-1*`, `tests/financeiro-puro.test.js`, `tests/helpers/`, `tests/jogador-card-sequencia.test.js`, `volei-meme-dashboard.html`.
- `git push` e qualquer ação no Apps Script/Supabase que afete produção só depois de **OK explícito do usuário naquele momento**.
- Regra do CLAUDE.md: validar a sintaxe do JS depois de editar o `.html` (`node --check`), subir o rodapé (`Ver.: 12.7` -> `Ver.: 13.0`, mudança grande vira número redondo) só no arquivo alterado.
- Commits terminam com a linha `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Nenhum segredo (`.env`, `CHAVE/`, `service_role`, senhas mestras) no repositório publicado.
- URL da função (valor exato): `https://lzwmirrjpoqucwlhgkku.supabase.co/functions/v1/terca-api-teste`
- Origem autorizada na função: só `https://libertsapp.github.io` (já gravada; não readicionar `localhost`).
- Windows/PowerShell 5.1: `curl.exe -d` leva aspas simples por fora, ex.: `-d '{\"action\":\"lerAoVivo\"}'`.
- Diretórios: **RAIZ** = `C:\Users\Heleno\OneDrive\Documentos\GitHub\voleis_VS` (branch `main`, é de onde se publica); **WT** = `RAIZ\.worktrees\terca-supabase-migracao` (branch `terca-supabase-migracao`, tem `node_modules`).

## Review Focus

1. **Push antes de trocar as senhas** publica a senha mestra antiga (commit `3763364`) num repo público. Gate na Task 1 e conferência antes de qualquer push (Task 5).
2. **`index.html` deletado localmente** (`D index.html`) bloqueia o merge com `origin/main` ou vai no commit como remoção e a produção fica sem página até a Action recriar. Task 3 restaura o arquivo e confere `git status`.
3. **`origin/main` divergiu** (7 commits locais vs 10 remotos, uploads manuais de `index.html`). Push simples é rejeitado. Task 3 integra por merge.
4. **URL do Apps Script sobrando no front** (outro `fetch`, texto fixo) faria parte do app gravar na planilha velha. Task 4 varre `script.google.com` e confere que só sobra o que for comentário.
5. **CORS sem `Access-Control-Allow-Origin` para a origem do Pages** faria o app quebrar só em produção (o localhost já não está autorizado, então não dá para testar de outra forma). Task 4 confere o cabeçalho com `curl` antes do push.
6. **Action cria um commit do bot depois do push**: o próximo push local é rejeitado se não der `git pull` antes. Task 5 puxa e confere o `index.html` remoto.
7. **Rotação da `service_role` derruba a função** ou deixa o `.env` local velho. Task 7 confere um GET logo após a rotação e só faz isso fora de horário de jogo.

---

### Task 1: Trocar as senhas mestras do Apps Script (Terça e Meme) — feito pelo usuário

**Files:** nenhum arquivo do repositório. Trabalho no editor do Apps Script de cada app (são os `.gs` locais, que ficam fora do git).

**Interfaces:**
- Consumes: acesso do usuário aos dois projetos no Google Apps Script e ao gerenciador de senhas.
- Produces: senhas novas do Terça e do Meme (diferentes das antigas e da senha da função no Supabase), gravadas no gerenciador; Apps Script de cada app reimplantado. A Task 5 só pode começar depois disto.

- [ ] **Step 1: Gerar duas senhas novas (uma por app), sem mostrá-las na tela**

No PowerShell (pode ser qualquer pasta):
```powershell
foreach ($nome in 'SENHA_TERCA','SENHA_MEME') { $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create(); $b = New-Object byte[] 32; $rng.GetBytes($b); $rng.Dispose(); Set-Item "Env:$nome" ([Convert]::ToBase64String($b).TrimEnd('=').Replace('+','-').Replace('/','_')) }
$env:SENHA_TERCA | Set-Clipboard
```
Guardar a senha do Terça no gerenciador (entrada "Vôlei Terça - Apps Script"). Depois `$env:SENHA_MEME | Set-Clipboard` e guardar a do Meme ("Vôlei Meme - Apps Script"). Fechar com `Set-Clipboard -Value $null`.

- [ ] **Step 2: Trocar `ADMIN_PASSWORD` no editor do Apps Script do Terça**

Colar a senha nova no valor de `ADMIN_PASSWORD` do `apps-script-codigo.gs` (no editor do Google, não no arquivo local do disco), salvar.

- [ ] **Step 3: Reimplantar o Terça como Nova Versão**

Editor do Apps Script > Implantar > Gerenciar implantações > lápis > Versão: **Nova versão** > Implantar. (Passo que mais se esquece: sem ele, a senha antiga continua valendo.)

- [ ] **Step 4: Repetir os Steps 2 e 3 no Apps Script do Meme**, com a senha do Meme.

- [ ] **Step 5: Confirmar que a senha antiga NÃO vale mais no Terça**

A URL do Apps Script do Terça é a de `SHEET_API_URL` no front (linha ~2944 do `volei-dashboard.html` da RAIZ). Enviar um `ping` administrativo com a senha **antiga** (o usuário digita no comando, sem colar em chat):
```powershell
$antiga = Read-Host "senha antiga do Terça"
curl.exe -s -L -X POST -H "Content-Type: text/plain;charset=utf-8" -d ('{\"action\":\"ping\",\"senha\":\"' + $antiga + '\"}') "<SHEET_API_URL do Terça>"
Remove-Variable antiga
```
Expected: resposta de erro de senha (não sucesso). Se o `ping` responder sucesso, a nova versão não foi implantada: repetir o Step 3.

- [ ] **Step 6: Registrar o gate**

Sem commit. Só prosseguir com "senhas trocadas e antiga recusada no Terça" confirmado pelo usuário.

---

### Task 2: Teste de bloqueio por IP em duas redes (item 2 da seção 8 do guia)

**Files:** nenhum. Referência: `docs/superpowers/terca-supabase-deploy.md` seção 8.

**Interfaces:**
- Consumes: função no ar, origem `https://libertsapp.github.io` na lista (o teste usa um cabeçalho `Origin` dessa origem, porque `localhost` já não é aceito).
- Produces: confirmação de que redes diferentes têm baldes diferentes. Pode ser feita a qualquer momento antes da Task 6; se o usuário só tiver a segunda rede depois, seguir com as Tasks 3-5 e fazer esta antes de considerar a virada encerrada (Task 6).

- [ ] **Step 1: Bloquear a rede atual (cabo) com 9 senhas erradas**

```powershell
1..9 | ForEach-Object { curl.exe -s -X POST -H "Origin: https://libertsapp.github.io" -H "Content-Type: text/plain" -d '{\"action\":\"ping\",\"senha\":\"errada\"}' https://lzwmirrjpoqucwlhgkku.supabase.co/functions/v1/terca-api-teste }
```
Expected: 8 respostas `Senha de administrador incorreta.` e a 9ª `Muitas tentativas. Tente de novo em alguns minutos.` (a chave mestra fica bloqueada ~15 min nesta rede; o login do Google continua funcionando).

- [ ] **Step 2: De outra rede (dados móveis via celular, tethering USB ou ferramenta HTTP online que deixe fixar `Origin`), dentro dos 15 min, uma tentativa**

Mesma requisição, uma vez.
Expected: `Senha de administrador incorreta.` (NÃO "Muitas tentativas").

- [ ] **Step 3: Interpretar**

Passou: cada rede tem o seu balde. Se as duas redes ficaram bloqueadas: parar, ver nos logs da função (Supabase > Edge Functions > terca-api-teste > Logs) se aparece `cf-connecting-ip ausente` e me avisar; a virada só segue depois de resolvido.

---

### Task 3: Integrar `origin/main`, o v12.7 e a branch na `main` (local, sem push)

**Files:**
- Modify (commit): `volei-dashboard.html` (na RAIZ; o conteúdo atual, v12.7, já é idêntico ao `index.html` que está em produção)
- Restore: `index.html` (na RAIZ; está `D` no working tree)
- Merge: `origin/main` e a branch `terca-supabase-migracao`

**Interfaces:**
- Consumes: Task 1 concluída não é necessária aqui (nada é publicado nesta task).
- Produces: `main` local contendo v12.7 commitado + uploads do remoto + backend do Supabase, pronta para push, com `index.html` presente e árvore limpa dos arquivos do Terça.

- [ ] **Step 1: Estado inicial**

Em RAIZ:
```bash
git fetch && git status -sb && git rev-list --left-right --count main...origin/main
```
Expected: `## main` com ` D index.html` e ` M volei-dashboard.html`; contagem `7  10` (ou os números atuais, com divergência).

- [ ] **Step 2: Confirmar que o v12.7 local é o que está em produção**

```bash
export MSYS_NO_PATHCONV=1
git show origin/main:index.html > "$TEMP/idx_origin.html" && cmp "$TEMP/idx_origin.html" volei-dashboard.html && echo IDENTICOS
```
Expected: `IDENTICOS`. Se diferente, PARAR: o `volei-dashboard.html` local não é o que está no ar e é preciso decidir com o usuário qual é a fonte.

- [ ] **Step 3: Restaurar o `index.html` (com OK do usuário) e conferir**

```bash
git restore index.html && git status -sb
```
Expected: some o ` D index.html`; sobra ` M volei-dashboard.html` mais os `??`. (`index.html` é regenerado pela Action a partir do `volei-dashboard.html`; o conteúdo vem do merge com `origin/main` no Step 6.)

- [ ] **Step 4: Validar sintaxe do JS do `volei-dashboard.html` atual**

```bash
node -e "const fs=require('fs');const c=fs.readFileSync('volei-dashboard.html','utf8');const m=c.match(/<script>([\s\S]*)<\/script>/);fs.writeFileSync(process.env.TEMP+'/check.js',m[1])" && node --check "$TEMP/check.js" && echo SINTAXE_OK
```
Expected: `SINTAXE_OK`.

- [ ] **Step 5: Commitar o v12.7 como está (sem trocar endereço ainda)**

```bash
git add volei-dashboard.html
git commit -m "Terça v12.7: versiona o volei-dashboard.html que já estava em produção

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Mesclar `origin/main` (uploads manuais de `index.html`)**

```bash
git merge origin/main -m "Merge origin/main (uploads manuais do index.html v12.7)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
Expected: merge limpo, só o `index.html` muda (sem conflito). Conferir: `git diff --stat HEAD~1 HEAD` mostra apenas `index.html`; e `cmp index.html volei-dashboard.html && echo IGUAIS`.

- [ ] **Step 7: Mesclar a branch do Supabase**

```bash
git merge terca-supabase-migracao -m "Merge terca-supabase-migracao (backend, SQLs, scripts e Edge Function)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
Expected: sem conflitos (a branch não altera `volei-dashboard.html`, `index.html` nem `sw.js`). Conferir: `git diff --stat main~1 main -- volei-dashboard.html index.html sw.js` sem saída.

- [ ] **Step 8: Varredura de segredos no que vai ser publicado**

```bash
git grep -nEI "eyJ[A-Za-z0-9_-]{30,}|sb_secret_|-----BEGIN (RSA )?PRIVATE KEY" -- . ':!package-lock.json'; echo "exit=$?"
git ls-files | grep -E "(^|/)\.env|^CHAVE/|\.gs$|supabase/\.temp|functions/terca-api-teste/backend/"; echo "exit=$?"
```
Expected: os dois comandos sem linhas e `exit=1`. Se aparecer qualquer arquivo ou chave, PARAR e não publicar.

- [ ] **Step 9: Rodar a suíte do backend no worktree (a branch merged não muda `backend/`)**

Em WT:
```bash
npm run test:backend
```
Expected: termina sem erro (todos os arquivos passam). Se algum falhar, parar e investigar antes de seguir.

- [ ] **Step 10: Conferir o estado final local**

Em RAIZ: `git status -sb && git log --oneline -6`
Expected: ausência de ` D index.html`; só sobram os `??` listados em Global Constraints; três commits novos (v12.7, merge origin, merge branch).

---

### Task 4: Trocar o endereço e subir a versão (local, sem push)

**Files:**
- Modify: `volei-dashboard.html` (RAIZ) — a constante `SHEET_API_URL` (linha ~2944) e o rodapé (`Ver.:`, linha ~2606).

**Interfaces:**
- Consumes: `main` da Task 3.
- Produces: um commit "virada" isolado e reversível (`git revert`), com `SHEET_API_URL` apontando para a função e `Ver.: 13.0`.

- [ ] **Step 1: Teste do que deve mudar (deve falhar antes da edição)**

```bash
grep -c "functions/v1/terca-api-teste" volei-dashboard.html; grep -c "Ver.: 13.0" volei-dashboard.html
```
Expected agora: `0` e `0` (a edição ainda não foi feita).

- [ ] **Step 2: Editar `SHEET_API_URL`**

Trocar, em `volei-dashboard.html`, exatamente esta linha:
```javascript
const SHEET_API_URL = "https://script.google.com/macros/s/AKfycbxOqq08EU0J49bCuUlidhRimvLYZi5jISo5h5moPHCqJDpJSNMWMql6tTmmrXnJcs9G-A/exec";
```
por:
```javascript
const SHEET_API_URL = "https://lzwmirrjpoqucwlhgkku.supabase.co/functions/v1/terca-api-teste";
```
Manter o comentário logo acima; se ele falar de "Apps Script", acrescentar uma linha: `/* Desde a 6b (2026-09) o backend é a Edge Function do Supabase; o Apps Script fica só como reserva. */`

- [ ] **Step 3: Subir o rodapé**

Trocar `Ver.: 12.7 ·` por `Ver.: 13.0 ·` (linha do `footer-line`).

- [ ] **Step 4: Testes de conteúdo (agora devem passar)**

```bash
grep -c "functions/v1/terca-api-teste" volei-dashboard.html; grep -c "Ver.: 13.0" volei-dashboard.html; grep -n "script.google.com" volei-dashboard.html
```
Expected: `1` (ou mais, se o comentário citar), `1`, e `grep -n "script.google.com"` sem linhas de código (linhas em comentário são aceitáveis; qualquer `fetch`/constante com o endereço do Apps Script = PARAR e tratar antes de seguir).

- [ ] **Step 5: Validar sintaxe (regra do CLAUDE.md)**

```bash
node -e "const fs=require('fs');const c=fs.readFileSync('volei-dashboard.html','utf8');const m=c.match(/<script>([\s\S]*)<\/script>/);fs.writeFileSync(process.env.TEMP+'/check.js',m[1])" && node --check "$TEMP/check.js" && echo SINTAXE_OK
```
Expected: `SINTAXE_OK`.

- [ ] **Step 6: Conferir CORS para a origem do Pages (não dá para testar do localhost)**

```powershell
curl.exe -s -i -H "Origin: https://libertsapp.github.io" -X POST -H "Content-Type: text/plain" -d '{\"action\":\"lerAoVivo\"}' https://lzwmirrjpoqucwlhgkku.supabase.co/functions/v1/terca-api-teste
curl.exe -s -i -H "Origin: https://libertsapp.github.io" https://lzwmirrjpoqucwlhgkku.supabase.co/functions/v1/terca-api-teste | Select-String -Pattern "HTTP/|access-control-allow-origin|vary"
```
Expected: no POST, `HTTP/... 200` com JSON (não `Origem não permitida`) e `access-control-allow-origin: https://libertsapp.github.io`; no GET, também o `access-control-allow-origin`. (`lerAoVivo` é público: não gasta tentativa de senha.) Se faltar o cabeçalho, PARAR: não publicar.

- [ ] **Step 7: Commit isolado da virada**

```bash
git add volei-dashboard.html
git commit -m "Terça v13.0: página passa a usar o backend no Supabase (Edge Function)

Rollback: git revert deste commit + push (o Apps Script segue intacto).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git log --oneline -1
```
Anotar o SHA (é o commit a reverter num rollback).

---

### Task 5: Publicar em duas etapas e acompanhar a Action

**Files:** nenhum arquivo novo; publicação da `main`.

**Interfaces:**
- Consumes: Task 1 (senhas trocadas) **confirmada pelo usuário**, Tasks 3 e 4 concluídas; OK explícito do usuário antes de cada `git push`.
- Produces: `origin/main` com a integração e com a virada; `index.html` remoto atualizado pela Action com a URL da função; produção usando o Supabase.

- [ ] **Step 1: Gate final antes de qualquer push (pedir OK ao usuário)**

Confirmar por escrito com o usuário: (a) senhas do Terça e do Meme trocadas e reimplantadas, com a antiga recusada (Task 1); (b) CORS OK (Task 4 Step 6); (c) varredura de segredos limpa (Task 3 Step 8). Sem os três, não publicar.

- [ ] **Step 2: Etapa A: publicar só a integração (a página segue no Apps Script)**

```bash
git push origin HEAD~1:main
```
(`HEAD~1` é o último commit antes da virada; a virada fica só local por enquanto.) Se o push for rejeitado por ter `origin/main` andado, `git fetch` e refazer o merge da Task 3 Step 6 antes de tentar de novo.
Expected: aceito. A Action `sync-index` roda (o `volei-dashboard.html` mudou) e copia o mesmo conteúdo v12.7 para o `index.html`; produção não muda de comportamento.

- [ ] **Step 3: Conferir que a produção continua funcionando no Apps Script**

Aguardar a Action (~1 min) e abrir `https://libertsapp.github.io/volei/` (Ctrl+F5). Expected: app abre e mostra jogadores como antes, rodapé `Ver.: 12.7`.

- [ ] **Step 4: Puxar o commit do bot antes de seguir**

```bash
git fetch && git pull --no-rebase origin main
```
Expected: traz `chore: sincroniza index.html ... [skip ci]` (se houver) sem conflito, mantendo o commit da virada por cima. Conferir `git log --oneline -4`.

- [ ] **Step 5: Etapa B: pedir OK e publicar a virada**

Com o OK do usuário:
```bash
git push origin main
```
Expected: aceito. A Action roda e copia `volei-dashboard.html` (13.0) para `index.html`.

- [ ] **Step 6: Conferir que o `index.html` publicado tem o endereço novo**

Após ~1-2 min:
```bash
git fetch && git show origin/main:index.html | grep -c "functions/v1/terca-api-teste"
curl.exe -s https://libertsapp.github.io/volei/ | Select-String -Pattern "functions/v1/terca-api-teste" -SimpleMatch | Measure-Object | Select-Object -ExpandProperty Count
```
Expected: `1` (ou mais) nos dois. Se o segundo for 0, o Pages ainda não publicou: esperar mais um pouco e repetir. Depois `git pull --no-rebase origin main` para trazer o commit do bot.

---

### Task 6: Teste em produção e monitoramento

**Files:** nenhum.

**Interfaces:**
- Consumes: Task 5 concluída. Interface: `https://libertsapp.github.io/volei/`.
- Produces: confirmação de que o grupo pode usar; se algo falhar, a Task 8 (rollback) é executada.

- [ ] **Step 1: Teste manual em produção (pelo usuário, com Ctrl+F5 e, no celular, fechar e reabrir o app instalado)**

Checklist (marcar cada um):
1. Rodapé mostra `Ver.: 13.0`.
2. Lista de jogadores e rodadas aparece, fotos carregam.
3. Login com o Google funciona; perfil correto (admin/organizador) aparece.
4. Check-in de teste feito e depois removido.
5. Troca de foto de um jogador de teste sobe e aparece.
6. Aba de financeiro e Ao Vivo abrem sem erro.
7. O contador de acessos no rodapé sobe após recarregar.

- [ ] **Step 2: Conferir os logs da função nos primeiros usos**

Supabase Dashboard > Edge Functions > terca-api-teste > Logs. Expected: chamadas 200; nenhum `cf-connecting-ip ausente` nem `Configuração incompleta no servidor.`.

- [ ] **Step 3: Confirmar que o Apps Script não está mais recebendo escrita do app**

Fazer um check-in de teste (Step 1.4) e conferir que a planilha do Terça **não** ganhou a linha (ela só aparece no Supabase). Expected: planilha sem a linha nova. Se ela aparecer, o navegador ainda está com a versão antiga: recarregar com Ctrl+F5.

- [ ] **Step 4: Concluir o Task 2 (bloqueio por IP em duas redes), se ainda pendente**

Sem ele, a virada só está "provisoriamente" concluída.

- [ ] **Step 5: Monitorar nos primeiros dias**

Depois da primeira terça (2026-09-29) com o grupo usando: conferir logs, financeiro e check-ins do dia. Só então seguir para as Tasks 7 e 9.

---

### Task 7: Pós-virada — segredos e permissões (fora do horário de jogo)

**Files:**
- Modify: `WT/.env` (local, gitignorado) só se a `service_role` for regenerada.
- Delete: pasta `CHAVE/` da RAIZ (chave JSON da service account do Google).
- Modify: `.claude/settings.json` ou `settings.local.json` do projeto (regras de permissão temporárias).

**Interfaces:**
- Consumes: virada estável (Task 6).
- Produces: nenhuma credencial que passou pelo chat continua válida; permissões temporárias removidas.

- [ ] **Step 1: Apagar a chave JSON do Google**

Confirmar que nada mais a usa (o Apps Script antigo do Terça só a usava para o script de migração) e apagar `RAIZ\CHAVE\`. No Google Cloud (IAM > Contas de serviço > Chaves), excluir também a chave no console.

- [ ] **Step 2: Regenerar a `service_role`**

Supabase Dashboard > Project Settings > API > (regenerar a chave `service_role` / JWT secret conforme o painel oferecer). Atualizar `SUPABASE_SERVICE_ROLE_KEY` em `WT\.env`. Se o Supabase indicar que a função precisa ser republicada para receber a chave nova, fazer em WT: `npm run preparar-edge` e `npx supabase functions deploy terca-api-teste --no-verify-jwt`.

- [ ] **Step 3: Confirmar que a função continua no ar depois da rotação**

```powershell
curl.exe -s https://lzwmirrjpoqucwlhgkku.supabase.co/functions/v1/terca-api-teste | Select-Object -First 1
```
Expected: JSON com `players` (não `Erro interno` nem `Configuração incompleta`). Se falhar, republicar a função (Step 2) e repetir; se persistir, ver os logs.

- [ ] **Step 4: Remover as regras de permissão temporárias**

Tirar de `.claude/settings.local.json` (ou onde estiverem) as regras `Bash(npm run migrar)`, `criar-bucket-fotos`, `migrar-fotos*` e integração-etapa3c.

---

### Task 8: Rollback (só se a Task 6 falhar)

**Files:** `volei-dashboard.html` (RAIZ) via revert do commit da virada.

**Interfaces:**
- Consumes: SHA do commit da virada (Task 4 Step 7); Apps Script do Terça intacto.
- Produces: produção de volta no Apps Script em ~1-2 min.

- [ ] **Step 1: Reverter e publicar (com OK do usuário)**

```bash
git pull --no-rebase origin main
git revert --no-edit <SHA_DA_VIRADA>
git push origin main
```
A Action recopia o `volei-dashboard.html` (agora 12.7, Apps Script) para o `index.html`.

- [ ] **Step 2: Conferir**

`curl.exe -s https://libertsapp.github.io/volei/ | Select-String -Pattern "script.google.com" -SimpleMatch | Measure-Object | Select-Object -ExpandProperty Count` deve ser `1` ou mais; abrir o app (Ctrl+F5) e conferir que carrega os dados do Apps Script.

- [ ] **Step 3: Recuperar o que foi escrito no Supabase durante a janela**

Listar check-ins/pagamentos/rodadas criados no Supabase desde a virada (SQL Editor: linhas com data de criação posterior à hora da virada) e lançá-los na planilha à mão. Registrar em memória o que houve.

---

### Task 9: Fechamento — memória e guia

**Files:**
- Modify: `docs/superpowers/terca-supabase-deploy.md` (RAIZ e WT, mesmo texto) — nota final da virada.
- Modify: memória `project_terca_supabase.md`.

**Interfaces:**
- Consumes: virada estável e Tasks 6-7 concluídas.
- Produces: registro do estado final para futuras sessões.

- [ ] **Step 1: Atualizar o guia com o estado final**

Acrescentar ao fim do `terca-supabase-deploy.md`: data da virada, `SHEET_API_URL` em uso, como reverter (Task 8), e que o Apps Script do Terça fica como reserva até `<data>` (1-2 semanas depois da virada).

- [ ] **Step 2: Atualizar a memória do projeto**

Registrar: virada feita em `<data>`, `Ver.: 13.0`, Apps Script como reserva, o que ficou pendente (desligar o Apps Script, Meme ainda no Apps Script com a senha nova, M6).

- [ ] **Step 3: Commit do guia**

```bash
git add docs/superpowers/terca-supabase-deploy.md
git commit -m "docs: guia de deploy com o estado final da virada 6b

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
Publicar só se o usuário quiser (é só documentação).

- [ ] **Step 4: Decidir o desligamento do Apps Script do Terça**

1-2 semanas depois da virada, com o grupo usando sem problemas: perguntar ao usuário se desliga (excluir a implantação ou arquivar o projeto). Não desligar sem pedido explícito.
