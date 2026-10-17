-- Agendador do lembrete "⏰ Hoje tem vôlei!" (v19.2). A cada 15 minutos o próprio banco chama as funções; cada uma só
-- age no dia do check-in aberto, nas 3 horas antes do jogo, e UMA vez por jogo (ver lembreteDoDia em
-- backend/avisos-push.js). QUEM RODA: o usuário (ou o assistente com autorização), uma vez, no projeto lzwmirrjpoqucwlhgkku.
-- Pode rodar mais de uma vez: cron.schedule com o mesmo nome substitui o agendamento.
--
-- Liga duas extensões do Supabase: pg_cron (agenda) e pg_net (faz a chamada HTTP).
-- As funções foram publicadas com --no-verify-jwt, então a chamada não precisa de chave.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Terça
select cron.schedule('lembrete-volei-terca', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://lzwmirrjpoqucwlhgkku.supabase.co/functions/v1/terca-api-teste',
    body := '{"action":"lembreteDoDia"}'::jsonb
  )
$$);

-- Grupos independentes: uma chamada passa por todos os grupos ativos
select cron.schedule('lembrete-volei-grupos', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://lzwmirrjpoqucwlhgkku.supabase.co/functions/v1/grupos-api',
    body := '{"action":"lembretesAgendados"}'::jsonb
  )
$$);

-- Meme: só depois da replicação autorizada (descomentar e rodar de novo)
-- select cron.schedule('lembrete-volei-meme', '*/15 * * * *', $$
--   select net.http_post(
--     url := 'https://lzwmirrjpoqucwlhgkku.supabase.co/functions/v1/meme-api',
--     body := '{"action":"lembreteDoDia"}'::jsonb
--   )
-- $$);

-- Para conferir:   select jobname, schedule, active from cron.job;
-- Para desligar:   select cron.unschedule('lembrete-volei-terca');
