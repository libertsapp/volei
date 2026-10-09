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
