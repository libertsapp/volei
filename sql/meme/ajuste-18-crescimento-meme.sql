-- Ajuste 18 do Meme (v20.0), igual ao ajuste 18 do Terça: 🎂 aniversário e 🤝 quem trouxe, no cadastro do jogador; 🙋 pedido de entrada, na conta.
--   jogadores.aniversario   'MM-DD' (só dia e mês, sem ano: ninguém precisa da idade de ninguém); NULL = não informou
--   jogadores.recrutado_por id de quem trouxe o jogador pro grupo (emblema 🤝 Recrutador); NULL = não informado
--   usuarios.pedido_entrada nome de quem entrou com Google SEM cadastro e pediu pra jogar ("Quero jogar"); aprovar cria o
--                           jogador e vincula a conta (backend/usuarios.js, aprovarEntrada). NULL = sem pedido
-- Sem chave estrangeira em recrutado_por de propósito: remover (arquivar) quem trouxe não pode travar nada.
-- Pode rodar mais de uma vez. Rodar ANTES de publicar a função com o backend da v20.0.
alter table meme.jogadores add column if not exists aniversario text;
alter table meme.jogadores add column if not exists recrutado_por text;
alter table meme.usuarios add column if not exists pedido_entrada text;
do $$ begin
  alter table meme.jogadores add constraint jogadores_aniversario_formato check (aniversario ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$');
exception when duplicate_object then null; end $$;
