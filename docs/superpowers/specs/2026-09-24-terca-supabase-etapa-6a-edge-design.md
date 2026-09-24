# Terça no Supabase — etapa 6a: backend como Edge Function (sem mexer na produção)

## Escopo
Publicar o backend puro (`criarHandler`) como Supabase Edge Function (Deno) **de teste** (`terca-api-teste`), ao lado da
produção (Apps Script), sem alterar nenhum `.html`, nenhum `.gs` e sem trocar o endereço que a página de produção usa.
A troca definitiva do front fica para a etapa 6b. Requisitos vêm da lista de 7 pontos "O que muda para virar Edge
Function" do spec da etapa 2.

## O que foi feito
| Peça | Arquivo |
|---|---|
| Adaptador HTTP (Request/Response), CORS, limite de corpo, 500 genérico | `backend/edge.js` |
| Limitador de tentativas da chave mestra (lógica pura) | `backend/limitador.js` |
| Tabela/funções do limitador (o usuário roda) | `sql/schema-terca-supabase-ajuste-7.sql` |
| Primitivas `tentativaBloqueada/registrarFalha/limparFalhas` | `backend/repo-memoria.js` (relógio injetável), `backend/repo-supabase.js` (rpc) |
| Porteiro e `bootstrapAdmin` usam o limitador; `handler.post(body, { ip })` | `porteiro.js`, `usuarios.js`, `handler.js` |
| Casca Deno | `supabase/functions/terca-api-teste/index.ts` |
| Cópia dos módulos para dentro de `supabase/functions/` | `scripts/preparar-edge.js` (`npm run preparar-edge`) |
| Testar a função pela página local | `BACKEND_URL` em `servidor-local.js` (`urlApi` em `servidor.js`) |
| Guia manual | `docs/superpowers/terca-supabase-deploy.md` |

## Decisões
- **Pureza:** `edge.js` e `limitador.js` só usam APIs web padrão; o handler não sabe que está no Deno. A casca `.ts` é o único
  lugar com `Deno` e `npm:` imports. `preparar-edge.js` recusa copiar arquivo com `node:`, `process.`, `require(` ou `Buffer`
  (linhas só de comentário são ignoradas).
- **Cópia em vez de import relativo para fora:** o bundler do Supabase pode não alcançar `../../backend`; a pasta copiada é
  gerada e fica no `.gitignore` (fonte única: `backend/`).
- **Limitador fora do `criarEdge`:** ele é injetado em `criarHandler` (é o porteiro que conta erros); o `criarEdge` só extrai
  o IP e o passa no contexto. (O enunciado listava `limitador` no `criarEdge`; não havia uso para ele ali.)
- **Recusa de subir mal configurada:** variável faltando ou `ADMIN_PASSWORD` com menos de 20 caracteres -> toda requisição
  recebe 500 `Configuração incompleta no servidor.`; o log diz os **nomes** faltando, nunca valores.
- **Janela do limite:** 8 erros em 900 s bloqueiam por 900 s (a janela é o próprio tempo de bloqueio). Erro anterior à janela
  ou bloqueio já vencido recomeça a contagem. Senha certa zera.
- **Bloqueado + token do Google:** a chave mestra é ignorada, mas o token é tentado normalmente. Assim um admin logado com uma
  senha velha guardada no navegador não se tranca para fora; o atacante não ganha nada (a senha nem é comparada).
- **Falha fechada:** se o SQL do ajuste 7 não foi rodado (ou o banco falha), a chave mestra dá erro, nunca passa sem limite.
- **Origem:** POST exige `Origin` na lista (`ORIGENS_PERMITIDAS`), comparação exata (barra final da lista é tolerada).
  Respostas de origem permitida levam `Access-Control-Allow-Origin` + `Vary: Origin`; outras não levam.
- **GET público:** como no Apps Script; qualquer cliente lê, mas só origens da lista recebem o cabeçalho CORS, então páginas
  de outros sites não conseguem ler a resposta pelo navegador.
- **Corpo:** 600 KB por padrão. Checa `Content-Length` antes de ler e, sem ele (ou mentindo), conta os bytes do stream e
  cancela a leitura ao passar do limite; resposta 413 simples, sem cortar conexão.
- **IP do cliente:** `cf-connecting-ip` primeiro (o proxy da Cloudflare o sobrescreve; o cliente não forja), depois o primeiro
  salto de `x-forwarded-for`, senão `desconhecido`. (O enunciado pedia `x-forwarded-for` primeiro; foi invertido porque o
  primeiro salto do XFF pode ser escrito pelo próprio cliente, o que permitiria fugir do bloqueio trocando de "IP".)

## Notas de ameaça
- **Chave mestra exposta:** é o principal risco. Mitigações: senha longa e aleatória obrigatória (>= 20, recomendado 40),
  comparação em tempo constante, bloqueio por IP, e ela vale só nos caminhos do porteiro/`bootstrapAdmin` (nunca em check-in).
  A senha da função é independente da do Apps Script.
- **Limite por IP atrás de proxy:** se o IP não vier confiável, todos caem em `senha:desconhecido` (um atacante bloquearia a
  chave mestra para todos; o login do Google segue funcionando, então é incômodo, não perda de acesso). Um atacante com muitos IPs
  contorna o limite por IP: por isso a senha forte é a defesa principal, o limite só encarece.
- **`service_role` só no ambiente da função:** nunca no navegador, nem no repositório, nem em log. A função não a devolve
  em respostas (500 genérico).
- **Origem não é autenticação:** `Origin` é forjável fora do navegador. Ela impede páginas de outros sites de usarem o
  navegador do usuário; quem protege de fato é o porteiro (token do Google ou chave mestra).
- **Limites de corpo** protegem memória da função; fotos de até ~300 KB cabem.

## O que NÃO está coberto
- Sem throttling por conta/IP de check-in ou de ações públicas (`incrementarAcesso`, `lerAoVivo`, GET): spam ali é possível
  e fica para depois (o Supabase aplica só seus limites globais).
- Falhas de token do Google não são limitadas (a verificação é do lado do Google).
- Verificação local do token (chaves públicas em cache) em vez de uma chamada ao Google por requisição (ponto 7 da lista).
- Não há troca do front de produção nem migração de dados nesta etapa; a função compartilha o mesmo banco do servidor local.
- `.ts` não foi compilado aqui (sem `deno` no PATH); só revisado. O primeiro `deploy` é o teste real.

## Verificação
Testes novos em `test:backend`: `edge.test.mjs`, `limitador.test.mjs` (porteiro, `bootstrapAdmin`, relógio falso, IPs
distintos, falha fechada, rpc), `preparar-edge.test.mjs` (pureza do backend real) e o caso `urlApi` em `servidor.test.mjs`.
Mutações checadas (quebram testes): checagem de origem, limite por Content-Length, limite no stream, consulta de bloqueio,
registro de falha e limpeza pela senha certa.
