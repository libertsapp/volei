# Terça no Supabase — Etapa 5: Ao Vivo e contador de acessos (Design)

Continuação de `2026-09-24-terca-supabase-etapa-4b-credito-design.md`. A fonte da verdade continua sendo o `apps-script-codigo.gs`
(`iniciarTransmissaoAoVivo`, `salvarParcialAoVivo`, `cancelarTransmissaoAoVivo`, `lerAoVivo`, `readAoVivo`, `readAoVivoLog`,
`incrementarAcesso`, `readSettings`/`writeSettings`). Contexto do recurso: `2026-09-17-placar-ao-vivo-design.md`.

## Escopo

- Ações atrás do porteiro (a matriz `PERMISSOES` já as tinha: organizador e admin; jogador e anônimo são negados; chave mestra vale):
  `iniciarTransmissaoAoVivo(roundId, duracaoMinutos)`, `salvarParcialAoVivo(roundId, vitoriasPorTime)` e
  `cancelarTransmissaoAoVivo(roundId)`. As três rodam sob a trava `'gravacao'` (no `.gs` ficavam no `switch` que segura o
  `LockService`, com espera de 15 s), exatamente como as ações do financeiro.
- Leitura pública `lerAoVivo` (POST, sem login, **sem trava**) e o campo `aoVivo` do GET: o mesmo `{ rounds, log }` do `.gs`.
- `incrementarAcesso` (pública): soma 1 ao contador e devolve `{ contadorAcessos: N }`, como o `.gs`.
- Módulo puro `backend/aovivo.js` (sem `node:*`, `process`, `require`, `Buffer` nem supabase-js). Primitivas novas nos DOIS repositórios
  (`repo-memoria.js` e `repo-supabase.js`), com a mesma semântica e mensagens de erro que citam a tabela: `lerAoVivo`,
  `lerAoVivoDaRodada`, `inserirAoVivo`, `atualizarVitoriasAoVivo`, `inserirAoVivoLog`, `apagarAoVivo`, `incrementarAcesso`.
- `mapearAoVivo` deixou de falhar alto: reproduz `readAoVivo` + `readAoVivoLog` (ver "Formato").
- SQL do ajuste 6, ajuste do script de migração (`data` e `jogadores`) e testes (unidade, paridade com o `.gs`, integração).
- Fora de escopo: expiração no servidor (o `.gs` não tem), Realtime no lugar do polling.

## Comportamento do `.gs` que foi mantido (e por quê)

- **Não há expiração no servidor.** `duracaoMinutos` é só um dado guardado; quem calcula o tempo restante é o navegador
  (`segundosRestantesAoVivo`). Uma transmissão "vencida" continua sendo devolvida por `lerAoVivo` até alguém cancelar (o app cancela
  ao lançar o placar). O relógio injetado (`relogio()`) só serve para o carimbo `iniciadoEm` e o do log.
- **Sem limites de duração.** `Number(duracaoMinutos) || 0`: texto numérico vale, lixo vira 0, negativo e fracionário passam. Única
  diferença: infinito não cabe em JSON e vira 0.
- `iniciar`: erros na ordem do `.gs` (rodada inexistente, rodada que já foi lançada — "não é mais um rascunho" —, já está ao vivo).
  Cria uma linha por time com data da rodada, ids dos jogadores separados por vírgula, placar do momento, `iniciadoEm` (ISO com
  `.000Z`) e duração. Rodada sem times não grava nada e responde ok.
- `salvarParcial`: só os times cujo valor mudou **e** é número finito (`Number(vitoriasPorTime[timeIndex])`; `null` vira 0, texto
  não numérico é ignorado, índices de times que não existem são ignorados) geram uma linha no log com o `delta` e o carimbo. Sem
  `vitoriasPorTime` o `.gs` estoura um `TypeError` respondido como `{ error }`; o código novo faz o mesmo acesso e responde a mesma
  mensagem. Sem transmissão: "Essa transmissão não foi encontrada (pode já ter sido encerrada)."
- `cancelar`: apaga placar e log da rodada; sem transmissão também responde ok.
- Quem pode chamar o quê: ver o primeiro item do escopo (matriz idêntica à do `.gs`, conferida por perfil em `aovivo.test.mjs` e na paridade).

## Formato (`mapearAoVivo`)

Cada linha de `ao_vivo` é um time de uma rodada em transmissão. As linhas são lidas na ordem do `id` (identity = ordem de gravação
da planilha) e agrupadas por rodada num objeto simples, como o `.gs` (mesma ordem de `Object.values`, inclusive para ids só de
dígitos). `times[time_index]` recebe `{ nome, playerIds, vitorias }`; `iniciadoEm` sai normalizado (`iso`, `.000Z`) e `''` quando
vazio; `duracaoMinutos` é `Number(x) || 0`. O log só inclui rodadas que têm transmissão e é ordenado por carimbo decrescente com o
**mesmo comparador** do `.gs` (que nunca devolve 0): empates de carimbo (dois times mudando no mesmo `salvarParcial`) saem na mesma
ordem, e isso é conferido na paridade. As linhas gravadas pelo código novo e as migradas produzem o mesmo resultado (teste
"linhas migradas ... idênticas": timestamptz volta com `+00:00`, `jogadores` vazio vira `null`, duração 0 vira `null`).

## Contador de acessos (atômico no banco)

O `.gs` lia a aba `Config`, somava e regravava a aba inteira sob o `LockService` (10 s). Aqui a soma é uma função do Postgres, num
único comando (`insert ... on conflict do update`, com o bloqueio de linha do próprio banco), e **não usa a trava `'gravacao'`**: é
um endpoint público chamado a cada abertura do app e nunca deve esperar por uma gravação do financeiro.

- `incrementar_acesso() returns numeric`, `security invoker`, `set search_path = public`, execute revogado de
  `public/anon/authenticated` e concedido só à `service_role`.
- Regra do `.gs` (`Number(valor) || 0`): linha ausente, valor vazio ou que não é número contam como 0; número com espaços, decimal,
  negativo, notação científica e zeros à esquerda são somados (regex de número no lugar do cast, porque um `::numeric` de lixo
  estouraria). O retorno é `numeric` (e não `integer`) só para espelhar o `.gs` num valor fracionário guardado à mão; no uso normal é
  inteiro. `repo.incrementarAcesso()` devolve o número (Supabase: `rpc('incrementar_acesso')`; memória: emula a mesma regra).
- Resposta do handler: `{ contadorAcessos: N }`, idêntica ao `.gs`.
- **Se o SQL não foi rodado:** a função não existe; o erro cita `incrementar_acesso` e `sql/schema-terca-supabase-ajuste-6.sql` e o
  handler responde `{ error: ... }` (mesma forma dos outros erros), sem lançar. O front (`registrarAcesso`) já tolera: envolve tudo em
  `try/catch` e só atualiza o contador se `json.contadorAcessos` for número; a página carrega normalmente, só não conta o acesso.
- `saveSettings` **deixou de gravar a linha `contadorAcessos`** (antes regravava o valor lido, para não sobrescrevê-lo com o do navegador do admin). O contador agora pertence só a `incrementar_acesso`: reler-e-regravar aqui, sob a trava `gravacao`, disputaria com a soma atômica que não usa trava e poderia perder acessos. O GET não muda (linha ausente = 0; linha existente fica como está). Coberto em `jogadores-config.test.mjs` e nas paridades.

## Chave estrangeira `ao_vivo.round_id -> rodadas` (decisão principal)

Problema (levantado na revisão da 4a): `gravar_rodada` apaga e regrava a rodada, e `remover_rodada` a apaga; com uma linha de
`ao_vivo` apontando para ela a chave estrangeira faria essas duas funções falharem. O `.gs` não tem essa amarra (as abas são
independentes) e o app usa exatamente esses caminhos durante uma transmissão:

1. **Editar a rodada (mesmo rascunho) ao vivo.** O `.gs` mantém o espelho do Ao Vivo intacto (é uma cópia tirada no início).
2. **"Lançar placar".** O app faz `updateRound` (rascunho falso) e **depois** `cancelarTransmissaoAoVivo` (front, "EDITING_ROUND_FROM_AOVIVO"):
   no meio, a rodada é regravada com a transmissão ainda de pé.
3. **Excluir o rascunho** que está ao vivo. O `.gs` deixa uma linha órfã em `AoVivo`, que continua aparecendo em `lerAoVivo`.

Decisão, sem enfraquecer a integridade (a chave continua existindo e continua impedindo uma transmissão de rodada inexistente):

- A chave passa a ser `deferrable initially deferred` (ajuste 6, item 4). Ela é conferida no fim da transação: como `gravar_rodada` apaga e
  reinsere a mesma rodada na mesma transação, os casos 1 e 2 funcionam **sem tocar em `ao_vivo`**, com o comportamento idêntico ao do
  `.gs` (o espelho fica intacto até o app cancelar). Nenhuma mudança em `rodadas.js`: nada é apagado ou "limpo" por trás do app.
- `remover_rodada` (ajuste 6, item 5) apaga antes o `ao_vivo` e o `ao_vivo_log` da rodada, na mesma transação. Uma transmissão de
  rodada que não existe mais não tem sentido e a chave não deixaria a rodada sair. `updateRound` sem times (que no `.gs` também
  apaga a rodada) usa o mesmo caminho. O `repo-memoria` emula as duas coisas (a regravação preserva `ao_vivo`; `removerRodada` o apaga).
- **Diferença aceita:** remover (ou esvaziar) uma rodada que está ao vivo encerra a transmissão dela; no `.gs` sobrava uma linha
  órfã. É comportamento de erro e o app nunca depende dele. Fica fora da comparação diferencial (documentado no teste) e coberto em
  `aovivo.test.mjs` e na integração.
- Alternativa descartada: apagar o Ao Vivo dentro de `gravar_rodada`/`updateRound`. Encerraria a transmissão no meio do jogo só
  porque alguém corrigiu um nome no rascunho, o que muda o comportamento do `.gs`.

## SQL a rodar (`sql/schema-terca-supabase-ajuste-6.sql`, idempotente, rodado pelo usuário)

1. `ao_vivo.data date` e `ao_vivo.jogadores text` (a aba `AoVivo` sempre teve as duas; o schema original esqueceu).
2. `vitorias`, `duracao_minutos` e `delta` de `int` para `numeric`: o `.gs` aceita qualquer número (`2.5` inclusive) e um `int`
   rejeitaria; os inteiros de hoje saem iguais.
3. Índices por `round_id` em `ao_vivo` e `ao_vivo_log`.
4. Chave estrangeira de `ao_vivo` adiada (acima).
5. `remover_rodada` substituída (acima).
6. `incrementar_acesso()` e as permissões dela.

Sem o arquivo: `iniciarTransmissaoAoVivo` falha (o erro cita a tabela e o arquivo), `incrementarAcesso` responde erro citando
`incrementar_acesso` (o app tolera) e a leitura do Ao Vivo continua funcionando. O script de migração (`scripts/migrar-terca-supabase.js`)
passou a gravar `data` e `jogadores` em `ao_vivo`; rodar o ajuste 6 **antes** de migrar o Ao Vivo (a tabela costuma estar vazia).

## Conferência depois de rodar o SQL

O `raise notice` do item 4 diz se a chave foi ajustada (ou que não achou nenhuma). Depois de rodar o arquivo:

```sql
select round_id, data, jogadores from ao_vivo;
```

Normalmente não volta nenhuma linha (o Ao Vivo é efêmero). Se voltar linhas de uma transmissão antiga com `data` ou `jogadores` nulos (gravadas antes das colunas existirem), cancele-as (o app: Cancelar transmissão; ou `delete from ao_vivo where round_id = '...'` e o mesmo em `ao_vivo_log`) ou preencha as colunas à mão com a data da rodada e os ids dos jogadores de cada time, separados por vírgula. O `gravar_rodada` e o `remover_rodada` agora também têm o execute revogado de `public/anon/authenticated` (só `service_role`, que é o cliente que o `repo-supabase` usa).

## Diferenças aceitas (além da remoção acima)

- `incrementarAcesso` toca só a linha do contador; o `.gs` reescrevia a aba `Config` inteira (normalizando as outras chaves). O
  `readSettings` normaliza do mesmo jeito na leitura, então o GET é igual.
- Valores exóticos que o `Number()` do JS aceita e a regex do SQL não (`0x10`, `Infinity`) contam como 0 no banco. Não ocorrem.
- `lerAoVivo` lê só as duas tabelas do Ao Vivo (não o banco todo), porque é chamada em polling.
- `salvarParcial` grava o log antes de atualizar os placares e cada gravação é um comando separado (sob a trava): se uma falhar no
  meio, o placar não fica alterado sem rastro (o contrário poderia perder o registro em silêncio).

## Testes

- `tests/backend/aovivo.test.mjs`: cada ação e casos de borda (rodada inexistente, já lançada, já ao vivo, durações, transmissão vencida
  ainda lida, placar parcial com times inexistentes, valores não numéricos, sem `vitoriasPorTime`, cancelar sem transmissão), matriz de
  permissões por perfil, trava (as três usam `gravacao`; leitura e contador nunca a tocam; ocupada responde "ocupado"), contador
  (linha ausente, lixo, espaços, decimal, negativo, científica, zeros à esquerda; função ausente cita o arquivo), FK (editar ao vivo,
  "Lançar placar", remover ao vivo, `updateRound` sem times) e linhas migradas x novas.
- `tests/backend/paridade-aovivo.test.mjs`: roda o `.gs` REAL na planilha falsa e o backend novo (82 passos em 3 cenários), comparando
  resposta e GET completo (`aoVivo` e `settings.contadorAcessos` incluídos) depois de cada passo; inclui `lerAoVivo` e
  `incrementarAcesso` públicos, permissões, edição durante a transmissão, empate de carimbo no log, durações estranhas, o contador com
  valores exóticos na aba e transmissão preexistente ("migrada", com log de rodada órfã). `dbParaAbas.mjs` passou a gerar as abas
  `AoVivo`/`AoVivoLog` quando o cenário tem linhas.
- `tests/backend/integracao-etapa5.mjs`: Supabase real (NÃO é rodado pelo suíte; pressupõe o ajuste 6): 3 `incrementarAcesso`
  simultâneos somam exatamente 3, linha ausente/lixo, restauração exata do contador, ciclo completo do Ao Vivo com rodada de 2099,
  chave estrangeira real, editar/"lançar"/remover ao vivo e limpeza de todas as linhas criadas.
- Mutações verificadas (cada uma derruba a paridade e/ou a unidade): delta do log invertido, sem checagem de rascunho, duração
  padrão diferente, ordem do log invertida, `salvarParcial` sem trava, lixo do contador sem virar 0, cancelar sem apagar o log,
  aceitar valor não numérico, `incrementarAcesso` sob trava.
