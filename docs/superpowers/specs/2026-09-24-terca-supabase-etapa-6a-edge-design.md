# Terça no Supabase — etapa 6a: backend como Edge Function (sem mexer na produção)

## Escopo
Publicar o backend puro (`criarHandler`) como Supabase Edge Function (Deno) **de teste** (`terca-api-teste`), ao lado da
produção (Apps Script), sem alterar nenhum `.html`, nenhum `.gs` e sem trocar o endereço que a página de produção usa.
A troca definitiva do front fica para a etapa 6b. Requisitos vêm da lista de 7 pontos "O que muda para virar Edge
Function" do spec da etapa 2. Revisado de segurança depois da primeira versão (ver "Revisão de segurança" abaixo).

## O que foi feito
| Peça | Arquivo |
|---|---|
| Adaptador HTTP (Request/Response), CORS, limite de corpo, 500 genérico | `backend/edge.js` |
| Limitador de tentativas da chave mestra (reserva atômica) + normalização de IP | `backend/limitador.js` |
| Tabela/funções do limitador (o usuário roda) | `sql/schema-terca-supabase-ajuste-7.sql` |
| Primitivas `registrarTentativa/limparFalhas` | `backend/repo-memoria.js` (relógio injetável), `backend/repo-supabase.js` (rpc) |
| Porteiro e `bootstrapAdmin` usam o limitador; `handler.post(body, { ip })` | `porteiro.js`, `usuarios.js`, `handler.js` |
| Erros internos ocultos na Edge (`ocultarErrosInternos`, `registrar`, `ErroDeNegocio`) | `handler.js`, `erros.js` |
| Casca Deno | `supabase/functions/terca-api-teste/index.ts` |
| Cópia dos módulos para dentro de `supabase/functions/` | `scripts/preparar-edge.js` (`npm run preparar-edge`) |
| Testar a função pela página local | `BACKEND_URL` em `servidor-local.js` (`urlApi` em `servidor.js`) |
| Guia manual | `docs/superpowers/terca-supabase-deploy.md` |

## Decisões
- **Pureza:** `edge.js` e `limitador.js` só usam APIs web padrão; o handler não sabe que está no Deno. A casca `.ts` é o único
  lugar com `Deno` e `npm:` imports. `preparar-edge.js` recusa copiar arquivo com `node:`, `process.`, `require(` ou `Buffer`
  e qualquer `import`/`export ... from`/`import()` cujo especificador não seja `./arquivo.js` (linhas só de comentário são ignoradas).
- **Cópia em vez de import relativo para fora:** o bundler do Supabase pode não alcançar `../../backend`; a pasta copiada é
  gerada e fica no `.gitignore` (fonte única: `backend/`).
- **Limitador fora do `criarEdge`:** ele é injetado em `criarHandler` (é o porteiro que o consulta); o `criarEdge` só extrai
  o IP e o passa no contexto.
- **Recusa de subir mal configurada:** variável faltando ou `ADMIN_PASSWORD` com menos de 20 caracteres -> toda requisição
  recebe 500 `Configuração incompleta no servidor.`; o log diz os **nomes** faltando, nunca valores.
- **Limitador por RESERVA atômica:** cada tentativa com a chave mestra é contada por `registrar_tentativa` (um único upsert)
  ANTES de a senha ser comparada; se a reserva é negada, a senha nem é comparada. Assim 200 requisições paralelas custam 200
  tentativas (a versão anterior "checa bloqueio, compara, registra falha" deixava um rajada passar antes de o contador subir).
  No máximo `maxTentativas` (8) senhas são comparadas por janela (900 s); a 9ª estoura e bloqueia por 900 s. Última tentativa
  fora da janela, ou bloqueio vencido, recomeça a contagem. Senha certa zera o balde da rede.
- **Baldes:** `senha:<rede>` e um teto geral `senha:global` (200 tentativas / 900 s). A rede é o IP do IPv4 ou o prefixo /64 do
  IPv6 (IPv4 embutido em IPv6 vira o IPv4). Reserva primeiro o balde da rede e só depois o geral, então quem já está bloqueado
  não gasta o teto geral (senão um bloqueado poderia trancar a chave mestra de todos). Linhas paradas há mais de 1 dia são
  apagadas na própria função.
- **Bloqueado + token do Google:** a chave mestra é ignorada, mas o token é tentado normalmente. Assim um admin logado com uma
  senha velha guardada no navegador não se tranca para fora; o atacante não ganha nada (a senha nem é comparada). Isso também
  garante que o balde compartilhado `desconhecido` ou o teto geral nunca trancam o dono, que entra pelo Google.
- **Falha fechada:** se o SQL do ajuste 7 não foi rodado (ou o banco falha), a chave mestra dá erro, nunca passa sem limite.
- **Origem:** POST exige `Origin` na lista (`ORIGENS_PERMITIDAS`), comparação exata (barra final da lista é tolerada).
  Respostas de origem permitida levam `Access-Control-Allow-Origin` + `Vary: Origin`; outras não levam.
- **GET público:** como no Apps Script; qualquer cliente lê, mas só origens da lista recebem o cabeçalho CORS, então páginas
  de outros sites não conseguem ler a resposta pelo navegador.
- **Corpo:** 600 KB por padrão. Checa `Content-Length` antes de ler e, sem ele (ou mentindo), conta os bytes do stream e
  cancela a leitura ao passar do limite; resposta 413 simples, sem cortar conexão.
- **IP do cliente:** SÓ `cf-connecting-ip` (o proxy da Cloudflare o sobrescreve; o cliente não forja). `x-forwarded-for` **não é
  usado em nenhum caso**: o cliente pode escrever nele e trocaria de "IP" a cada tentativa. Sem o cabeçalho, o balde é
  `desconhecido` e a função registra um aviso (uma vez por instância).
- **Erros internos ocultos (`ocultarErrosInternos`, ligado só na Edge):** exceção LANÇADA dentro de `get()`/`post()` (texto de
  Postgres/Storage, TypeError...) vira `Erro interno no servidor.` para o cliente e a mensagem real vai para `registrar` (log da
  função). Os `{ error: '...' }` deliberados (negócio) não mudam. Não há hoje nenhum `throw` deliberado com texto de usuário
  (conferido no código do backend); `ErroDeNegocio` existe para quando houver, e mantém a mensagem. Local e testes antigos
  seguem com o texto cru (padrão `false`).

## Revisão de segurança (correções desta versão)
- **I1** corrida no limitador -> reserva atômica (acima). Teste com 200 requisições paralelas e latência aleatória no repo.
- **I2** IP forjável -> só `cf-connecting-ip`, /64 para IPv6, teto global.
- **I3** vazamento de texto de banco a anônimos -> `ocultarErrosInternos`.
- **M1** pureza checa especificadores de import; **M3** `supabase/.temp/` no `.gitignore`; **M4** `createClient` sem sessão;
  **M5/M2** guia atualizado (geração de senha com gerador criptográfico, `--use-api`, desfazer com `secrets unset`, remover o
  `localhost` antes da 6b, 500 "Configuração incompleta" enquanto faltar segredo).

## Notas de ameaça
- **Chave mestra exposta:** é o principal risco. Mitigações: senha longa e aleatória obrigatória (>= 20, recomendado 43 via
  gerador criptográfico), comparação em tempo constante, reserva por rede + teto geral, e ela vale só nos caminhos do
  porteiro/`bootstrapAdmin` (nunca em check-in). A senha da função é independente da do Apps Script. Um atacante com MUITOS
  IPs distintos ainda consegue até 200 palpites por 15 min (teto geral): irrelevante contra uma senha de 43 caracteres aleatórios.
- **Balde `desconhecido`:** se a Supabase deixar de mandar `cf-connecting-ip`, todos caem num balde só; um atacante gasta as
  8 tentativas e bloqueia a chave mestra para todos por 15 min. Não trava o dono (Google) e o aviso no log denuncia a situação.
- **`service_role` só no ambiente da função:** nunca no navegador, nem no repositório, nem em log. A função não a devolve
  em respostas (500 genérico).
- **Origem não é autenticação:** `Origin` é forjável fora do navegador. Ela impede páginas de outros sites de usarem o
  navegador do usuário; quem protege de fato é o porteiro (token do Google ou chave mestra).
- **Limites de corpo** protegem memória da função; fotos de até ~300 KB cabem.
- **M6 — abuso público residual (registrado pela revisão, NÃO coberto):** enxurrada de GET anônimo (cada GET lê o banco todo);
  spam de `incrementarAcesso` e `lerAoVivo`; qualquer conta Google pode criar/remover check-ins (o check-in só exige login, como
  no `.gs`). Mitigação parcial feita: `jogadorNome` de check-in é cortado em 120 caracteres (o `.gs` gravava qualquer tamanho; nomes
  normais não mudam). Ficam para depois: throttling por IP/conta nessas ações e cache do GET.

## O que NÃO está coberto
- Throttling de check-in e das ações públicas (item M6 acima).
- Falhas de token do Google não são limitadas (a verificação é do lado do Google).
- Verificação local do token (chaves públicas em cache) em vez de uma chamada ao Google por requisição (ponto 7 da lista).
- Não há troca do front de produção nem migração de dados nesta etapa; a função compartilha o mesmo banco do servidor local.
- `.ts` não foi compilado aqui (sem `deno` no PATH); só revisado. O primeiro `deploy` é o teste real.
- O SQL do ajuste 7 não foi executado em Postgres aqui (não há banco de teste); o emulador em memória segue a mesma regra e
  a função foi revisada à mão.

## Verificação
Testes em `test:backend`: `edge.test.mjs`, `limitador.test.mjs` (porteiro, `bootstrapAdmin`, relógio falso, concorrência,
teto geral, IPv6, falha fechada, rpc), `handler-edge.test.mjs` (erros ocultos, corte de nome), `preparar-edge.test.mjs`
(pureza e especificadores, backend real) e o caso `urlApi` em `servidor.test.mjs`. Mutações checadas (quebram testes): origem,
limites de corpo, corrida no repo, teto geral, balde por IP, /64, uso de `x-forwarded-for`, ocultar erros, corte de nome e
checagem de especificador.
