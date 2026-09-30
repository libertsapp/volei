# Sessão própria do app (login que não cai) — design

Data: 2026-09-30 · Vale para: Terça (schema `public`, função `terca-api-teste`) e, depois de autorizado, Meme (schema `meme`, função `meme-api`).

## Problema

O app usa o **ID Token do Google** como sessão. Esse token vence a cada **1 hora**. Para renovar, o app pede um novo ao
Google em silêncio (One Tap, `google.accounts.id.prompt()`), o que falha com frequência no celular: o navegador bloqueia
depois de alguns "dispensar", a pessoa tem 2 contas, ou o FedCM não responde. Quando falha, a próxima gravação recebe
"Login do Google expirou", o app apaga o token e a pessoa se sente deslogada várias vezes durante o uso.

Além disso, **toda ação sensível** consulta o Google (`oauth2.googleapis.com/tokeninfo`) para validar o token: mais lenta
e mais um ponto de falha.

## Objetivo

- Entrar com Google **uma vez por aparelho**; a pessoa só sai quando tocar em **Sair** (ou um admin remover a conta).
- Nenhuma ação depende de o Google responder, depois do primeiro login.
- Nada muda para quem não loga (check-in livre, ver tudo) nem para a chave mestra (emergência).

## Decisão: sessão do app, emitida pelo servidor

O Google continua sendo o jeito de **provar quem a pessoa é**, mas só no login. Depois disso o servidor entrega uma
**sessão do app** e passa a confiar nela.

- **Duração:** 90 dias, **renovada sozinha a cada uso** (quem usa o app pelo menos uma vez a cada 3 meses nunca sai).
  Para não gravar no banco a cada clique, a validade só é empurrada para "agora + 90 dias" quando já passou 1 dia desde o
  último empurrão.
- **Onde fica:** no aparelho (`localStorage`, junto da sessão atual `volei-auth-v1`) e no banco, só o **hash SHA-256** do
  token (quem lê o banco não consegue usar a sessão de ninguém).
- **O token:** 32 bytes aleatórios (`crypto.getRandomValues`, existe no Node e no Deno), em base64url.
- **Perfil e vínculo** continuam sendo lidos da tabela `usuarios` a cada ação (como hoje): mudar o cargo de alguém vale
  na hora, sem precisar de novo login.

### Banco (SQL novo, rodado pelo usuário no SQL Editor, uma vez por schema)

```sql
create table sessoes (
  token_hash  text primary key,          -- sha-256 hex do token; o token cru nunca é gravado
  email       text not null,
  criada_em   timestamptz not null default now(),
  expira_em   timestamptz not null,
  renovada_em timestamptz not null default now()
);
create index on sessoes (email);
alter table sessoes enable row level security;  -- sem políticas: só a service_role (a função) acessa
```

Arquivos: `sql/schema-terca-supabase-ajuste-8.sql` (schema `public`) e o equivalente em `sql/meme/` (schema `meme`).

### Backend (`backend/`, o mesmo código para as duas funções)

- **`backend/sessoes.js` (novo):** `criarSessao(deps, email)`, `validarSessao(deps, token)` → `{ ok, email }` ou
  `{ ok:false, erro }`, `encerrarSessao(deps, token)`, `encerrarSessoesDe(deps, email)`. Ao criar, apaga as sessões
  vencidas daquele e-mail (limpeza sem tarefa agendada).
- **Identificação única:** uma função `identificar(deps, body)` passa a ser usada em todo lugar que hoje chama
  `verificarToken(body.idToken)` (porteiro, check-in, bootstrap, vínculo, foto). Ordem:
  1. `body.sessao` presente → valida no banco (sem falar com o Google);
  2. senão `body.idToken` → Google, como hoje (mantém compatibilidade com o app antigo durante a troca).
- **`loginGoogle`:** depois de validar o Google, cria a sessão e devolve `sessao` e `sessaoExpiraEm` junto do que já
  devolve.
- **Ações novas:**
  - `minhaConta` (precisa de sessão): devolve perfil, vínculo e nome atuais. Substitui o uso de `loginGoogle` na
    sincronização silenciosa do app (que hoje exige um token do Google válido).
  - `sair` (precisa de sessão): apaga aquela sessão.
  - `sairDeTodosOsAparelhos` (precisa de sessão): apaga todas as sessões daquele e-mail.
- **`removerUsuario`:** também apaga as sessões do e-mail removido.
- **Mensagem de sessão inválida/vencida:** `'Sua sessão expirou. Entre com o Google de novo.'` (o app reconhece por
  "sessão expirou").
- Permissões: as ações novas entram na matriz como públicas para quem tem sessão (`jogador`, `organizador`, `admin`).

### Front (`volei-dashboard.html`; Meme só depois de autorizado)

- `AUTH.sessao` guardada em `volei-auth-v1`. `requireAuth` devolve `{ sessao }` e o `postAction` envia `sessao`
  (continua enviando `senha` quando for chave mestra).
- Com sessão, **não há mais renovação do Google**: `garantirTokenFresco`, o `prompt()` do One Tap, o intervalo de 45 min
  e a renovação ao reabrir o app deixam de rodar. Eles só continuam para quem ainda está com login antigo (sem sessão).
- **Quem já está logado hoje** (tem `idToken`, não tem `sessao`): ao abrir o app, se o `idToken` ainda vale, o app troca
  por uma sessão em silêncio (`loginGoogle`). Se já venceu, a pessoa toca em "Entrar com Google" **uma última vez**.
- Resposta "sessão expirou" → o app limpa a sessão e mostra o botão "Entrar com Google" com um aviso, em vez de fingir
  que está logado.
- **Área de conta** (no topo do "Meu Perfil" e ao tocar no chip do nome, no lugar do `confirm()` atual):
  "Conectado como fulano@gmail.com · Admin", "Neste aparelho até 29/12/2026", botões **Sair** e
  **Sair de todos os aparelhos**.

### Fora do escopo

- `.gs` (Apps Script antigo): não ganha sessão; os testes de paridade ignoram os campos e ações novos, como já fazem com
  `removidos`/`restorePlayer`.
- Login sem Google (e-mail/senha) — não pedido.

## Riscos e como ficam cobertos

| Risco | Tratamento |
|---|---|
| Alguém copia o token do `localStorage` (mesmo risco que o `idToken` tem hoje, mas vale 90 dias em vez de 1 h) | "Sair de todos os aparelhos"; admin removendo a conta apaga as sessões; banco só guarda hash |
| Função publicada antes do SQL | `identificar` trata erro da tabela como sessão inválida e cai para o `idToken`; mesmo assim a ordem de publicação é SQL → função → HTML |
| App antigo em cache no celular | Backend continua aceitando `idToken`, nada quebra |

## Testes

- `tests/backend/sessoes.test.mjs`: cria/valida/vence/renova (com relógio falso, sem gravar a cada clique)/encerra;
  hash no banco, nunca o token cru; limpeza das vencidas.
- Handler: login devolve sessão; ações com sessão funcionam sem chamar o Google (verificador falso que falha se for
  chamado); sessão de usuário removido deixa de valer; mudança de perfil vale sem novo login; `idToken` continua valendo.
- Front (`tests/sessao-front.test.js`, extraindo do HTML): `requireAuth` com sessão não chama o Google; "sessão expirou"
  limpa a sessão; migração silenciosa de quem só tem `idToken`.
- Suíte inteira do backend e os testes de front existentes continuam verdes.

## Publicação (ordem)

1. Usuário roda o SQL no Supabase (Terça).
2. Usuário roda `npm run preparar-edge` + deploy de `terca-api-teste`.
3. `git push` do Terça. Conferir no celular: entrar, fechar o app, voltar depois de mais de 1 hora, salvar algo.
4. Com autorização: SQL do schema `meme`, deploy de `meme-api`, replicar o HTML no `voleimeme`.
