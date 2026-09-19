# Cartão do Jogador completo nas telas de estatística e destaques (Fase 2) — Design

**Data:** 2026-09-19 · **Versões alvo:** 9.1 (etapa 2A) e 9.2 (etapa 2B) · **Escopo:** só o Terça (`volei-dashboard.html`)
**Depende de:** `2026-09-18-card-jogador-design.md` (cartão completo) e `2026-09-19-cartao-reduzido-design.md` (Fase 1, já implementada, v9.0)

## Contexto

A Fase 1 levou o cartão **reduzido** a Check-in, Sorteio, Histórico e Nova Rodada. Esta fase leva o cartão
**completo** (variante `lista`: hexágono, emblemas, "G", pílula `>` que expande as métricas) às demais telas
em que jogadores aparecem, cada uma com o seu mini-desenho. Decisões já tomadas com o usuário:

- **Top 10 de fotos:** o pódio dos 3 primeiros fica; o resto vira cartão.
- **Ranking:** a tabela sai; vira lista de cartões **abertos**, com as métricas do ano escolhido.

## Onde entra

### Etapa 2A (v9.1) — listas simples

| Tela | Função | Como fica |
|---|---|---|
| Ranking (aba) | `renderRanking` + `rankingTableHtml` | Pódio do topo (`rankingPodioHtml`) **mantido**; a tabela é trocada por cartões `lista` **abertos** |
| Top 5 do Início | `renderDashboard` → `rankingTableHtml(top5)` | Idem, com os 5 primeiros do ano corrente |
| Hall da Fama | `renderHallDaFama` | Cada vencedor (mês/ano) vira cartão fechado com a tag "🏆 N× na foto" |
| Duplas | `renderDuos` | `#rank` + cartão + "+" + cartão + "N×"; empilha no celular |
| Panelas | `renderPanelas` | Cabeçalho (rank, time, data) e linha "Média do time…" **mantidos**; os chips viram grade de cartões |
| Defuntos | `renderDefuntos` | Cartão fechado com a tag "N dias sem jogar" em vermelho (`jc-tag-alerta`) |

### Etapa 2B (v9.2) — telas delicadas

| Tela | Função | Como fica |
|---|---|---|
| Top 10 de fotos | `renderPhotoChart` | Pódio (1º–3º e a faixa de empate) **inalterado**. O **4º em diante** e o **2º/3º da faixa de empate** viram cartões fechados; o "N×" animado e a barra de progresso ficam na linha de tags, com os **mesmos ids** (`lb-count-*`, `lb-fill-*`, `podium-count-*`) que a animação já usa |
| Início — card de campeões | `renderDashboard` (frente e verso) | Frente: os `chip with-avatar` com nomes viram cartões fechados (o nome do time e os avatares empilhados ficam). Verso: as linhas de jogador de cada time viram cartões fechados. O empate compacto (`sb-team-mini`) **não muda** |
| Ao Vivo | `renderAoVivo` | Jogadores de cada time viram cartões fechados, **sem animação de entrada** |

**Fora do escopo:** Histórico/Check-in/Sorteio/Nova Rodada (Fase 1), aba Jogadores, Meu Perfil, modal de
perfil, `renderCheckinOrdenados`, dropdown do picker, o diálogo de vínculo de conta.

## Componente: extensões da função pura

Todas opcionais; nada muda para quem não as usa.

- `opcoes.tituloAtributos` (string de atributos já confiáveis): o número de **Títulos** ganha
  `class="ranking-titulos-clicavel"`, `title="Toque para ver as datas"` e esses atributos. O Ranking passa
  `data-ranking-titulos="ID"` para reaproveitar `wireRankingTitulosClicks` sem mudança.
- `opcoes.semAnimacao` (bool): adiciona a classe `jc-sem-anim` (`animation:none`). Usado no Ao Vivo, que
  re-renderiza a cada poll (9s) e a cada clique nos `+`/`−`.
- `opcoes.tela` (string): vira `data-jc-tela` na raiz. Isola o estado "aberto" por tela (ver abaixo).
- Já existem e passam a ser usados: `d.posicao`, `d.metricas` (para o Ranking, os números **do ano**
  escolhido) e `d.tagsExtraHtml` (tags de contexto: "N× na foto", "N dias sem jogar").

### Estado "aberto" por tela

Hoje `JOGADOR_CARD_ABERTOS` guarda ids soltos e só a lista da aba Jogadores tem o listener do `>`.
Passa a guardar a chave `"<tela>:<id>"` e o listener vira **um só, delegado no `document`**:
```
tela = card.dataset.jcTela || 'jogadores'
chave = tela + ':' + card.dataset.jcId
```
Assim abrir o Fábio no Ranking não abre o Fábio no Hall. `renderPlayers` passa a usar
`JOGADOR_CARD_ABERTOS.has('jogadores:' + p.id)`. O Ranking usa `aberto:true` fixo (não persiste o fechar).

### Helpers (impuros, finos)

- `jcAberto(tela, id)` → bool, lê o `Set`.
- `montarDadosCard(p, ctx, extras)` já aceita `extras`; o Ranking passa `{ posicao, metricas }` do ano.
- `posicoesDoAno(ano)` → `{ [id]: n }` (para o hexágono do Ranking no ano escolhido); o resto das telas usa
  `contextoCards().posicoes` (ano corrente), como na aba Jogadores.

## Comportamento por tela

- **Ranking:** `rows = computeRanking(ano)` (já ordenado; o índice é a posição). Cada cartão:
  `posicao = índice+1`, `metricas = { partidas: jogos, titulos, pct, vitorias: vitoriasPartidas }` **do ano**,
  aberto, com `tituloAtributos: 'data-ranking-titulos="ID"'`. Ano sem rodadas: mensagem de vazio atual.
- **Top 5 do Início:** mesma função, ano corrente, `slice(0,5)`.
- **Hall:** `v.id` → `getPlayer`; sem jogador (removido) o vencedor é omitido, como hoje.
- **Duplas:** jogador removido continua como "(removido)" (texto, sem cartão).
- **Panelas:** o array `players` tem buracos (removidos): omitidos da grade.
- **Defuntos:** `dias` na tag; cartão fechado.
- **Top 10 de fotos:** dados de `computePhotoCounts` são `{id, nome, apelido, foto, vezes}`, **não** jogadores;
  o cartão usa `getPlayer(d.id)` e a contagem vem de `d.vezes`. A animação `animarContador` e a barra
  (`lb-fill-*`) continuam apontando para os mesmos ids, agora dentro de `tagsExtraHtml`.
- **Início (flip):** o clique no `.jc-toggle` **não pode virar o quadro** (hoje só `[data-open-profile]` é
  exceção); o auto-desvirar de 5s continua. Como o verso gira em 3D (`preserve-3d`, `backface-visibility`),
  o cartão dentro do verso **não** usa `backdrop-filter` (já não usa).
- **Ao Vivo:** os cartões abertos sobrevivem aos re-renders pelo `Set` (chave `aovivo:id`).

## Visual

- Colunas de time estreitas (`.history-teams`, mínimo 160px) não comportam o cartão completo:
  `.history-teams:has(.jc-lista){grid-template-columns:repeat(auto-fit,minmax(280px,1fr));}`.
- Duplas: `display:grid` de 3 colunas (cartão, "+", cartão) com o rank e o "N×" nas pontas; abaixo de
  ~700px de largura do container, uma coluna.
- Panelas: `grid-template-columns:repeat(auto-fill,minmax(260px,1fr))`.
- Hall: cartão dentro de `.hall-winner` sem o avatar/nome/troféu antigos; o 🏆 vai na tag.
- `jc-tag-alerta`: mesma família visual de `.player-absence.alerta` (vermelho, borda vermelha).
- `.aovivo-card .jc-lista{animation:none}` além do `semAnimacao`, como cinto de segurança.
- Modo claro e 390px sem rolagem horizontal.

## Casos de borda

- Ranking com 1 jogador; ano corrente sem rodadas (Top 5 do Início mostra a mensagem atual).
- Empate no 1º do Top 10: a faixa de empate mantém os avatares grandes; só o 2º/3º viram cartão.
- Jogador removido em qualquer lista: item omitido (ou "(removido)" nas Duplas).
- Admin oculta as estrelas: coluna e estrelinhas somem, como no resto do app.
- Ao Vivo sem transmissão: tela vazia atual.

## Testes

- **Node (função pura):** `tituloAtributos` (classe + atributos só no Títulos), `semAnimacao`, `tela` no
  atributo, e que nada disso aparece quando não passado. Helpers de chave do `Set`.
- **Navegador (Chrome sem interface, dados reais)** por tela: sem erro de JavaScript; contagem de cartões
  = itens esperados; hexágono do Ranking igual à posição no ano escolhido (trocar o ano); **clicar em Títulos
  no Ranking abre as datas**; abrir um cartão no Ranking **não** abre o mesmo jogador na aba Jogadores;
  Top 10: contadores chegam ao valor final e os ids existem; Início: clicar no `>` **não** vira o card, tocar
  fora vira; Ao Vivo: cartão aberto **continua aberto** depois de um re-render simulado e nenhum elemento
  do cartão tem animação; 390px sem rolagem horizontal em todas.
- Sintaxe do projeto (`node --check`).

## Versão, publicação e Meme

- **9.1** ao fim da 2A e **9.2** ao fim da 2B, cada uma com entrada no Log de Alterações.
- Só o Terça. Meme **somente após autorização**, pelo mesmo merge de 3 vias. Sem mudança de backend.

## Riscos

- **Card 3D do Início:** container queries + `preserve-3d`. Coberto por teste no navegador; se falhar, o
  verso usa o cartão reduzido.
- **Ao Vivo:** re-render frequente; nenhuma animação, estado por `Set`.
- **Top 10:** ids dos contadores e da barra precisam existir **antes** do `requestAnimationFrame` da
  animação (a marcação é montada por `container.innerHTML`, como hoje).
- **Desempenho:** telas com dezenas de cartões chamam `computePlayerAllTimeStats` por jogador (O(rodadas));
  `contextoCards()` é montado uma vez por render. Aceitável nos volumes atuais (~46 jogadores, ~15 rodadas/ano).
- **Estado compartilhado:** a migração da chave do `Set` (`"tela:id"`) mexe em `renderPlayers` (Fase anterior);
  coberta pelo teste de que a aba Jogadores continua abrindo/fechando e sobrevivendo a re-render.

## Ajustes feitos no planejamento (2026-09-19)

1. **Quadro do Início não vira ao tocar em QUALQUER parte de um cartão** (não só no `>`): senão tocar nas métricas ou no hexágono viraria o quadro. O resto do quadro continua virando, e o nome do jogador continua abrindo o perfil.
2. **`wireRankingTitulosClicks` passa a receber o container:** hoje ela varre o `document` inteiro; com o Ranking e o Top 5 do Início renderizados ao mesmo tempo, os cartões de um lugar ganhavam o listener duas vezes e a janela de datas abria em dobro.
3. **`renderPhotoChart` não precisa mais do `computeBadges()` próprio** (o cartão traz os emblemas pelo `contextoCards()`).
4. **Cartão compacto no verso do quadro e no Histórico (pedido do usuário, v9.3):** o cartão completo no verso do quadro do Início ficou grande demais. Verso e Histórico passam a usar o cartão **reduzido compacto** (`opcoes.compacto` → classe `jc-mini`): avatar de 22px, nome de 11px, sem apelido nem tags, ~36px de altura, e colunas de time de 112px (`minmax`) — cabem 4 times lado a lado em ~506px. Perde-se, no verso, o hexágono/emblemas/`>` (o nome ainda abre o perfil completo). A contingência de usar o cartão reduzido no verso prevista no plano virou a decisão final.
5. **Verso do quadro de campeões no estilo do Histórico (pedido do usuário, v9.6):** o verso ("Times de …") deixa de usar cartões e passa a usar as mesmas linhas simples do Histórico (avatar pequeno + nome, sem emblemas), nos mesmos tamanhos e com as mesmas colunas (`.history-teams` padrão). A frente do quadro continua com os cartões dos campeões. Isso substitui o item 4 acima (cartão compacto), e o modo compacto (`opcoes.compacto`/`jc-mini`) foi **removido** por ter ficado sem uso.
