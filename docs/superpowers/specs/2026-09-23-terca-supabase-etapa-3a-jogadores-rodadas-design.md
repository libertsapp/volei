# Terça no Supabase — Etapa 3a: jogadores, rodadas e configurações (Design)

Continuação de `2026-09-23-terca-supabase-backend-design.md` (etapa 3) e de `...-etapa-2-login-design.md`
(seção "Avisos para a etapa 3"). A etapa 3 foi dividida em três: **3a (este documento)**, 3b (check-in) e 3c (fotos).

## Objetivo

O app grava jogadores, rodadas e configurações no Supabase com as mesmas respostas, mensagens de erro e
efeitos visíveis (o `GET` seguinte) do Apps Script atual.

## Escopo

- Ações: `addPlayer`, `updatePlayer`, `removePlayer`, `addRound`, `updateRound`, `removeRound`, `saveSettings`
  e `saveCheckinSettings` (as duas últimas fazem a mesma coisa, como no `.gs`).
- A exceção do porteiro em que o **próprio jogador** (perfil `jogador`) altera o seu cadastro só para trocar a foto
  (`excecaoPropriaFoto_`): nome, apelido, estrelas, sexo e porte precisam chegar idênticos ao que já está gravado.
- Fora de escopo: check-in (3b), `uploadPhoto` e cópia das fotos (3c), financeiro (4), Ao Vivo (5).

## Decisões (aprovadas pelo usuário)

- **Remover jogador = arquivar.** No `.gs` a linha some da aba `Jogadores` e os ids ficam soltos nas rodadas, nos
  check-ins e nos vínculos. No Postgres, apagar quebraria as chaves estrangeiras (e apagar em cascata faria as
  rodadas antigas perderem gente). Nova coluna `jogadores.removido boolean`: o jogador arquivado some de `players`
  (como hoje) e o histórico continua válido. Para o app, "não achou o jogador" continua sendo o mesmo erro do `.gs`.
- **A `ordem` das linhas novas vem de sequências do banco** (`nextval` como valor padrão), não de "máximo + 1" no
  código. Isso elimina a janela de corrida que a etapa 2 deixou aberta. O mesmo script cria os índices únicos
  `usuarios.jogador_id` e `usuarios.jogador_id_pendente` (parciais, ignorando vazios), que transformam a checagem
  "esse jogador já está vinculado" em garantia do banco. Em `usuarios.js` a inserção deixa de enviar `ordem`.
- **Salvar uma rodada é uma função do banco** (`gravar_rodada`, chamada por RPC): numa única transação ela cria os
  convidados novos, apaga a versão antiga da rodada (se existir), insere a rodada, os times e os jogadores de cada
  time. `remover_rodada` apaga os três níveis e diz se a rodada existia. Sem isso, uma falha no meio de editar uma
  rodada perderia os times.
- **Editar rodada a leva para o fim da lista**, como no `.gs` (que apaga as linhas e insere de novo no fim).
- **Convidados nascem junto com a rodada:** ids `convidado:NOME#xxxx` que ainda não existem entram em `jogadores`
  com `convidado = true` (o nome sai do próprio id), como na migração.
- **Configurações:** `saveSettings` grava as 7 chaves com a mesma formatação do `writeSettings` do `.gs`
  (`TRUE`/`FALSE`, valores padrão), preservando o `contadorAcessos` que já está no banco.

## Diferenças conhecidas e aceitas (não cobertas pelo teste diferencial)

- Adicionar jogador com um `id` que já existe: o `.gs` cria uma linha duplicada; o backend novo responde
  `Já existe um jogador com esse id.`. Adicionar uma rodada com um `id` que já existe: o `.gs` duplica as linhas; o
  backend novo substitui a rodada. Corrigem defeitos, e o app nunca faz isso (ids são gerados no navegador).
- Um id de jogador em um time que não existe em `jogadores` (e não é convidado): o `.gs` grava assim mesmo; o
  backend novo recusa (chave estrangeira). Um jogador arquivado não pode ser recriado com o mesmo id.
- Nomes de convidado com vírgula: no `.gs` a lista de ids é gravada separada por vírgulas e quebraria; aqui não.

## Como garantir que fica igual

Teste diferencial (como na etapa 2): a mesma sequência de pedidos roda no `.gs` real e no backend novo e, **depois
de cada passo de gravação, o `GET` completo dos dois é comparado** (jogadores, rodadas com ordem e times,
configurações). O SQL do banco (`gravar_rodada`, sequências) é verificado por um script de integração que roda no
Supabase real com dados de teste e limpa tudo no fim.

## Riscos

- O script SQL precisa ser executado pelo usuário no painel do Supabase antes de o backend novo gravar (o passo
  é dele; se faltar, as gravações falham com mensagem clara, sem corromper dados).
- Índices únicos em `usuarios` falham se já houver duplicatas; conferido nos dados antes de entregar o script.
