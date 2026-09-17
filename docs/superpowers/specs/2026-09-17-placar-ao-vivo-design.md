# Placar Ao Vivo (v2) — desenho

Data: 2026-09-17
Status: aprovado no chat, aguardando revisão final do arquivo antes do plano de implementação.

## Contexto

Já existiu uma tentativa de "Placar Ao Vivo" como página separada
(`volei-placar-ao-vivo.html`), removida por completo no commit `5d665f8`
("não ficou como esperado"). Esta spec desenha a funcionalidade do zero,
reaproveitando o máximo possível da estrutura já existente (modelo de
rodada, grid de times do Histórico, modal de edição de rodada) em vez de
duplicar lógica, como a tentativa anterior fez.

Regra do projeto: implementar e validar **só no Terça**
(`volei-dashboard.html` + `apps-script-codigo.gs`) primeiro. Replicar pro
Meme só depois de autorização explícita.

## Objetivo

Uma página nova dentro do dashboard (`volei-dashboard.html`) que:

1. Pega rodadas "rascunho" (times montados, placar ainda não lançado) do
   Histórico e permite transmiti-las ao vivo.
2. Mostra os times em quadros (mesmo layout visual do Histórico), com um
   contador de vitórias controlável por organizador/admin.
3. Atualiza sozinha pra quem só está assistindo (polling).
4. Mantém um log público de mudanças de placar, com horário, pra
   conferência/auditoria de quem está assistindo.

## Fluxo geral

```
Rascunho (Histórico)
   │  [organizador/admin clica "📡 Transmitir ao vivo"]
   ▼
Capturado na aba AoVivo (planilha) — some da lista de "disponível pra capturar"
   │
   ├─ organizador ajusta +/- localmente (sem gravar a cada clique)
   │  e clica "💾 Salvar parcial"
   │       → grava vitórias atualizadas na aba AoVivo
   │       → grava o delta de cada time que mudou na aba AoVivoLog
   │
   ├─ [Cancelar transmissão] → apaga linhas da rodada em AoVivo e
   │  AoVivoLog. Rascunho original em "Rodadas" fica intocado (rascunho
   │  continua disponível pra ser capturado de novo).
   │
   └─ [Lançar placar final →] → abre o modal de edição de rodada já
      existente, pré-preenchido com o placar ao vivo atual, pra escolher
      vencedor(es) → grava definitivo em "Rodadas" (rascunho:false) e
      limpa as linhas da rodada em AoVivo e AoVivoLog.

Quem só assiste: a página "Ao Vivo" faz polling (POST, ~8-10s) e
atualiza placar + log sozinha, sem precisar de F5.
```

## Planilha — abas novas

### `AoVivo`

Espelho da rodada, isolado de `Rodadas` — assim ler "o que está ao vivo
agora" não depende de cruzar com a aba de rodadas em tempo real, e uma
rodada só sai daqui quando cancelada ou lançada (nunca por alguém fechar
a página).

Colunas: `roundId | data | timeIndex | timeNome | jogadores | vitorias | iniciadoEm`

- `jogadores`: IDs separados por vírgula, igual à aba `Rodadas`.
- `iniciadoEm`: timestamp ISO de quando a transmissão começou.

### `AoVivoLog`

Append-only. Uma linha por time cujo valor de vitórias mudou a cada
clique em "Salvar parcial" — não uma linha por clique de +/-. Se o
organizador clicou duas vezes no [+] antes de salvar, sai UMA linha com
`delta: 2`.

Colunas: `roundId | timeIndex | timeNome | delta | timestamp`

- `delta` positivo → exibido como `"HH:MM Time X venceu (+N)"`.
- `delta` negativo → exibido como `"HH:MM Time X teve N ponto(s) retirado(s)"`.
- Ao cancelar transmissão ou lançar placar final daquela rodada, as
  linhas de log dela são apagadas junto — é uma ferramenta de
  conferência em tempo real, não um histórico permanente separado do
  que já fica gravado em `Rodadas`.

O comentário de cabeçalho do `.gs` (que hoje documenta as 5 abas
obrigatórias) precisa ser atualizado pra listar as 7 abas.

## Backend (`apps-script-codigo.gs`)

Ações novas em `doPost`, dentro do switch autenticado (mesmo padrão de
`addRound`/`updateRound` — passam por `autorizar_`, exigem perfil
organizador ou admin):

- **`iniciarTransmissaoAoVivo(roundId)`** — valida que a rodada existe,
  está com `rascunho:true` em `Rodadas`, e ainda não tem linhas em
  `AoVivo`. Copia os times pra `AoVivo` (vitórias = valor atual do
  rascunho, normalmente 0) com `iniciadoEm = agora`. Erros possíveis:
  rodada não encontrada, rodada não é mais rascunho, rodada já está ao
  vivo.
- **`salvarParcialAoVivo(roundId, vitoriasPorTime)`** — recebe um array
  com o novo valor de vitórias por `timeIndex`. Pra cada time cujo valor
  mudou em relação ao que está salvo em `AoVivo`, grava uma linha em
  `AoVivoLog` com o delta e o timestamp atual. Depois sobrescreve as
  vitórias em `AoVivo`.
- **`cancelarTransmissaoAoVivo(roundId)`** — apaga linhas da rodada em
  `AoVivo` e `AoVivoLog`. Não toca em `Rodadas`.
- **`lancarPlacarAoVivo(roundId, vencedores)`** — chamada a partir do
  modal de edição de rodada existente (reaproveitado): grava o
  resultado final em `Rodadas` via `updateRound` (com as vitórias vindas
  de `AoVivo`, `rascunho:false`, vencedores escolhidos no modal) e limpa
  as linhas dessa rodada em `AoVivo` e `AoVivoLog`.

Ação nova pública, **fora** do bloco autenticado (mesmo padrão de
`addCheckin`/`incrementarAcesso` — só valida token do Google se aplicável,
sem exigir organizador/admin):

- **`lerAoVivo()`** — via **POST**, de propósito (não GET): GET pode
  ficar em cache no navegador/proxy, e essa é uma ação que precisa de
  dado sempre fresco a cada poll (lição já registrada no CLAUDE.md deste
  projeto). Retorna todas as rodadas atualmente em `AoVivo`, com seus
  times e o log (`AoVivoLog`) correspondente, ordenado por timestamp
  decrescente.

`doGet` ganha `aoVivo` (rodadas + log) no payload inicial, pro primeiro
carregamento da página "Ao Vivo" não depender de esperar o primeiro poll.

Todas as gravações passam pelo `LockService` já usado em todo lugar
sensível do projeto, pra evitar que dois cliques de "Salvar parcial"
simultâneos se atropelem.

## Frontend (`volei-dashboard.html`)

**Histórico:** cada card de rascunho pendente ganha um botão novo
"📡 Transmitir ao vivo" ao lado do já existente "Lançar placar →",
visível só pra organizador/admin (`PERMISSOES_UI` cuida da exibição; o
backend cuida da validação de verdade).

**Nova página "Ao Vivo"** no menu do dashboard, sempre acessível (com um
indicador 🔴 quando há alguma transmissão ativa). Se não houver nenhuma
rodada ao vivo, mostra um estado vazio simples.

Pra cada rodada ao vivo, um card com:

- Data e horário de início.
- Grid de quadros de time, reaproveitando as classes `.history-teams` /
  `.history-team` do Histórico (mesmo visual, se adapta a 2/3/4 times).
- Dentro de cada quadro: nome do time, jogadores com avatar (igual ao
  Histórico), e um contador `[-] N [+]` — editável só pra
  organizador/admin; quem só assiste vê o número, sem os botões.
- Log da partida ("📋 Log da partida") abaixo do placar: lista das
  entradas de `AoVivoLog` daquela rodada, formato `"HH:MM Time X venceu
  (+N)"` ou `"HH:MM Time X teve N ponto(s) retirado(s)"`, mais recente
  primeiro. Visível pra qualquer um.
- Botões (só organizador/admin): "💾 Salvar parcial" (flutuante, sempre
  visível), "Cancelar transmissão" (com confirmação), "Lançar placar
  final →" (abre o modal de edição de rodada já existente, pré-preenchido
  com o placar ao vivo atual).

**Polling:** só ativo enquanto a página "Ao Vivo" está aberta. A cada
~8-10s, chama `lerAoVivo` via POST e atualiza os cards. Pra não
sobrescrever uma edição do organizador ainda não salva, cada card mantém
uma flag local de "tenho mudança pendente" — enquanto ela estiver ativa,
o poll não sobrescreve os números daquele card específico (outros cards
continuam atualizando normalmente).

## Casos de borda

- Duas rodadas ao vivo ao mesmo tempo: aparecem uma embaixo da outra na
  mesma tela, cada uma com seu próprio estado de "pendente de salvar" e
  seu próprio log.
- Tentar capturar um rascunho que já foi capturado, ou que não é mais
  rascunho (excluído/lançado por outra pessoa nesse meio-tempo), retorna
  erro tratável sem quebrar a tela — mensagem clara, sem travar a UI.
- `LockService` protege contra duas gravações simultâneas em `AoVivo` /
  `AoVivoLog`.
- Ao lançar o placar final ou cancelar, as linhas de log daquela rodada
  são descartadas — não viram histórico permanente. Se no futuro quiser
  manter esse log após o encerramento, é uma extensão a discutir
  separadamente (fora do escopo desta spec).

## Testes

- Validação de sintaxe padrão (`node --check`) depois de qualquer
  mudança em `volei-dashboard.html` e `apps-script-codigo.gs`, Terça
  primeiro.
- Não há algoritmo não-trivial (sorteio, cálculo de emblema, etc.) aqui —
  é CRUD + polling + cálculo de delta simples — então não está previsto
  um script de simulação Node à parte. Se a lógica de "não sobrescrever
  edição pendente durante o polling" mostrar comportamento inesperado
  durante o desenvolvimento, vale escrever um teste isolado pra ela
  então.

## Fora de escopo (YAGNI)

- Placar ponto a ponto de um set (25x20 etc.) — o contador é de
  **vitórias da rodada**, mesmo conceito que já existe hoje.
- Tela separada de edição/exclusão de linhas específicas do log — o log
  é gerado automaticamente pelo delta de cada "Salvar parcial", sem UI
  de edição manual.
- Exigir login pra visualizar a transmissão — fica público, igual ao
  resto do app hoje.
- Persistir o log além do fim da transmissão.
