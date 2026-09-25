# Terça no Supabase — etapa 6b: virada da produção (só o Terça)

## Objetivo
Passar a página de produção do Terça (`libertsapp.github.io/volei/`) a usar o backend novo (Edge Function `terca-api-teste`
no Supabase) em vez do Apps Script, sem perder check-ins, pagamentos ou fotos, com volta atrás em minutos. O grupo usa o app
toda semana; o próximo jogo é terça 2026-09-29. O Meme **não** é tocado (regra do projeto: Terça primeiro, Meme só com
autorização explícita).

## Decisões já tomadas (com o usuário)
- **Migração total, sem congelar e sem re-migrar os dados.** O usuário conferiu que o Terça original não teve atualização e
  que o Supabase está igual. Por isso não há janela de congelamento nem nova rodada de `migrar`, `migrar-fotos` ou `ajuste-3`.
- **Entrega simples (abordagem A):** trocar `SHEET_API_URL` no front, subir a versão e publicar. Sem interruptor `?backend=`
  no front (YAGNI; o rollback por revert basta).
- **Senhas antigas no histórico do git:** trocar as senhas mestras do Apps Script (Terça e Meme) antes do push. Não reescrever o
  histórico. O commit local `3763364` continua contendo valores que já não valem.

## Fora de escopo
- Qualquer alteração no Meme (`volei-meme-dashboard*.html`, `apps-script-codigo-volei-meme.gs`), exceto trocar a senha dele no
  editor do Apps Script (isso é só rotação de segredo, não replica funcionalidade).
- Reescrita do histórico do git.
- Throttling de ações públicas (item M6 do spec da 6a) e verificação local do token do Google.
- Desligar o Apps Script do Terça (fica vivo como reserva por 1 a 2 semanas).

## Passos, em ordem

### 1. Antes de publicar
1. **Trocar a senha mestra do Apps Script** do Terça e do Meme (o usuário faz no editor) e **reimplantar como Nova Versão**.
   Guardar as novas senhas no gerenciador de senhas. A senha da função no Supabase é independente e já está guardada.
2. **Teste de bloqueio por IP em duas redes** (seção 8 do guia de deploy, item 2): pendente porque o computador só tem cabo.
   Precisa de celular com dados móveis (app de requisições HTTP, tethering USB ou ferramenta online). É a única verificação
   aberta da função; deve ser feita antes da publicação.
3. **Conferir o `.gitignore`**: `.env`, `CHAVE/`, `supabase/.temp/` e `supabase/functions/*/backend/` (pasta gerada) fora do
   repositório. Conferir também com `git status` que nenhum segredo entra no commit.
4. **Origens da função:** `ORIGENS_PERMITIDAS` já está só com `https://libertsapp.github.io` (feito em 2026-09-25, verificado
   com 403 para `localhost:8000`). Nada a fazer; só não readicionar localhost.

### 2. A virada
1. No checkout principal, em `volei-dashboard.html`: trocar `SHEET_API_URL` (linha ~2944) por
   `https://lzwmirrjpoqucwlhgkku.supabase.co/functions/v1/terca-api-teste` e subir o rodapé para `Ver.: 13.0`.
   O checkout principal tem alterações não commitadas no `volei-dashboard.html` e o `index.html` apagado: revisar o `git diff`
   e decidir com o usuário o que entra no commit antes de misturar com a virada.
2. Validar a sintaxe do JS (`node --check`, conforme o CLAUDE.md).
3. Merge da branch `terca-supabase-migracao` na `main` (traz o backend, os SQLs, os scripts e a Edge Function; sem segredos) e
   `git push`. O push publica também os commits locais da `main` que estão à frente de `origin/main`.
4. **Teste no ar** em `libertsapp.github.io/volei/`: lista de jogadores carrega, login com Google funciona, check-in de teste
   (apagado depois) e troca de foto. Os `?id=` das fotos já apontam para o Storage do Supabase.
5. Conferir os logs da função (Supabase > Edge Functions > terca-api-teste > Logs) nos primeiros usos: sem
   `cf-connecting-ip ausente` e sem `Configuração incompleta`.

### 3. Rollback
Reverter o commit do front e dar push (Pages atualiza em ~1 min). O Apps Script continua intacto e com os dados de antes da
virada. Dados gravados no Supabase depois da virada **não voltam sozinhos** para a planilha: por isso a janela é curta e os
primeiros dias devem ser monitorados. Se houve escrita relevante depois da virada e o rollback for necessário, exportar essas
linhas do Supabase e lançá-las na planilha à mão.

### 4. Depois da virada
- Apagar a chave JSON do Google em `CHAVE/` e **regenerar a `service_role`** do Supabase (passou pelo chat); atualizar o
  `.env` local e reexecutar `supabase secrets` só se a função precisar (ela recebe a `service_role` injetada pelo Supabase, então
  a regeneração exige conferir se a função continua no ar).
- Remover as regras de permissão `Bash(npm run migrar)`, `criar-bucket-fotos`, `migrar-fotos*` e integração-etapa3c.
- Deixar o Apps Script do Terça vivo por 1 a 2 semanas e só então desligar.
- Atualizar a memória do projeto e o guia (`terca-supabase-deploy.md`) com o estado final.

## Riscos aceitos
- Quem estiver com o app aberto na hora da virada continua gravando no Apps Script até recarregar. O `sw.js` não usa cache,
  então um reload já basta.
- Abuso público residual (muitos GETs, spam de `incrementarAcesso`/`lerAoVivo`, qualquer conta Google cria check-ins) segue sem
  proteção, como registrado na 6a (M6).
- A regeneração da `service_role` pode interromper a função por instantes; fazer fora de horário de jogo.
- `Origin` é forjável fora do navegador; quem protege é o porteiro (token do Google ou chave mestra longa).

## Critérios de sucesso
- O grupo usa o Terça normalmente na terça 2026-09-29, sem perder check-in, pagamento ou foto.
- Nenhum segredo (senha mestra, `service_role`, chave JSON) no repositório publicado.
- Rollback comprovadamente possível (Apps Script intacto, procedimento acima).
- Teste de bloqueio por IP feito e aprovado (redes diferentes têm baldes diferentes).
