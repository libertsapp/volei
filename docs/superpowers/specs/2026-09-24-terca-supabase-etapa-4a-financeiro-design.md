# Terça no Supabase — Etapa 4a: financeiro, parte 1 (Design)

Continuação de `2026-09-24-terca-supabase-etapa-3b-checkin-design.md`. A etapa 4 (financeiro) foi dividida em
**4a (este documento: tudo o que não é "dia sem jogo"/crédito como ação própria)** e 4b (dia sem jogo, crédito e os
ganchos do check-in). Especificação original do recurso: `2026-09-19-controle-financeiro-design.md` e
`2026-09-19-dia-sem-jogo-credito-design.md` (só como contexto: a fonte da verdade é o `apps-script-codigo.gs`).

## Objetivo

As ações do financeiro abaixo respondem no Supabase exatamente como o Apps Script (`finSalvarDia_` e companhia): mesmas
mensagens, mesmo arredondamento em centavos, mesmo texto no `fin_log`, mesmo `financeiro` devolvido em `finOk_`.

## Escopo

- Ações (atrás do porteiro; a matriz já tinha as sete, idêntica à `PERMISSOES_FIN_`, conferida pelo `permissoes.test.mjs`):
  `salvarFinDia`, `marcarPagamento`, `estornarPagamento`, `marcarTodosPagamentos`, `estornarTodosPagamentos`,
  `addLancamento` e `estornarLancamento` (só admin). Toda resposta boa é `{ status: 'ok', financeiro }`; as duas ações "em massa"
  acrescentam `estornados`/`ignorados` (estornarTodos), como no `.gs`.
- Leitura: `GET financeiro` já funcionava (`mapearFinanceiro`). Comparado linha a linha com `lerFinanceiro_`: **sem divergência**
  (nada foi alterado no mapeador).
- **Fora de escopo (4b):** `marcarDiaSemJogo`, `reabrirDia`, `aplicarCreditosDoDia`, `devolverCredito` (continuam respondendo
  "ainda não disponível", depois do porteiro) e os ganchos `finAposAdicionarCheckin_` / `finAposRemoverCheckin_` do check-in.

## Decisões

- **Módulo puro `backend/financeiro.js`**, sem lock: recebe `{ repo, relogio, gerarId }` (o handler passa `gerarId`, padrão
  `crypto.randomUUID()`). `relogio()` no lugar de `finAgora_()`; `gerarId()` no lugar de `Utilities.getUuid()`.
- **Estado de crédito alcançável pela 4a foi portado por inteiro**, porque o `.gs` o trata dentro das mesmas ações e a 4b vai
  produzir esse estado: `salvarFinDia` aplica créditos (`finAplicarCreditos_`, exportada como `aplicarCreditos` para a 4b reutilizar
  nos ganchos e em `aplicarCreditosDoDia`); `estornarPagamento` devolve o crédito nascido do pagamento (e recusa se já foi usado);
  pagamento tipo `credito` não tem a trava "fora da lista"; `marcarPagamento`/`marcarTodos`/`estornarTodos` recusam dia `semjogo`.
- **`fin_log.detalhe` é gravado como `{ texto: "<JSON do .gs>" }`.** O `jsonb` do Postgres reordena as chaves dos objetos; guardando o
  texto pronto, o log lido de volta é idêntico byte a byte ao do `.gs` (o mapeador já devolve `texto` como está, convenção da migração
  para texto solto). Linhas migradas continuam como objeto e são lidas como antes. O e-mail vai na coluna `email`, nunca no GET.
- **Primitivas novas do repositório (memória e Supabase, mesma semântica, erros começando pelo nome da tabela):**
  `gravarFinDia` (upsert pela data; status e `ordem` nunca são enviados), `inserirFinPagamento -> boolean`, `estornarFinPagamento ->
  boolean`, `encerrarFinCredito -> boolean`, `inserirFinLancamento`, `estornarFinLancamento -> boolean`, `inserirFinLog`. A leitura reusa
  `lerTudo`. `ordem` e o `id` do `fin_log` vêm dos padrões do banco (o repositório em memória os emula).
- **Estornos são UPDATE condicional (`estornado = false`)**: dois pedidos simultâneos deixam um só vencedor (o segundo vira "já
  estornado", sem log nem mexer no crédito). Em `estornarPagamento` o pagamento é estornado antes de o crédito ser devolvido.
- **Concorrência de `marcarPagamento` / `marcarTodos`** (o `.gs` usava `LockService`): ver "SQL" abaixo.

## SQL: precisa, e o usuário roda

`sql/schema-terca-supabase-ajuste-4.sql` cria, de forma idempotente, o índice único parcial `fin_pagamentos_valido_uniq` em
`fin_pagamentos (data, jogador_id) where not estornado`. O `.gs` decide "já pago" exatamente assim (mesmo dia + mesmo jogador +
não estornado); o índice só torna isso à prova de toque duplo. O backend trata a violação como "já pago" (resposta igual à do `.gs`,
sem log duplicado). O arquivo confere antes se já há duplicado nos dados migrados e aborta com a consulta para achá-los.
**O usuário precisa rodar o arquivo no SQL Editor do Supabase**; sem ele o código funciona igual, só sem a trava contra corrida.

## Diferenças aceitas em relação ao `.gs`

1. **Data com formato certo mas impossível** (`2026-13-45`): o `.gs` aceitava como texto; aqui responde `Data inválida.` (a coluna é `date`).
2. **Valor acima de 99.999.999,99**: resposta `Valor alto demais (máximo 99.999.999,99).` (as colunas são `numeric(10,2)`; a planilha não tinha teto).
3. **Mesmo jogador com dois check-ins no mesmo dia**: o "Confirmar todos" do `.gs` gerava dois pagamentos; com o índice do ajuste 4 gera um.
4. **Sem transação entre passos** (ex.: estornar pagamento e depois devolver o crédito): uma falha no meio deixa o estado parcial; o `.gs`
   também não era transacional, mas tinha o lock. O risco é o mesmo de qualquer erro de rede no meio de uma sequência.
5. Ids são UUID v4 do `crypto.randomUUID()` (o `.gs` usava `Utilities.getUuid()`, também v4).

## Testes

- `tests/backend/financeiro.test.mjs` (unidade), `repo-financeiro.test.mjs` (primitivas de memória e do Supabase com cliente falso),
  `handler-etapa4a.test.mjs` (perfis, formato da resposta, 4b indisponível).
- `tests/backend/paridade-financeiro.test.mjs`: 84 passos contra o `.gs` real na planilha falsa, comparando resposta e o GET **inteiro
  (com `financeiro`)** depois de cada passo, sem normalização nenhuma: relógio comum controlado (o `Date` do contexto do `.gs` é
  substituído) e ids da mesma sequência `uuid-N`. Semeia check-ins, créditos e pagamentos por crédito no estado inicial e muda a
  lista de check-in / vagas "por fora" (passos AMBIENTE), porque os ganchos do check-in só chegam na 4b. Um segundo cenário parte
  de uma planilha sem as abas do financeiro (o `.gs` as cria na primeira gravação). Cobre negados por perfil, todas as validações,
  crédito aplicado/devolvido/usado, trava de "fora da lista", dia sem jogo, vagas e lista de espera.
- `tests/backend/integracao-etapa4a.mjs` (Supabase real; **não roda sozinho**): data de 2099 e jogador temporário; limpa todas as
  linhas `fin_*` e os dados de teste e imprime as contagens antes e depois.
- `paridade-checkins.test.mjs` continua excluindo `financeiro` da comparação (os ganchos chegam na 4b).
