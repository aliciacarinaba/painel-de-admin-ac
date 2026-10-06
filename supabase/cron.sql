-- ============================================================
-- AGENDAMENTO (pg_cron + pg_net)
-- Corre DEPOIS de publicares as Edge Functions.
-- Troca SEU_PROJETO e SEU_SCHED_SECRET_AQUI pelos teus valores
-- (o segredo tem de ser igual ao SCHED_SECRET das Edge Functions).
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;   -- permite ao Postgres chamar URLs (Edge Functions)

-- Esvazia a fila e envia passos com atraso: a cada 1 minuto
select cron.schedule(
  'ig-scheduler',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://SEU_PROJETO.supabase.co/functions/v1/ig-scheduler',
       headers := jsonb_build_object('Content-Type','application/json','x-sched-key','SEU_SCHED_SECRET_AQUI'),
       body := '{}'::jsonb
     ) $$
);

-- Renova o token do Instagram: 1 vez por semana (segundas, 04:00)
select cron.schedule(
  'ig-token-refresh',
  '0 4 * * 1',
  $$ select net.http_post(
       url := 'https://SEU_PROJETO.supabase.co/functions/v1/ig-token-refresh',
       headers := jsonb_build_object('Content-Type','application/json','x-sched-key','SEU_SCHED_SECRET_AQUI'),
       body := '{}'::jsonb
     ) $$
);

-- Para remover um agendamento: select cron.unschedule('ig-scheduler');
