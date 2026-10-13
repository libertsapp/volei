# Grupos independentes — colocar no ar (Fase 4)

Guia do USUÁRIO, passo a passo. O assistente não publica nada; ele confere cada passo quando você avisar.
Tempo total: uns 30 minutos (mais a espera do DNS, que costuma levar de 5 minutos a 1 hora).

**O que muda para o Terça e o Meme:** nada. O Terça vai para a v18.0, mas o "modo grupo" só liga em
`volei.memberstars.com`; em `memberstars.com/volei/` e no Vercel do Terça tudo continua igual.

---

## 0. Antes de tudo: o código na `main` (o assistente faz, com o seu OK)

Mesclar a branch `grupos-fase1` na `main` e enviar (`git push`). Isso publica o Terça v18.0 no GitHub Pages e no
Vercel. Conferir depois: `https://memberstars.com/volei/` abre normal, logado como antes, rodapé `Ver.: 18.0`.

## 1. Supabase — banco, fotos e função (projeto `lzwmirrjpoqucwlhgkku`)

1. **SQL Editor**, nesta ordem (cada arquivo inteiro, uma vez):
   1. `sql/liga/ajuste-1-cidade.sql` — cidade/UF na liga (Terça e Meme ficam em Santa Luzia/MG).
   2. `sql/grupos/schema-grupos.sql` — o schema `grupos` inteiro.
2. **Configurações → Data API → Exposed schemas**: acrescentar `grupos` (ao lado de public, meme e liga) e salvar.
3. **Storage → New bucket**: nome `fotos-grupos`, marcar **Public bucket**.
4. **Segredo da função** (terminal do VS Code, pasta `volei`):
   ```powershell
   npx supabase secrets set GRUPOS_ORIGENS_PERMITIDAS=https://volei.memberstars.com --project-ref lzwmirrjpoqucwlhgkku
   ```
5. **Publicar a função**:
   ```powershell
   npm run preparar-edge -- grupos-api
   npx supabase functions deploy grupos-api --no-verify-jwt --project-ref lzwmirrjpoqucwlhgkku
   ```
   (Se reclamar de Docker, acrescente `--use-api` no fim.)
6. **Avise o assistente** — ele confere se a função responde `grupo_inexistente` para um grupo de teste.

## 2. Vercel — o endereço `volei.memberstars.com`

1. Abrir o projeto do Terça no Vercel (o mesmo de `voleiterca.vercel.app`) → **Settings → Domains → Add**.
2. Digitar `volei.memberstars.com` e confirmar. O Vercel mostra um registro **CNAME** para criar
   (normalmente `cname.vercel-dns.com`). Deixe essa tela aberta.

## 3. GoDaddy — apontar o subdomínio para o Vercel

1. GoDaddy → **Meus produtos → memberstars.com → DNS → Adicionar novo registro**.
2. Tipo **CNAME**, Nome **`volei`**, Valor **o que o Vercel mostrou** (ex.: `cname.vercel-dns.com`), TTL 1 hora. Salvar.
3. Voltar ao Vercel: em alguns minutos o domínio aparece como **Valid Configuration** e o certificado (https) é
   emitido sozinho. Não mexa nos registros que já existem para `memberstars.com` (os do GitHub Pages).

## 4. Google — liberar o login no endereço novo

Google Cloud Console → **APIs e serviços → Credenciais** → o Client ID OAuth do app (o mesmo do Terça) →
**Origens JavaScript autorizadas → Adicionar URI**: `https://volei.memberstars.com` → Salvar. Pode levar alguns minutos.

## 5. Teste de verdade (com o assistente)

1. Abrir `https://volei.memberstars.com/` → aparece "Crie o app do seu grupo de vôlei".
2. Entrar com Google, preencher e criar um grupo de teste (ex.: `teste-heleno`). Deve cair em
   `volei.memberstars.com/teste-heleno/` já logado como admin, com as boas-vindas.
3. Cadastrar um jogador, abrir um check-in, instalar o app pelo celular.
4. Conferir nos **logs da função `grupos-api`** que NÃO aparece `cf-connecting-ip ausente`.
5. Abrir `memberstars.com/volei/` (Terça) e conferir que nada mudou.
6. Para apagar o grupo de teste depois (SQL Editor):
   `delete from grupos.grupos where apelido = 'teste-heleno'; delete from liga.grupos where id = 'teste-heleno';`
   (as fotos dele ficam na pasta do bucket `fotos-grupos/<id do grupo>/` e podem ser apagadas pelo Storage).

## Se algo der errado — como desfazer

- **O Terça quebrou depois do passo 0**: pedir ao assistente para reverter o merge na `main` (um `git revert`), que
  volta a v17.1 no ar. Nada do Supabase do Terça foi mexido.
- **`volei.memberstars.com` com problema**: remover o domínio no Vercel (passo 2) e/ou o CNAME no GoDaddy; o resto
  segue funcionando.
- **Suspender um grupo abusivo**: `update grupos.grupos set status = 'suspenso' where apelido = '...';` (vale em até 1 minuto).
- **Limites do plano grátis**: `update grupos.limites set max_jogadores_por_grupo = 200;` (e os outros campos da tabela).
