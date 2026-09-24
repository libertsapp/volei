# Publicar o backend do Terça como Edge Function (etapa 6a) — passo a passo

Isto cria uma função **nova e separada** no seu projeto Supabase (`terca-api-teste`). A produção
(Apps Script + página no GitHub Pages) **não é tocada**: quem já usa o app continua igual. Se algo der errado,
basta apagar a função ou não fazer nada.

Tudo abaixo é feito por você, no PowerShell, dentro da pasta do projeto (a do worktree
`.worktrees\terca-supabase-migracao`). Nunca cole senhas em chat, print ou commit.

## 0. Antes de tudo
- O Node já está instalado (é o que roda os testes). Vamos usar `npx supabase ...`; não precisa instalar nada a mais
  (na primeira vez ele pergunta se pode baixar o pacote: responda `y`).
- A URL do projeto (`SUPABASE_URL`) **está no seu `.env`**. Ela tem a forma `https://<ref>.supabase.co`; o `<ref>` é a
  parte antes de `.supabase.co`. Também aparece em Supabase > Project Settings > General > Reference ID.

## 1. Entrar no Supabase pelo terminal
```powershell
npx supabase login
```
Abre o navegador para você autorizar. Depois:
```powershell
npx supabase link --project-ref <ref>
```
(pode pedir a senha do banco; se pedir, use a do projeto, ou aperte Enter para pular se aceitar.)

## 2. Rodar o SQL do ajuste 7 (limite de tentativas)
No painel do Supabase: **SQL Editor** > New query > cole todo o conteúdo de `sql/schema-terca-supabase-ajuste-7.sql` > Run.
Pode rodar mais de uma vez sem problema. Sem isso, a chave mestra na função responde com erro citando
`tentativa_bloqueada` (de propósito: nunca funciona sem limite).

## 3. Gerar uma senha mestra longa e aleatória
A função **recusa subir** se `ADMIN_PASSWORD` tiver menos de 20 caracteres. Gere uma senha nova (a do Apps Script é curta
e está no histórico local do git: não reutilize). Este comando cria a senha e a guarda **só numa variável da sessão**,
sem mostrá-la na tela:
```powershell
$env:NOVA_SENHA = -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | ForEach-Object {[char]$_})
```
- A senha da função é **independente** da do Apps Script. Só mexa na do Apps Script se quiser que as duas aceitem a mesma.
- Guarde essa senha num gerenciador de senhas antes de fechar o terminal (ela não fica em lugar nenhum além do Supabase).
  Se precisar vê-la agora, rode `$env:NOVA_SENHA` só numa janela que ninguém está vendo/gravando.

## 4. Configurar os segredos da função
`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` o Supabase já injeta sozinho. Faltam estes (o `GOOGLE_CLIENT_ID` é o mesmo do app, que está no HTML/`.env`):
```powershell
npx supabase secrets set ADMIN_PASSWORD=$env:NOVA_SENHA GOOGLE_CLIENT_ID=<seu-client-id> ORIGENS_PERMITIDAS=https://libertsapp.github.io,http://localhost:8000
Remove-Item Env:NOVA_SENHA
```
`ORIGENS_PERMITIDAS` é a lista (separada por vírgula, sem espaços, sem barra no fim) das páginas autorizadas a enviar
escritas. Nunca coloque esses valores em arquivo do repositório.
Conferir os **nomes** (sem valores): `npx supabase secrets list`.

## 5. Preparar e publicar
```powershell
npm run preparar-edge
npx supabase functions deploy terca-api-teste --no-verify-jwt
```
- `preparar-edge` copia `backend/*.js` para dentro de `supabase/functions/terca-api-teste/backend/` (pasta gerada, fora do git).
  Se acusar `node:`/`process.`/`require(`/`Buffer`, é um erro do código, pare e avise.
- `--no-verify-jwt` é necessário: o app manda um token do **Google** no corpo, não um token do Supabase, e o porteiro do
  backend é o único portão. (O arquivo `supabase/config.toml` já traz o mesmo ajuste, `verify_jwt = false`; o flag basta.)
- Rode `npm run preparar-edge` de novo **sempre** que mudar algo em `backend/`, antes de um novo deploy.

## 6. Testar
O endereço da função é `https://<ref>.supabase.co/functions/v1/terca-api-teste`.
```powershell
curl.exe https://<ref>.supabase.co/functions/v1/terca-api-teste
```
Deve devolver um JSON grande com `players`, `rounds`, `settings`, ... Se vier `{"error":"Configuração incompleta no servidor."}`,
veja os logs (Supabase > Edge Functions > terca-api-teste > Logs): eles dizem **quais nomes** faltam (ou que a senha é curta), sem mostrar valores.

Conferir a defesa de origem (deve dar 403 com `Origem não permitida.`):
```powershell
curl.exe -X POST -H "Content-Type: text/plain" -d "{\"action\":\"lerAoVivo\"}" https://<ref>.supabase.co/functions/v1/terca-api-teste
```

## 7. Ver o app local falando com a função
```powershell
$env:BACKEND_URL = "https://<ref>.supabase.co/functions/v1/terca-api-teste"
node backend/servidor-local.js
Remove-Item Env:BACKEND_URL
```
Abra `http://localhost:8000`. A página passa a falar com a função na nuvem (o servidor local só entrega a página).
Confira: a lista de jogadores aparece; entre com o Google; um `ping` como admin funciona; um check-in de teste funciona.
Sem `BACKEND_URL`, tudo continua como antes (backend local).

Sobre o Google: a origem `http://localhost:8000` já está autorizada no Client ID. A página do GitHub Pages **não** muda
nesta etapa (ela continua no Apps Script), então não precisa autorizar nada novo.

## 8. O que conferir
- GET público responde; POST de fora da lista de origens dá 403.
- Errar a chave mestra 8 vezes seguidas: a 9ª tentativa (mesmo com a senha certa) responde
  "Muitas tentativas. Tente de novo em alguns minutos." por ~15 min. Login do Google continua funcionando.
- Foto pequena sobe (o limite do corpo é 600 KB).

## Desfazer
- Produção não foi alterada, então não há o que reverter lá.
- Para desligar a função: `npx supabase functions delete terca-api-teste` (ou não faça nada: ela só é usada por quem
  apontar para a URL dela).
- Para remover o limite de tentativas: nada a fazer (a tabela `limite_tentativas` é inofensiva).
