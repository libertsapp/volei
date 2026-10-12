# Grupos independentes — publicação do backend (Fase 2)

Passos do USUÁRIO (o assistente não publica nada). Ordem importa.

1. **SQL** (SQL Editor do Supabase, projeto `lzwmirrjpoqucwlhgkku`), nesta ordem:
   1. `sql/liga/ajuste-1-cidade.sql` — cidade/UF na liga (Terça e Meme já ficam em Santa Luzia/MG).
   2. `sql/grupos/schema-grupos.sql` — schema `grupos` inteiro (tabelas, funções, criar_grupo, limites).
2. **Expor o schema:** Configurações → Data API → "Exposed schemas": acrescentar `grupos` (ao lado de public, meme, liga).
3. **Bucket de fotos:** Storage → New bucket → nome `fotos-grupos`, **público**.
4. **Segredo da função:**
   `npx supabase secrets set GRUPOS_ORIGENS_PERMITIDAS=https://volei.memberstars.com --project-ref lzwmirrjpoqucwlhgkku`
   (`GOOGLE_CLIENT_ID` e as chaves VAPID já existem no projeto e são compartilhadas.)
5. **Publicar:**
   `npm run preparar-edge -- grupos-api`
   `npx supabase functions deploy grupos-api --no-verify-jwt --project-ref lzwmirrjpoqucwlhgkku`
6. **Conferir:** `curl https://lzwmirrjpoqucwlhgkku.supabase.co/functions/v1/grupos-api?g=teste` deve responder
   `{"error":"Esse grupo não existe.","codigo":"grupo_inexistente"}`.

Nada disso muda o Terça nem o Meme. A página de criação e o "modo grupo" do app vêm na Fase 3; o endereço
`volei.memberstars.com` na Fase 4.
