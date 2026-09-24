# Terça no Supabase — Etapa 4b: financeiro, parte 2 (dia sem jogo, crédito, ganchos do check-in e trava de gravação) (Design)

Continuação de `2026-09-24-terca-supabase-etapa-4a-financeiro-design.md`. A 4a portou as ações "comuns" do financeiro; a 4b fecha o
financeiro: dia sem jogo, crédito de jogadores e os ganchos que o check-in dispara. Contexto do recurso:
`2026-09-19-dia-sem-jogo-credito-design.md`. A fonte da verdade continua sendo o `apps-script-codigo.gs` (`finMarcarDiaSemJogo_`,
`finReabrirDia_`, `finAplicarCreditosAcao_`, `finDevolverCredito_`, `finAplicarCreditos_`, `finAplicarCreditosFuturos_`,
`finAposAdicionarCheckin_`, `finAposRemoverCheckin_`).

## Escopo

- Ações (atrás do porteiro; a matriz já tinha as quatro): `marcarDiaSemJogo` (organizador/admin), `reabrirDia` (organizador/admin),
  `aplicarCreditosDoDia` (organizador/admin) e `devolverCredito` (só admin). Mesmas mensagens de erro, mesmas validações, mesmo texto
  de log e mesmo formato `finOk_` (`{ status, financeiro }` mais `creditos/estornados/ignorados` em `marcarDiaSemJogo` e `aplicados`
  em `aplicarCreditosDoDia`).
- Ganchos do check-in: depois de um `addCheckin` que deu certo roda `aplicarCreditos(data)` (quem tem crédito já aparece pago); depois
  de um `removeCheckin` que deu certo roda `aposRemoverCheckin` (devolve o crédito que quem saiu tinha usado no dia e reaplica os
  créditos, porque a lista de espera pode ter subido para dentro das vagas, inclusive além de `checkinVagas` se as vagas mudaram).
  Os ganchos **engolem qualquer erro** (o `try/catch` do `.gs`): nunca quebram o check-in. `deps.avisar(msg)`, se existir, recebe a
  mensagem engolida (no lugar do `Logger.log`).
- `removeCheckin` lê a data e o jogador do check-in **antes** de apagar (o gancho precisa deles), com `lerTudo`.
- A trava de gravação (abaixo) e o SQL do ajuste 5.
- Fora de escopo: gravações de jogadores, rodadas, configurações e fotos continuam sem trava (ver "Trava de gravação").

## Trava de gravação (a decisão principal)

O `.gs` serializava toda gravação com `LockService.getScriptLock().waitLock(15000)`. O backend novo é HTTP sem estado (Node agora,
Edge Function depois), então não há processo único para segurar um mutex em memória. Alternativas consideradas:

1. **Uma função do Postgres (RPC) para cada operação de crédito** (a proposta original da 4a): correta, mas obriga a reescrever em
   PL/pgSQL a lógica que já está portada e testada por paridade em JS, e duplica regras (vagas, ordem, log verbatim). Rejeitada.
2. **Índice único / UPDATE condicional em tudo**: já é o que a 4a faz para pagamento duplicado e estorno duplicado, mas não cobre a
   corrida de crédito: duas `aplicarCreditos` em dias diferentes calculam o saldo do mesmo crédito antes de qualquer uma gravar e
   ambas pagam. Não há chave única que expresse "saldo não pode ficar negativo". Insuficiente sozinha.
3. **Trava com aluguel (lease) no Postgres (escolhida)**: reproduz exatamente o `LockService`: uma linha por nome de trava, com dono e
   expiração; quem não consegue tenta de novo por até 15 s. Toda a lógica continua em JS e a corrida deixa de existir por construção.

Peças:

- **SQL** `sql/schema-terca-supabase-ajuste-5.sql` (idempotente): tabela `travas(nome text primary key, dono text not null,
  expira_em timestamptz not null)` com RLS ligado e sem políticas (como as outras); função `pegar_trava(p_nome, p_dono, p_ttl_seg)
  returns boolean` com **um único** `insert ... on conflict (nome) do update ... where travas.expira_em < now() or travas.dono =
  excluded.dono returning true` (atômico: dois pedidos simultâneos nunca levam a trava juntos; o mesmo dono renova; aluguel vencido
  pode ser tomado); função `soltar_trava(p_nome, p_dono)` que só apaga se o dono confere; `revoke execute ... from public, anon,
  authenticated` e `grant execute ... to service_role` nas duas.
- **`backend/trava.js`** (puro): `comTrava(deps, nome, fn)`. Dono = `deps.gerarDono` (senão `deps.gerarId`, senão UUID), aluguel de
  30 s, tenta a cada 150 ms por até 15 s (a espera é contada pela soma dos ms passados a `deps.esperar`, injetável para os testes).
  Estourou: `{ error: 'O sistema está ocupado gravando outra alteração. Tente de novo em instantes.' }` e a ação não roda. Sempre
  solta em `finally`; falha ao soltar é engolida (o aluguel expira sozinho). Erro do próprio `pegarTrava` sobe: se o SQL do ajuste 5
  não foi rodado, a mensagem cita `pegar_trava` (e o arquivo a rodar) e **nada é gravado sem trava**.
- **Repositórios**: `pegarTrava(nome, dono, ttlSeg) -> boolean` e `soltarTrava(nome, dono)` nos dois (memória: um `Map` com o relógio
  injetável `criarRepoMemoria(dados, { agora })`, mesma regra do SQL; Supabase: `rpc('pegar_trava')` / `rpc('soltar_trava')`).
- **Handler**: uma trava só, `'gravacao'`, em volta de **todas as ações de gravação do financeiro** (as 7 da 4a e as 4 da 4b), de
  `addCheckin` e de `removeCheckin` **incluindo os ganchos**. Assim a aplicação de crédito dentro de um check-in nunca se mistura com
  um estorno ou um `marcarDiaSemJogo`. O porteiro (perfil) roda **antes** e fora da trava: quem não tem permissão nem disputa a trava.
- **Não** envolvidas hoje: `addPlayer`, `updatePlayer`, `removePlayer`, rodadas, `saveSettings`, `salvarEstrelasAjustadas`, fotos e
  usuários. Cada uma é **uma linha** no `handler.js`: trocar `return await acao(...)` por `return await travar(() => acao(...))`.
  (No `.gs` todas eram travadas, mas nenhuma lê-e-decide sobre dados que outra ação altera no mesmo instante como o crédito faz.)
- `criarHandler` aceita `gerarDono` (padrão: UUID) e `esperar` (padrão: `setTimeout`). O dono da trava **não** usa `gerarId`, para
  não gastar ids da sequência `uuid-N` que o teste de paridade compartilha com o `.gs`.

## Diferenças e detalhes em relação ao `.gs`

1. Data com formato certo mas impossível (`2026-13-45`) responde `Data inválida.` também nas ações novas (a coluna é `date`; diferença 1
   da 4a).
2. `aplicarCreditos` mantém o guarda da 4a (I3): crédito com `jogadorId` vazio e check-in sem jogador nunca se casam.
3. Ao criar crédito de um pagamento sem jogador (`jogador_id` nulo), a linha nasce com `jogador_id = null` (chave estrangeira); o
   GET devolve `''`, igual ao `.gs`.
4. **Sem transação entre passos** (mesma ressalva da 4a): `marcarDiaSemJogo` muda o status do dia, estorna/cria créditos e só então
   loga; uma falha no meio deixa o dia `semjogo` com parte dos créditos criados. O `.gs` tinha o mesmo comportamento numa planilha.
   A trava garante que ninguém vê nem mexe no meio do caminho, mas não desfaz.
5. Aluguel de 30 s: uma ação que demore mais que isso perderia a exclusão (outra poderia entrar). As ações do financeiro leem o banco
   inteiro poucas vezes e ficam na casa de centenas de ms; se isso mudar, o `TTL_SEG` fica em `trava.js`.
6. Uma ação que estoura os 15 s de espera responde o erro de "sistema ocupado" e não grava nada (o app pode tentar de novo).

## SQL: precisa, e o usuário roda

`sql/schema-terca-supabase-ajuste-5.sql` no SQL Editor do Supabase (idempotente, pode rodar mais de uma vez). **Sem ele, `addCheckin`,
`removeCheckin` e todas as ações do financeiro respondem com erro citando `pegar_trava`** (de propósito: melhor recusar do que gravar
sem trava). Rode antes de publicar/subir esta etapa. Depois de rodar, `node tests/backend/integracao-etapa4b.mjs` confere a trava real.

## Testes

- `tests/backend/financeiro-4b.test.mjs` (unidade): as quatro ações e os ganchos, com os casos de borda (crédito parcial, vários
  créditos do mesmo jogador, o mais antigo primeiro, dia já sem jogo, reabrir com crédito usado, `devolverCredito` de crédito usado
  ou fechado, variantes de destino, check-in de quem tem crédito, promoção da espera além de `checkinVagas`, erro nos ganchos engolido).
- `tests/backend/trava.test.mjs`: `comTrava` (ocupada com `esperar` falso, solta em erro, erro do SQL ausente, serialização de duas
  ações), primitivas de memória (expiração, renovação, dono) e do Supabase (cliente falso com `rpc`), trava no handler, e a corrida
  do crédito: um teste de CONTROLE mostra que, sem trava, duas `salvarFinDia` em dias diferentes gastam o mesmo crédito duas vezes;
  outro mostra que, com a trava, sobra um só pagamento por crédito.
- `tests/backend/handler-etapa4b.test.mjs` (perfis e formato das respostas), `repo-financeiro.test.mjs` (novas primitivas).
- `tests/backend/paridade-financeiro-credito.test.mjs`: 87 passos contra o `.gs` real na planilha falsa, comparando resposta e o GET
  **inteiro** depois de cada passo, sem normalização (relógio e ids `uuid-N` controlados). Os ganchos são acionados pelos `addCheckin` e
  `removeCheckin` de verdade (com token). Um segundo cenário parte de uma planilha sem as abas do financeiro.
- `tests/backend/paridade-checkins.test.mjs` deixou de excluir o `financeiro` da comparação (agora os ganchos existem dos dois lados) e
  passou a controlar o relógio e os ids como os outros testes de paridade.
- `tests/backend/integracao-etapa4b.mjs` (Supabase real; **não roda sozinho**, pressupõe o ajuste 5 aplicado): datas de 2099, jogador
  temporário, trava real (dois donos, aluguel vencido, soltar só pelo dono), ações e ganchos; limpa tudo e imprime as contagens antes e depois.
