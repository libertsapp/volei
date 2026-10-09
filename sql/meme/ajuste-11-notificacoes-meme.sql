-- GERADO a partir de sql/schema-terca-supabase-ajuste-11.sql (schema meme). NÃO edite à mão: se o ajuste 11 do
-- Terça mudar, regenere (ver scripts/gerar-sql-grupo.js) e cole este trecho nas instalações do Meme já existentes.
-- QUEM RODA: o usuário, no SQL Editor do Supabase, no projeto que já tem o schema "meme".
set search_path = meme;

-- Ajuste 11: notificações push (quem instalou o app como PWA e aceitou a permissão do navegador).
-- QUEM RODA: o usuário, no SQL Editor do Supabase. Pode ser executado mais de uma vez sem estragar nada.
--
-- Não depende de login: qualquer aparelho que aceitar a notificação grava sua inscrição aqui (endpoint único
-- por aparelho/navegador, dado pelo próprio navegador). Enviar notificação (ação "enviarNotificacao") é
-- organizador/admin; inscrever é livre, igual ao check-in sem login.
create table if not exists push_inscricoes (
  id text primary key,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  criado_em timestamptz
);
