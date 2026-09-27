# Vôlei Meme Brasil no Supabase (schema `meme` no mesmo projeto)

## Objetivo
Passar o Vôlei Meme Brasil (`libertsapp.github.io/voleimeme/`) do Apps Script para o **mesmo projeto Supabase** do Terça
(`lzwmirrjpoqucwlhgkku`), com o mesmo tipo de virada e rollback da etapa 6b do Terça, o mais rápido possível, **sem alterar o
Terça em produção**. Os dois grupos nunca enxergam os dados um do outro.

## Contexto verificado
- O `.gs` do Meme (`apps-script-codigo-volei-meme.gs`) é praticamente o do Terça: mesma lógica e mesmas abas. Só mudam o cabeçalho,
  `ss_()` (`openById(SPREADSHEET_ID)` em vez de `getActiveSpreadsheet()`), a criação automática da aba Ao Vivo e as constantes
  (`SPREADSHEET_ID`, `DRIVE_FOLDER_ID`, `ADMIN_PASSWORD`). Por isso o backend novo e a paridade já testada valem para o Meme.
- O backend acessa o banco só por `cliente.from('<tabela>')` e `cliente.rpc('<função>')`, então aceita outro schema trocando o
  cliente (`createClient(url, key, { db: { schema } })`). Pontos presos ao `public`: 5 funções SQL com `set search_path = public`
  (ajustes 5, 6 e 7), o bucket `fotos` fixo em `backend/armazenamento-supabase.js` e em dois scripts, e `SPREADSHEET_ID_TERCA` em
  `scripts/lib/planilha.js`.
- O front do Meme (repositório `voleimeme`, só `index.html` + `sw.js`, sem Action de sincronização) está na v12.9 e usa
  `SHEET_API_URL` do Apps Script do Meme.
- Rollback e riscos seguem os do Terça: o Apps Script do Meme fica intacto de reserva.

## Decisões
- **Schema separado `meme` no mesmo projeto** (não colunas `grupo` nas tabelas do Terça, que mexeriam no que já está em
  produção; não outro projeto, porque o pedido é o mesmo banco).
- **Uma função por grupo:** nova `meme-api`; `terca-api-teste` não é alterada.
- **SQL do Meme gerado, não copiado à mão:** um script deriva `sql/meme/*.sql` dos SQL do Terça, para os dois não divergirem.
- **Só `service_role` acessa o schema `meme`:** nenhum grant para `anon`/`authenticated`; RLS ligado como no Terça.
- **Segredos com prefixo `MEME_`** (o espaço de segredos das Edge Functions é do projeto inteiro): `MEME_ADMIN_PASSWORD` (>= 20
  caracteres, nova, 43 recomendado), `MEME_ORIGENS_PERMITIDAS`. `GOOGLE_CLIENT_ID` é o mesmo do Terça (mesma origem do Google).
- **Onde mora o código:** backend, SQL, scripts e a função ficam no repositório `volei` (branch `meme-supabase`). O front do Meme
  é o `index.html` do repositório `voleimeme`, alterado só na virada.
- **Fotos:** bucket público próprio `fotos-meme`, para o `?id=` de exclusão nunca cruzar grupos.

## Componentes
| Peça | Arquivo | Mudança |
|---|---|---|
| Gerador do SQL do Meme | `scripts/gerar-sql-grupo.js` (novo) + `sql/meme/*.sql` (gerados) | Lê `sql/schema-terca-supabase*.sql`; antepõe `create schema if not exists meme; set search_path to meme;`; troca `set search_path = public` por `set search_path = meme`; acrescenta `grant usage on schema meme to service_role`, grants de tabelas, sequências e funções só a `service_role`, `revoke ... from anon, authenticated` e `alter default privileges` equivalentes |
| Armazenamento de fotos | `backend/armazenamento-supabase.js` | `criarArmazenamentoSupabase({ cliente, urlBase, bucket = 'fotos' })`; o Terça continua com o padrão |
| Casca Deno do Meme | `supabase/functions/meme-api/index.ts` (novo) | Cópia da do Terça com `db: { schema: 'meme' }`, bucket `fotos-meme` e leitura dos segredos `MEME_*` |
| Preparação da função | `scripts/preparar-edge.js` | Aceita o nome da função (`npm run preparar-edge -- meme-api`); o `.gitignore` já cobre `functions/*/backend/` |
| Migração dos dados | `scripts/migrar-terca-supabase.js`, `scripts/lib/planilha.js` | `GRUPO=meme` usa `SPREADSHEET_ID_MEME` e o schema `meme`; padrão continua Terça |
| Migração das fotos | `scripts/migrar-fotos.js`, `scripts/criar-bucket-fotos.js` | `GRUPO=meme` usa o bucket `fotos-meme` |
| Servidor local | `backend/servidor-local.js` | `GRUPO=meme` cria o cliente com o schema `meme` (teste local) |
| Front do Meme | `voleimeme/index.html` | Só na virada: `SHEET_API_URL` -> `.../functions/v1/meme-api`; rodapé `Ver.: 13.0` |

## Passos e fluxo
1. **SQL:** gerar `sql/meme/`; o usuário roda no editor do Supabase e libera o schema `meme` em Configurações > API > Exposed schemas.
2. **Código:** parametrizar (tabela acima), com testes.
3. **Bucket e dados:** criar `fotos-meme`; rodar `GRUPO=meme npm run migrar`; conferir contagens contra a planilha; rodar `GRUPO=meme npm run migrar-fotos -- --aplicar`.
4. **Função:** `npm run preparar-edge -- meme-api`, `supabase secrets set MEME_*`, `supabase functions deploy meme-api --no-verify-jwt`.
   Durante os testes, `MEME_ORIGENS_PERMITIDAS` inclui `http://localhost:8000`; antes da virada, só `https://libertsapp.github.io`.
5. **Teste local do Meme** com o servidor local (`GRUPO=meme`, `BACKEND_URL` para a função): lista, login Google, `ping` admin, check-in de teste, foto.
6. **Virada** (fora de jogo, com OK explícito): re-rodar a migração (idempotente) imediatamente antes; conferir contagens; trocar o
   front do Meme e dar push no `voleimeme`; testar em produção.
7. **Rollback:** `git revert` do commit da virada no `voleimeme` + push; o Apps Script do Meme continua com os dados de antes da virada.
8. **Depois:** apagar a chave JSON do Google e regenerar a `service_role` (a limpeza pendente do Terça, agora só depois desta migração);
   manter o Apps Script do Meme 1 a 2 semanas de reserva.

## Verificação
- Suíte `test:backend` continua passando (o Terça não muda).
- Teste do gerador: nenhum `public` sobra nas funções geradas; `set search_path = meme` em todas as que fixavam; idempotente ao rodar duas vezes.
- Teste do armazenamento com bucket parametrizado e do repositório com cliente de schema falso (chama o schema certo).
- Integração real (script, fora da suíte): ler o schema `meme` e confirmar que o Terça no `public` continua igual (contagens antes/depois).
- Contagens migradas iguais às da planilha do Meme (jogadores, rodadas, times, check-ins, usuários, financeiro).

## Fora de escopo
- Qualquer mudança no Terça em produção ou na `terca-api-teste`.
- Multi-tenant dinâmico (uma função servindo vários grupos), painel de grupos.
- Mesclar contas entre grupos (a mesma conta Google pode ter perfis diferentes em cada um).
- Desligar o Apps Script do Meme.

## Riscos aceitos
- **`service_role` única** enxerga os dois grupos, como já acontecia com o Terça.
- **Janela de dados:** o que for gravado no Apps Script do Meme entre a migração final e a troca do front é perdido; mitigado
  re-rodando a migração imediatamente antes da virada e escolhendo um horário sem jogo.
- **Schema não exposto** faz a função falhar com erro de schema desconhecido; o teste local do passo 5 acusa antes da virada.
- **Chave JSON do Google** precisa continuar existindo até a migração terminar, e a conta de serviço precisa ter acesso à planilha e à pasta do Drive do Meme.
- **Origem `localhost` aberta** nos testes do passo 4: fechar antes da virada.

## O que só o usuário faz
- Compartilhar a planilha do Meme e a pasta de fotos do Drive do Meme com o e-mail da conta de serviço e informar o ID da planilha (`SPREADSHEET_ID_MEME` no `.env`).
- Rodar os SQL do `sql/meme/` no editor do Supabase e liberar o schema `meme` na API.
- Gerar e guardar a `MEME_ADMIN_PASSWORD` (43 caracteres) e gravar os segredos.
- Autorizar a virada, num horário sem jogo, e o `git push` do `voleimeme`.

## Critérios de sucesso
- O grupo do Meme usa o app normalmente, sem perder jogador, rodada, check-in, financeiro ou foto.
- O Terça não sofre nenhuma alteração (mesmas contagens e mesma função).
- Rollback comprovadamente possível em minutos.
- Nenhum segredo no repositório.
