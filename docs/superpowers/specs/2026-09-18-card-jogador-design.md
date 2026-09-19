# Cartão do Jogador (visual futurista) — Design

**Data:** 2026-09-18 · **Versão alvo:** 8.6 · **Escopo inicial:** só o Terça (`volei-dashboard.html`)

## Objetivo

Levar para o app o cartão de jogador da imagem de referência (vidro fosco, borda em degradê
ciano→roxo, avatar com anel neon e hexágono numerado, emblemas separados por traços, pílula `>`
e uma linha de 4 métricas com ícone). Um único componente, usado em três lugares.

## Onde entra

| Lugar | Variação | Comportamento |
|---|---|---|
| Lista **Jogadores** (`renderPlayers`) | `lista` | Nasce **fechado** (~90px): avatar+hexágono, nome, ícones, pílula do sexo, ✏️/✕ (com permissão) e `>`. O `>` abre/fecha a linha das 4 métricas |
| **Meu Perfil** (`renderMeuPerfil`) | `perfil` | Sempre aberto, sem `>`. Substitui o cabeçalho e as métricas duplicadas |
| **Modal de perfil** de um jogador | `perfil` | Idem |

Fora de escopo: Ranking, Hall da Fama, Histórico e o modo de edição inline do jogador
(`editPlayerRowHtml`, continua `.player-row-editing`).

## Decisões (registradas para poderem ser trocadas)

1. **Hexágono = posição no ranking do ano corrente** (`computeRanking(anoAtual)`). Sem jogo no ano, sem hexágono (nunca mostrar número inventado).
2. **"Vitórias" da imagem vira "Títulos"** (vezes campeão). Assim Partidas, Títulos e Aproveitamento (títulos ÷ rodadas) se explicam entre si. A "Vitórias" do app (soma de partidas ganhas) continua na grade do perfil.
3. **Estrelas** só aparecem quando `starsVisibleNow()`; se ocultas, a coluna some e as outras 3 se redistribuem.
4. **Ícone do Google:** "G" colorido em SVG inline no lugar do 👤 atual (`contaVinculadaIconHtml`), mesmo significado: jogador com conta vinculada.
5. **Cores só por tokens** (`--accent`, `--neon-purple`, `--glass-*`), então o Meme herda o cartão com a paleta dele, sem retrabalho de cor.

## Componente

`jogadorCardHtml(d, opcoes)` — **função pura** (sem `DATA`, sem DOM), num trecho marcado
`// <jogador-card-puro>` … `// </jogador-card-puro>` para ser testada em Node. Depende só de `escapeHtml`.

```
d = {
  id, nome, apelido, foto, sexo,        // sexo: 'M' | 'F' | ''
  temConta,                             // bool -> "G"
  emblemasHtml,                         // saída de badgeIconsHtml(...), já pronta
  posicao,                              // number | null  -> hexágono
  metricas,                             // { partidas, titulos, pct } | null (null = nunca jogou)
  estrelasHtml,                         // string | null (null = ocultas)
  ausenciaHtml,                         // string ('' se não se aplica) — só na lista
  acoesHtml                             // ✏️/✕ já filtrados por permissão — só na lista
}
opcoes = { variante: 'lista' | 'perfil', aberto: bool, tituloId: string|null }
```

Regras de saída:
- `metricas === null` → sem painel de métricas, sem `>`; mostra `ausenciaHtml` ("Sem participações").
- `estrelasHtml === null` → 3 colunas em vez de 4.
- `posicao === null` → sem hexágono.
- Sem foto → inicial maiúscula (`escapeHtml`) no avatar.
- Nome/apelido sempre escapados. `data-open-profile="${id}"` no nome (o clique global existente abre o perfil).
- `variante:'perfil'` → sem `>`, painel sempre aberto; o número de **Títulos** recebe `class="ranking-titulos-clicavel"` e `id="${tituloId}"`, preservando o toque que mostra as datas (`meuperfil-titulos-clicavel` / `profile-fotos-clicavel`).
- `variante:'lista'` → o `>` é um `<button class="jc-toggle" aria-expanded data-som="nav">`.

Fora da função pura (em `renderPlayers` / `renderMeuPerfil` / modal): calcular `metricas`
(`computePlayerAllTimeStats`), `posicao` (uma única chamada de `computeRanking` por render, não uma por jogador),
`emblemasHtml`, `estrelasHtml`, `acoesHtml`.

## Comportamento de expandir (lista)

- Estado em `JOGADOR_CARD_ABERTOS` (`Set` de ids), na memória.
- O clique no `>` (delegado em `#player-list`) só alterna a classe `.aberto` no cartão e o `aria-expanded` — **sem chamar `renderPlayers()`**. Re-renderizar reiniciaria a animação de entrada da lista e o cartão piscaria.
- `renderPlayers()` (que roda em vários eventos) lê o `Set` para reabrir os que estavam abertos.
- Clique nos botões ✏️/✕ e no nome não alterna o cartão.
- Animação: `grid-template-rows: 0fr → 1fr` (altura suave). `prefers-reduced-motion` já zera transições globalmente.

## Visual

- Cartão: fundo translúcido (`--glass-bg`), **sem `backdrop-filter`** nas linhas da lista (regra do projeto: blur só em superfícies de destaque); borda em degradê ciano→roxo via `background-clip` (`padding-box` / `border-box`); brilho `--glass-brilho`.
- Raio de luz diagonal: pseudo-elemento com `linear-gradient`, `overflow:hidden`, sem capturar cliques (`pointer-events:none`).
- Avatar: anel em degradê (wrapper com padding). Hexágono: dois `clip-path: polygon(...)` sobrepostos (contorno + miolo escuro).
- Métricas: ícones Tabler já carregados (`ti-calendar`, `ti-trophy`, `ti-gauge`, `ti-star`), rótulo em caixa alta pequeno, número em Work Sans 800. Cor do troféu = `--ball-yellow`, do resto = `--accent`/`--neon-purple`.
- Separadores verticais finos entre os ícones do topo e entre as métricas.
- Emblemas: `badgeIconsHtml` como está (emojis), só ganham o espaçamento com separadores.
- **Modo claro:** vidro branco (`--glass-bg` claro), borda em `--accent` petróleo, sem raio de luz.
- **360px:** avatar 56px, nome com reticências, emblemas quebram para a linha de baixo, métricas em 4 colunas compactas (ícone menor). Abaixo de 340px, grade 2×2. Nenhuma rolagem horizontal.
- O cartão entra na regra de entrada `entrar` da lista (`.jogador-card`), mas **nunca** dentro da tela Ao Vivo.

## Casos de borda

- Jogador sem nenhuma rodada: cartão sem métricas nem hexágono, "Sem participações".
- Jogador com foto quebrada/ausente: inicial. Nome enorme: reticências. Sem apelido: linha do apelido omitida.
- Sexo vazio: sem pílula. `temConta` falso: sem "G".
- Admin oculta as estrelas: coluna some, sem buraco.
- Lista vazia: mensagem atual (`Nenhum jogador cadastrado`) permanece.
- Perfil de quem não tem ranking no ano: sem hexágono.

## Testes

Script Node em `scratchpad` (fora do repositório), extraindo `jogadorCardHtml` pelos marcadores:
sem foto (inicial), nome com HTML escapado, `metricas:null`, `estrelasHtml:null` (3 colunas),
`posicao:null`, `variante:'perfil'` (sem `>`, com `id`/classe do título), `variante:'lista'` (com `>`,
`aria-expanded`), `aberto:true` (classe `aberto`), com/sem "G", sexo M/F/vazio.
Mais a validação de sintaxe do projeto (`node --check` no `<script>`).
Verificação visual humana: lista com muitos jogadores (escuro/claro, 360px), expandir várias vezes,
✏️ e ✕ ainda funcionam, Meu Perfil e modal, estrelas ocultas pelo admin, jogador sem partidas.

## Versão, publicação e Meme

- Versão 8.6 no rodapé e entrada no Log de Alterações (`#info-changelog`).
- Só o Terça primeiro. **Meme somente após autorização explícita**, replicado pelo mesmo merge de 3 vias
  (base = Terça antes do cartão) — cores vêm dos tokens, então só há ajuste de texto/comentários.
- Sem mudança de backend: nenhum `.gs` a reimplantar.

## Riscos

- Perda do toque "Vezes campeão → datas" se o id/classe do Títulos não for preservado (coberto pelo teste da variação `perfil`).
- Re-render do `renderPlayers` durante o uso do `>` (mitigado: toggle por classe + `Set`).
- Altura da lista fechada (~90px) ainda maior que a linha atual (~70px): aceitável, é o compromisso escolhido.

## Ajustes feitos no planejamento (2026-09-18)

Refinamentos descobertos ao ler o código; valem no lugar do que estiver dito acima:

1. **`estrelas` (número | null) no lugar de `estrelasHtml`:** a coluna mostra o valor ("4,5"), não as 5 estrelinhas, que não cabem numa coluna. `null` ou `0` = coluna oculta.
2. **Novo campo `tagsExtraHtml`:** o modal de perfil já mostra o emblema de *porte* ao lado do sexo; ele passa por aqui para não sumir.
3. **Fundo do cartão opaco** (`--court-navy-2`), não `--glass-bg`: o degradê da borda fica numa camada por baixo e vazaria por um miolo translúcido.
4. **Responsivo por *container query*** (cartão com menos de 480px → métricas em 2×2), no lugar das faixas 360/340px por tela: o modal de perfil tem 440px em qualquer aparelho.
5. **`data-open-profile` só na variação `lista`:** na variação `perfil` (dentro do modal) o clique global reabriria o próprio perfil.
6. **Estrelinhas de relance (pedido do usuário):** campo `estrelasHtml` (as 5 estrelinhas de `starsDisplay`) ao lado da pílula de sexo. Na `lista` aparecem sempre (fechada ou aberta), para quem confere notas sem expandir; no `perfil` só quando não há painel de métricas (com painel a coluna "Estrelas" já mostra a nota). Seguem a mesma regra de visibilidade: somem quando o admin oculta as estrelas.
7. **Sem pílula "Masculino/Feminino" (pedido do usuário, v8.7):** o símbolo ♂/♀ ao lado do nome já diz o sexo (texto no tooltip). A linha de tags só existe quando há estrelinhas, ausência ou emblema extra.
8. **Hexágono mais afastado da foto (v8.7):** `left/bottom: -12px` (era -4/-8) e `padding` do topo maior (`14px 14px 18px 20px`), para cobrir só uma pontinha do anel.
