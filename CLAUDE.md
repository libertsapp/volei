# Vôlei de Terça & Vôlei Meme Brasil — instruções do projeto

Dois dashboards de vôlei recreativo, em produção, usados semanalmente por dois
grupos reais. Single-file HTML + Google Apps Script + Google Sheets. Sem
framework, sem build step — é só abrir o `.html` e funciona.

## Arquivos e o que cada um é

| Arquivo | O que é |
|---|---|
| `volei-dashboard.html` | App do Vôlei de Terça — completo (HTML+CSS+JS num arquivo só) |
| `volei-meme-dashboard.html` | App do Vôlei Meme Brasil — mesma estrutura, identidade visual diferente |
| `apps-script-codigo.gs` | Backend do Terça (script **vinculado** à planilha) |
| `apps-script-codigo-volei-meme.gs` | Backend do Meme (script **avulso**, usa `openById`) |
| `sw.js` | Service Worker — de propósito **sem cache nenhum**, só existe pra deixar o app instalável (PWA) |

Hospedagem: GitHub Pages (`libertsapp.github.io/volei/` e `/voleimeme`). O Terça também sai em
`https://voleiterca.vercel.app` (e `https://libertsapp-volei.vercel.app`, mesmo projeto) (Vercel ligado ao repo; `vercel.json` monta a pasta `publicar/` só com
`volei-dashboard.html`→`index.html` + `sw.js`, a cada push na `main`). Endereço novo de hospedagem = acrescentar a
origem no segredo `ORIGENS_PERMITIDAS` da função (Supabase) e nas "Origens JavaScript autorizadas" do Client ID do Google. Os
`.gs` **não rodam a partir daqui de verdade** — vivem no editor do Google
Apps Script. Copiar/colar manual, sempre.

## 🔴 Regra de ouro: TERÇA PRIMEIRO, MEME SÓ COM AUTORIZAÇÃO

Os dois apps têm a mesma base de código — mesma funcionalidade, pele
diferente (cores, nome, logo). Mas a partir de agora, **nenhuma mudança é
replicada automaticamente**. O fluxo obrigatório é:

1. Implementar a mudança **só no `volei-dashboard.html`** (e no
   `apps-script-codigo.gs`, se for o caso)
2. Validar sintaxe e testar (ver seções abaixo)
3. Mostrar o resultado e **parar** — esperar autorização explícita antes de
   tocar em qualquer arquivo do Meme
4. Só depois de autorizado, replicar a mesma mudança pro
   `volei-meme-dashboard.html` (e `apps-script-codigo-volei-meme.gs`)

**Nunca edite os dois arquivos ao mesmo tempo por conta própria.** Se não
estiver claro se uma tarefa já foi autorizada a replicar, pergunte antes de
mexer no Meme.

## Validação obrigatória depois de qualquer mudança em JS

```bash
python3 -c "
import re
content = open('volei-dashboard.html').read()
m = re.search(r'<script>(.*)</script>', content, re.S)
open('/tmp/check.js','w').write(m.group(1))
"
node --check /tmp/check.js
```

Isso pega erro de sintaxe (parêntese sobrando, vírgula faltando) antes de
qualquer coisa ir pro ar. Rode em qualquer arquivo editado, sempre — Terça
primeiro; Meme só depois de autorizado.

Pra mudanças no `.gs`: `node --check arquivo.gs` funciona igual (é JS válido).

## Testando lógica não-trivial

Qualquer mudança em algoritmo (sorteio, cálculo de emblema, ranking, etc.)
merece um teste real antes de entregar — não só "parece certo". Padrão usado
nesse projeto: escrever um script Node.js autônomo (`/tmp/test_algo.js`)
simulando cenários realistas (incluindo casos de borda: empate, time sem
mulher suficiente, jogador sem nota cadastrada) e rodando várias vezes quando
há aleatoriedade envolvida (ex: 200 simulações do sorteio, checando que a
regra nunca é violada).

## Depois de qualquer mudança

1. Validar sintaxe
2. Testar lógica não-trivial com simulação, se aplicável
3. Subir a versão no rodapé (`Ver.: X.X` — mudança pequena = +0.1, mudança
   grande/reestruturação = vira número redondo tipo `4.0`) — só no arquivo
   que foi de fato alterado nesse momento; ao replicar pro Meme depois da
   autorização, a versão dos dois volta a ficar igual
4. Lembrar: mudança em `.html` precisa de `git push` pra ir pro ar (GitHub
   Pages). Mudança em `.gs` precisa ser colada manualmente no editor do
   Apps Script **e reimplantada como Nova Versão** — esse passo é fácil de
   esquecer e é a causa mais comum de "mudei mas não aconteceu nada"

## Sistema de login com Google + perfis de acesso

Implementado em 2026-09-13 (spec em `docs/superpowers/specs/2026-09-13-login-google-design.md`,
plano em `docs/superpowers/plans/2026-09-13-login-google.md` — os dois documentam o desenho
original; o resumo abaixo é o estado FINAL, já com os ajustes feitos depois do plano).

**Identidade:** login opcional via Google (Google Identity Services). Quem não loga continua
vendo tudo e fazendo check-in livre, como sempre. `GOOGLE_CLIENT_ID` é o **mesmo valor** nos
dois apps (Terça e Meme) — o Google Cloud só valida a ORIGEM (domínio), não o caminho, e os
dois ficam em `libertsapp.github.io` (só muda a subpasta). **A chave mestra foi aposentada nos dois apps (v16.0, 2026-10-10)**: não existe mais senha de admin no app nem os segredos
`ADMIN_PASSWORD` / `MEME_ADMIN_PASSWORD` (as Edge Functions passam `adminPassword: ''`, o que faz o porteiro e o `bootstrapAdmin` recusarem qualquer senha). Admin de emergência / primeiro admin = SQL no painel do Supabase (que tem 2FA), no schema do grupo:
`update usuarios set perfil = 'admin' where email = 'fulano@gmail.com';` (se a linha ainda não existe, a pessoa precisa logar uma vez antes). Mantenha sempre 2+ admins. O código morto da chave em `backend/` (porteiro, `bootstrapAdmin`, limitador de senha) segue lá, inerte: ~45 testes ainda o usam como atalho de autenticação.

**Aba `Usuarios` / `UsuariosVoleiMeme`** (criada sozinha no primeiro login): `email | nome |
perfil | jogadorId | criadoEm | jogadorIdPendente`. `jogadorId` é o vínculo APROVADO;
`jogadorIdPendente` é um pedido aguardando aprovação — nunca vinculam sozinhos: **todo pedido
de vínculo de conta→jogador precisa ser aprovado por um organizador ou admin** (existe pra
impedir que um estranho se declare "dono" de um jogador de verdade). Aprovar deixa escolher um
jogador diferente do que foi pedido, caso o palpite automático por nome tenha errado.

**Perfis e o que cada um pode** (matriz em `PERMISSOES` no `.gs` e `PERMISSOES_UI` no `.html`
— front é só conforto visual, quem manda de verdade é o backend):

| Ação | jogador | organizador | admin |
|---|---|---|---|
| Ver tudo, check-in | ✅ (livre, sem login) | ✅ | ✅ |
| Cadastrar/editar jogador, montar/lançar rodada | ❌ | ✅ | ✅ |
| Ver estrelas mesmo se admin escondeu do público | ❌ | ✅ | ✅ |
| Travar/abrir/fechar check-in | ❌ | ✅ | ✅ |
| Ver lista de usuários e aprovar/rejeitar vínculo | ❌ | ✅ (sem ver cargo de ninguém) | ✅ |
| Remover jogador/rodada, mudar visibilidade de estrelas pro público, mudar CARGO de alguém, remover usuário | ❌ | ❌ | ✅ |

Editar a própria foto (não o nome) é liberado pra qualquer perfil, inclusive `jogador`, via
exceção específica no backend (`excecaoPropriaFoto_`).

**Tela "Meu Perfil"**: estatísticas pessoais (rodadas, vitórias, aproveitamento, ranking,
sequência de presença, comparação com a média do grupo, melhor/pior parceiro), troca de foto
(apaga a antiga do Drive automaticamente) e vínculo com jogador — igual nos dois apps.

## Erros já vividos neste projeto (não repetir)

- **Cache de GET no Apps Script**: nunca confiar em `fetch()` simples pra
  ações que precisam de dado sempre fresco (tipo contador de acesso) — POST
  não é cacheado por padrão, GET pode ser. Prefira POST pra qualquer ação que
  precise de garantia de dado atual.
- **Tag `<nav>` genérica**: CSS com seletor de tag pura (`nav{...}`) sem
  classe pode vazar pra qualquer elemento `<nav>` novo que for criado depois,
  mesmo sem querer. Prefira sempre seletor de classe/ID.
- **Tag `<section>` dentro de uma tela some**: o CSS tem `section{display:none;}` / `section.active{display:block;}`
  (é assim que as abas trocam). Qualquer `<section>` criado dentro de uma tela (cartão, placa, bloco) fica invisível.
  Use `<div>` (com `role="group"` + `aria-label` se precisar de rótulo). Visto na rodada dupla, v14.6→14.7.
- **z-index de tooltips dentro de modais**: qualquer popup/dica criado
  dinamicamente e inserido no `<body>` precisa de z-index maior que o do
  modal mais alto do app (hoje: 300), senão fica escondido atrás mesmo
  "existindo" no DOM.
- **`porte`, `datasCampeao` e outros campos novos**: ao adicionar campo em
  jogador/rodada, sempre atualizar os DOIS lados — o `readXxx()` e o
  `writeXxx()`/`addXxx()`/`updateXxx()` no `.gs` — e a coluna correspondente
  precisa existir na planilha antes de usar.
- **Função de teste que termina em `_` some do seletor "Executar"**: o Apps
  Script trata `nomeQualquer_()` como função privada e não lista ela no menu
  de execução manual do editor. Qualquer função pensada pra ser rodada à mão
  (testes de diagnóstico, etc.) não pode terminar em `_`.
- **Apps Script "esquece" de pedir autorização de um escopo novo**: se o
  código passa a usar algo novo (ex: `UrlFetchApp` depois que o script só usava
  `SpreadsheetApp`), rodar a função nem sempre reabre a tela de permissão —
  ele pode reusar uma autorização antiga e dar
  `You do not have permission to call UrlFetchApp.fetch...`. Solução: em
  https://myaccount.google.com/permissions, remover o acesso desse projeto
  específico e rodar a função de novo — aí a tela de permissão nova aparece
  com o escopo certo.
- **Mesmo Client ID OAuth serve pros dois apps**: o Google Cloud só valida a
  ORIGEM (esquema+domínio+porta) nas "Origens JavaScript autorizadas", não o
  caminho — então um Client ID com origem `https://libertsapp.github.io` já
  cobre `/volei/` e `/voleimeme` ao mesmo tempo. Não precisa criar um segundo.

## Convenções de estilo

- Comentários em português, explicando o *porquê*, não só o *o quê*
- Nomes de função/variável em português quando fazem sentido de domínio
  (`pesoDe`, `montarGrupos`, `equilibrarTimes`)
- Emojis usados com moderação em textos de interface, não em nomes de função
