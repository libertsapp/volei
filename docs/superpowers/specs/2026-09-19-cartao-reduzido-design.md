# Cartão do Jogador reduzido nas telas de time e listas (Fase 1) — Design

**Data:** 2026-09-19 · **Versão alvo:** 9.0 · **Escopo inicial:** só o Terça (`volei-dashboard.html`)
**Depende de:** `docs/superpowers/specs/2026-09-18-card-jogador-design.md` (cartão completo, já implementado até a v8.9)

## Contexto

O cartão completo (borda em degradê, anel no avatar, hexágono, emblemas, `>` que expande as métricas)
já vale na aba **Jogadores**, no **Meu Perfil** e no **modal de perfil**. O pedido agora é levá-lo a todas as
telas que mostram jogadores, em **duas fases**:

- **Fase 1 (este documento):** Check-in, Sorteio, Histórico de rodadas e Nova Rodada, com uma variação
  **reduzida**: mesmo visual, **sem hexágono, sem emblemas, sem `>`**, só o símbolo ♂/♀ e as **estrelas
  para quem pode ver**.
- **Fase 2 (spec próprio, depois):** telas de estatística (Ranking, Hall da Fama, Top 10 de fotos, Duplas,
  Panelas, Defuntos) e áreas de destaque (Início, Ao Vivo) com o cartão **completo**, cada uma com seu
  mini-desenho (ex.: hexágono do Ranking = posição no ano escolhido; o pódio animado vira cartões?).

## Onde entra na Fase 1

| Tela | Função hoje | Como fica |
|---|---|---|
| Check-in (lista) | `renderCheckinList` — `<label class="select-row" data-checkin-toggle>` com avatar, nome, emblemas, estrelas, letra M/F e botão | Cartão reduzido dentro do mesmo `<label>`; o botão "Vou jogar/Confirmado" vai para o espaço da direita |
| Sorteio (lista) | `renderSorteioList` — `<label class="select-row">` com checkbox | Cartão reduzido com o checkbox à esquerda |
| Sorteio (grupos) | `renderGroupsInto` — `.draft-chip` arrastável | Cartão reduzido **que é** o `.draft-chip` (mesmas classe e atributos) |
| Sorteio (times sorteados) | `renderDraftResult` — `.draft-chip` arrastável | Idem |
| Histórico de rodadas | `renderHistory` (2 pontos) — `.with-avatar` dentro de `.history-team` | Cartão reduzido por jogador dentro de cada time |
| Nova Rodada | `playerTriggerHtml` (jogador escolhido no slot) e chips de convidados (`renderRodadaGuestChips`) | Cartão reduzido. **Os itens do dropdown de busca do picker ficam como estão** (são resultados de busca, dezenas por vez) |

**Não muda nesta fase:** `renderCheckinOrdenados` (lista numerada de confirmados só com nomes), o modo de
edição da aba Jogadores, e qualquer coisa da Fase 2.

## Componente: variação `reduzido`

Extensão de `jogadorCardHtml(d, opcoes)` (mesma função pura, mesmo trecho `// <jogador-card-puro>`).

`opcoes.variante: 'reduzido'` produz:
- **Sem** hexágono, **sem** emblemas (`emblemasHtml` é ignorado), **sem** painel de métricas, **sem** `>`.
- Só o símbolo ♂/♀ (`jc-sexo`, com o texto no tooltip) — sem "G" de conta e sem pílula.
- As **estrelinhas** logo depois do nome/símbolo (não na linha de tags): `d.estrelasHtml`, que já vem `''`
  quando o usuário não pode vê-las.
- Avatar menor (38px) e nome em 14px; linha única, ~56px de altura. Em cartão estreito (colunas do
  histórico, ~160px) o nome fica numa linha e ♂/★ quebram para baixo (`flex-wrap`).
- **Sem animação de entrada** (`.jc-lista` continua tendo; `.jc-reduzido` não). Motivo: Check-in e
  Sorteio re-renderizam a lista inteira a cada clique/soltura, e uma animação de entrada faria toda a
  lista "piscar" a cada toque.

Novos campos de `d` (todos opcionais; o cartão completo não muda):
- `nomeHtml`, `apelidoHtml` — HTML **já escapado** que substitui `escapeHtml(nome/apelido)`. Existem para
  manter o destaque da busca (`highlightMatch` devolve `<mark>` já escapado) no Check-in e no Sorteio.
- `leadingHtml` — antes do avatar (o checkbox do Sorteio).

Novos campos de `opcoes`:
- `nomeAbrePerfil` (bool, padrão `true` fora do `perfil`) — no Check-in e no Sorteio (lista) o nome
  **não** abre o perfil (hoje tocar na linha alterna o check-in/seleção; não pode mudar). No Histórico
  e nos chips do sorteio abre, como hoje (`clickable-name`).
- `classesExtra` (string) e `atributos` (string de atributos HTML **já confiáveis**, montada por quem
  chama a partir de ids do próprio app) — para o cartão *ser* o `.draft-chip` arrastável:
  `classesExtra:'draft-chip'`, `atributos:'draggable="true" data-player-id="…" data-from-team="…"'`.

### Dados

`montarDadosReduzido(p, mostrarEstrelas, extras)` — impura, fina, **sem** `computeBadges`, `computeRanking`
nem `computePlayerAllTimeStats` (nada disso é usado na variação; as telas ficam mais leves que hoje):
```
{ id, nome, apelido, foto, sexo,
  estrelasHtml: mostrarEstrelas && nota>0 ? starsDisplay(p.estrelas, p._estrelaAjustada) : '',
  ...extras }
```
`p._estrelaAjustada` (nota ajustada só para o check-in do dia) mantém a estrela **vermelha** no Sorteio.
Serve também para convidados (`GUESTS`), que não têm foto nem estatísticas: cai na inicial do nome.
`mostrarEstrelas` vem de `starsVisibleNow()` (regra que já existe: público só vê se o admin liberou;
organizador/admin sempre veem).

## Comportamento por tela

- **Check-in:** o `<label data-checkin-toggle="ID">` é mantido em volta do cartão e o botão
  `[data-checkin-btn]` continua sendo o único elemento clicável (os `addEventListener` atuais não mudam).
  Tag "convidado" via `tagsExtraHtml`. Busca com destaque via `nomeHtml`/`apelidoHtml`.
- **Sorteio (lista):** o checkbox `input[data-id]` vai em `leadingHtml`; o listener delegado atual
  (`input[type=checkbox]`) não muda. Busca com destaque.
- **Sorteio (grupos e times):** o cartão é o `.draft-chip`; os handlers de arrastar
  (`querySelectorAll('.draft-chip')`) e os `data-*` continuam idênticos. A tag "convidado" e a estrela
  ajustada em vermelho são preservadas. A letra M/F vira símbolo.
- **Histórico:** cada jogador do time vira cartão reduzido (nome abre o perfil). Jogador removido
  (`getPlayer` vazio) continua como o texto "(removido)".
- **Nova Rodada:** o slot escolhido (`.picker-trigger`, um `<button>`) passa a conter o cartão reduzido
  (um `<div>` dentro de `<button>` é inválido pela especificação, mas funciona em todos os navegadores, e
  o `<span>` de hoje já convive com outros elementos ali). Chips de convidado idem, com o `✕` de remover
  em `acoesHtml`.

## Visual

Tokens e regras do cartão completo (borda em degradê, anel, `--jc-fundo` opaco). Só o que a variação muda:
```
.jc-reduzido .jc-topo    padding 8px 12px; gap 10px
.jc-reduzido .jc-foto    38px; anel de 2px
.jc-reduzido .jc-nome    14px, margin-right 6px
.jc-reduzido .jc-icones  sem borda esquerda nem padding (é só o ♂/♀)
```
Modo claro e 360px sem rolagem horizontal, como no cartão completo.

## Casos de borda

- Jogador sem estrelas cadastradas (0) ou estrelas ocultas: nada aparece (sem espaço vazio).
- Convidado (`isGuest`): sem foto → inicial; nome com tag "convidado".
- Nome/apelido enormes: reticências (`.jc-nome`), sem estourar a coluna do histórico.
- Lista vazia / busca sem resultado: mensagens atuais continuam.
- `p._estrelaAjustada` só existe no sorteio; no Check-in a estrela é a normal.
- Check-in travado ou sem login: cartões aparecem, botão desabilitado (comportamento atual).

## Testes

- **Node (função pura):** `reduzido` sem `jc-hex`, sem emblemas (mesmo passando `emblemasHtml`), sem
  `jc-painel`/`jc-toggle`; só `jc-sexo`; estrelas presentes/ausentes; `nomeHtml`/`apelidoHtml` usados
  sem re-escapar; `leadingHtml`; `nomeAbrePerfil:false` sem `data-open-profile`; `classesExtra` e
  `atributos` no elemento raiz; nome escapado; divs balanceadas em todas as combinações.
- **Node (dados):** `montarDadosReduzido` com estrelas ocultas, zero, ajustada, convidado sem foto.
- **Navegador (Chrome sem interface + dados reais):** para cada tela — sem erro de JavaScript, sem rolagem
  horizontal em 390px, alternar o check-in de um jogador funciona (label + botão), marcar/desmarcar no
  Sorteio, **arrastar um chip entre times** funciona, nome no histórico abre o perfil, busca com destaque.
- Sintaxe do projeto (`node --check` no `<script>`).

## Versão, publicação e Meme

- **9.0** (reestruturação de várias telas = número redondo) e entrada no Log de Alterações.
- Só o Terça. **Meme somente após autorização**, pelo mesmo merge de 3 vias (cores vêm dos tokens).
- Sem mudança de backend.

## Riscos

- **Arrastar e soltar:** o cartão precisa ser exatamente o elemento que os handlers esperam
  (`.draft-chip` + `data-*`). Coberto pelo teste no navegador.
- **Check-in:** `label` + `button` dentro do cartão; um clique no botão não pode disparar duas vezes.
- **Listas mais longas:** ~46px → ~56px por linha (~20%). Aceito.
- **Slot da Nova Rodada** (`div` dentro de `button`): fora da especificação, mas comportado; se aparecer
  algum problema de foco/teclado, o plano prevê trocar o `<button>` por um `div role="button"`.

## Ajuste posterior (2026-09-19, v9.5)

**Histórico de rodadas voltou ao estilo antigo** (pedido do usuário): linha simples com avatar pequeno + nome (e o apelido em cinza),
sem os emblemas que a linha antiga tinha. O nome continua abrindo o perfil nas rodadas oficiais e não abre nos rascunhos, como antes da
Fase 1. Nesta tela o cartão reduzido **não é mais usado** (a tabela "Onde entra" acima vale para as demais telas). O cartão compacto
(`jc-mini`) segue no verso do quadro do Início.
