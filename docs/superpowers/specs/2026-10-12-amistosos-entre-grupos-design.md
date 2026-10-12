# Amistosos entre grupos — design

Data: 2026-10-12 · Status: aguardando revisão do usuário

## Objetivo

Permitir que grupos de vôlei que usam o app (hoje Vôlei de Terça e Vôlei Meme Brasil; amanhã outros) se convidem
para amistosos, combinem data/local, montem a convocação de cada lado e registrem o placar, ficando um histórico
de confrontos. A "troca de informação" acontece dentro do convite (recados), não num chat livre.

**Sucesso:** um organizador do Terça convida o Meme pelo app; um organizador do Meme vê o aviso na tela inicial,
aceita (ou contrapropõe); os jogadores dos dois grupos marcam "Vou jogar"; cada organizador confirma seus escalados;
depois do jogo um lado lança o placar, o outro confirma, e o confronto aparece no histórico dos dois apps.

### Fora do escopo desta versão

- Chat/mural livre entre grupos
- Competições/torneios com 3+ grupos (o modelo `liga` é a base para isso depois)
- Amistoso contando em ranking, emblemas ou estatísticas do jogador
- Push direcionado só para organizadores (as inscrições push de hoje não são ligadas a login)
- Cadastro de grupo novo pela interface (grupo novo = linha inserida via SQL)

## Arquitetura

Schema novo **`liga`** no mesmo projeto Supabase, ao lado de `public` (Terça) e `meme`. As Edge Functions existentes
(`terca-api-teste`, `meme-api`) ganham um **segundo cliente Supabase** apontando para `liga` e uma configuração
`grupoId` (`'terca'` / `'meme'`). Todo o código novo vive em `backend/amistosos.js` (+ métodos no repo), copiado
para as funções pelo `npm run preparar-edge` como o resto.

Regra central: **cada função só altera o lado do próprio grupo.** O backend do Terça nunca aceita convite endereçado
ao Meme, nunca escala jogador do Meme etc. Login, sessão e `PERMISSOES` continuam os de cada grupo — não existe
identidade nova.

Pré-requisito operacional: incluir `liga` em "Exposed schemas" (API settings do Supabase), como foi feito com `meme`.

## Modelo de dados (`sql/liga/schema-liga.sql`)

**`liga.grupos`** — diretório
| coluna | tipo | nota |
|---|---|---|
| id | text PK | `'terca'`, `'meme'` |
| nome | text | "Vôlei de Terça" |
| logo_url | text | opcional |
| cor | text | hex, para pintar o adversário |
| ativo | boolean | default true |

**`liga.amistosos`**
| coluna | tipo | nota |
|---|---|---|
| id | uuid PK | |
| grupo_convidante | text FK grupos | |
| grupo_convidado | text FK grupos | ≠ convidante (check) |
| data | date | |
| horario | text | "20:00", mesmo formato do ajuste 12 |
| local | text | livre, até 200 chars |
| vagas_por_grupo | int | default 6, entre 1 e 30 |
| status | text | `pendente`, `marcado`, `aguardando_confirmacao`, `encerrado`, `recusado`, `cancelado` |
| vez_de | text FK grupos | quem precisa responder quando `pendente` |
| sets_convidante, sets_convidado | int | placar |
| parciais | jsonb | opcional: `[[25,21],[22,25],…]` (convidante, convidado) |
| placar_lancado_por_grupo | text | |
| placar_lancado_em | timestamptz | |
| motivo_cancelamento | text | obrigatório ao cancelar depois de marcado |
| criado_por | text | email |
| criado_em, atualizado_em | timestamptz | |

**`liga.amistoso_mensagens`** — histórico do convite
| id uuid | amistoso_id | grupo | autor_nome | tipo (`convite`, `contraproposta`, `aceite`, `recusa`, `cancelamento`, `placar`, `confirmacao`, `contestacao`, `recado`) | texto (≤500) | criado_em |

**`liga.escalacoes`**
| coluna | tipo | nota |
|---|---|---|
| id | uuid PK | |
| amistoso_id | uuid FK | |
| grupo | text | |
| jogador_id | text | id do jogador **no schema do grupo** |
| nome, foto_url | text | copiados na entrada, para o adversário exibir sem ler o schema do outro |
| status | text | `interessado` / `confirmado` |
| criado_em | timestamptz | ordem de chegada |
| unique (amistoso_id, grupo, jogador_id) | | |

**`liga.travas_escalacao`** — trava da lista de cada grupo: (`amistoso_id`, `grupo`, PK composta); a linha existir = lista travada.

## Fluxo do convite

```
pendente ──aceitar──▶ marcado ──lançar placar──▶ aguardando_confirmacao ──confirmar / 7 dias──▶ encerrado
   │  └──contrapropor──▶ pendente (vez_de passa para o outro grupo)          └──contestar──▶ marcado
   ├──recusar──▶ recusado
   └──cancelar (qualquer lado, enquanto pendente ou marcado) ──▶ cancelado
```

- **Contraproposta:** só quem tem a vez; muda data/horário/local/vagas e passa `vez_de`. Sem limite de idas e voltas.
- **Aceitar/recusar/contrapropor:** só o grupo em `vez_de`. O convidante não aceita o próprio convite.
- **Cancelar:** qualquer um dos dois grupos; se já estava `marcado`, `motivo` obrigatório.
- **Lançar placar:** qualquer lado, status `marcado`, a partir da data/horário do jogo. Sets inteiros ≥ 0, não ambos zero.
- **Confirmar/contestar placar:** só o grupo que **não** lançou. Contestar exige texto e volta a `marcado` (placar limpo).
- **Confirmação automática:** `aguardando_confirmacao` com `placar_lancado_em` há mais de 7 dias é **tratado como
  `encerrado` na leitura** (mapeamento) e a primeira escrita que tocar no amistoso persiste a mudança. Nenhum agendamento.
- Toda transição grava uma linha em `amistoso_mensagens` (com o recado opcional, ≤500 chars).
- Concorrência: transições checam o status esperado no `update … where status = X` (falha = "o convite mudou, recarregue").

## Convocação

- Disponível com status `marcado` e enquanto a lista do grupo não está travada.
- **"Vou jogar" segue a regra do `addCheckin`**: precisa estar logado (qualquer perfil, inclusive `jogador`) e escolhe
  qualquer jogador da lista do próprio grupo (não removido), como no check-in de hoje.
  O backend valida que `jogador_id` existe no schema do grupo e copia nome/foto. "Desmarcar" idem.
- Organizador/admin: **confirmar/desconfirmar** escalado (no máximo `vagas_por_grupo` confirmados), **travar/destravar** a lista.
- Visibilidade: o próprio grupo vê interessados + confirmados; o adversário vê **só os confirmados**; se não houver
  nenhum, vê "Escalação ainda não confirmada (N interessados)". Nada é confirmado automaticamente.
- Totalmente separada da rodada: não toca em `checkins`.

## API (novas ações no handler)

Leitura: a leitura inicial (GET) ganha um bloco `liga` com `grupos`, os amistosos em que o grupo participa
(pendentes/marcados todos + últimos 50 encerrados/recusados/cancelados), mensagens desses amistosos e as escalações
já filtradas pela regra de visibilidade. Se o schema `liga` não existir ainda, o bloco vem vazio e o resto do app segue normal.

| ação | quem | |
|---|---|---|
| `convidarGrupo` | organizador, admin | grupo destino, data, horário, local, vagas, recado |
| `responderConvite` | organizador, admin | `aceitar` / `recusar` / `contrapropor` (+ campos novos) + recado |
| `cancelarAmistoso` | organizador, admin | motivo |
| `entrarAmistoso` / `sairAmistoso` | qualquer logado (como check-in) | amistoso, jogadorId |
| `confirmarEscalado` / `desconfirmarEscalado` | organizador, admin | |
| `travarEscalacao` / `destravarEscalacao` | organizador, admin | |
| `lancarPlacar` | organizador, admin | sets + parciais opcionais |
| `confirmarPlacar` / `contestarPlacar` | organizador, admin | contestar exige texto |
| `recadoAmistoso` | organizador, admin | recado avulso no histórico |

As ações entram em `PERMISSOES` (backend) e `PERMISSOES_UI` (front). As escritas passam pela trava de gravação existente.

## Avisos

- **Cartão na tela inicial** (organizador/admin logados): aparece quando há convite/contraproposta com `vez_de` = meu
  grupo ou placar do adversário esperando confirmação. Texto: "🏐 Vôlei Meme Brasil convidou vocês para um amistoso
  em 20/10 — Responder"; com mais de um: "2 amistosos esperando resposta". O botão abre o item na aba Amistosos.
- **Contador** na aba Amistosos (●N) com o mesmo critério.
- **Cartão para todos** quando há amistoso `marcado` futuro: "Amistoso marcado: Terça × Meme, 20/10 — Vou jogar".
- **Push** (se VAPID configurado): só quando o amistoso vira `marcado`, e cada função envia **apenas aos inscritos do
  próprio grupo** (não lê o schema do outro). Na prática, o grupo que aceita recebe o push automático ("Amistoso
  marcado contra X, 20/10 — marque Vou jogar"); o grupo convidante vê o cartão na tela inicial, e o organizador dele
  pode disparar o aviso pelo "Enviar notificação" que já existe. (Melhoria futura: inscrições push compartilhadas.)

## Telas (Terça primeiro)

- **Aba "Amistosos"**: botão "+ Convidar grupo" (organizador/admin) → modal com grupo (lista de `grupos` ativos menos
  o próprio), data, horário, local, vagas, recado. Seções: *Esperando resposta* (com Aceitar/Contrapropor/Recusar),
  *Marcados* (cartão com convocação dos dois lados, Lançar placar), *Histórico* (retrospecto por adversário
  "3 jogos — 2V 1D" + lista com placar e confirmados).
- Cada cartão mostra o histórico de mensagens do convite, recolhível.
- Adversário pintado com `cor`/`logo_url` de `grupos`.
- Lembrar: blocos dentro da aba usam `<div>`, nunca `<section>`; modal/tooltip respeitam z-index > 300.

## Erros

- Schema `liga` ausente → leitura com bloco vazio, ações respondem "rode sql/liga/schema-liga.sql no SQL Editor"
  (mesmo padrão das dicas de ajuste existentes).
- Transição inválida (status mudou, vez errada, grupo errado) → mensagem clara, sem 500.
- Vagas cheias ao confirmar → "Já tem N confirmados (limite N)".
- Jogador inexistente/removido no `entrarAmistoso` → recusado.

## Testes

Padrão de `tests/` com `repo-memoria`:
- todas as transições válidas e as proibidas (aceitar o próprio convite, responder fora da vez, grupo errado confirmar
  placar, lançar placar antes do jogo, contestar sem texto, cancelar marcado sem motivo)
- isolamento: função do Terça não altera escalação do Meme nem convite em que o Terça não participa
- permissões (jogador não convida; entrar/sair livre)
- limite de vagas, trava da lista
- visibilidade (adversário só vê confirmados)
- confirmação automática após 7 dias (relógio injetado)
- leitura com schema `liga` ausente não quebra o app
- testes de front puros para o cálculo dos avisos e do retrospecto

## Rollout

1. `sql/liga/schema-liga.sql` (cria schema, tabelas, insere `terca` e `meme` em `grupos`) — usuário roda no SQL Editor
   e adiciona `liga` aos Exposed schemas.
2. Backend + função `terca-api-teste` + `volei-dashboard.html` → validar, testar, subir versão no rodapé (mudança grande:
   **v17.0**). **Parar e esperar autorização.**
3. Depois de autorizado: `meme-api` (config `grupoId: 'meme'`) + HTML do Meme.

Entre os passos 2 e 3, o Terça consegue convidar o Meme, mas o convite fica parado até o Meme ser atualizado — esperado.
