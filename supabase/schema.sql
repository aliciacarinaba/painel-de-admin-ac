-- ============================================================
-- FASE 1: BASE DE DADOS (Supabase)
-- Cola este ficheiro inteiro no SQL Editor do Supabase e carrega em Run.
-- ============================================================

-- ---------- 1) TABELAS ----------

-- Automações. Toda a conversa mora na coluna "flow" (a Mensagem 1 é o primeiro passo).
create table if not exists ig_automations (
  id uuid primary key default gen_random_uuid(),
  nome text,
  keyword text default '',                 -- palavras separadas por vírgula
  match_any boolean not null default false, -- qualquer palavra ativa
  active boolean not null default true,
  media_ids text[] not null default '{}',   -- posts escolhidos (vazio = todos)
  public_reply text default '',
  public_reply_variants text[] not null default '{}',
  flow jsonb not null default '{"steps":[]}',
  asset_ids text[] not null default '{}',
  updated_at timestamptz not null default now()
);

-- Contactos captados
create table if not exists ig_leads (
  ig_user_id text primary key,
  username text,
  last_source text,                         -- comment / dm / story_reply
  last_keyword text,
  automation_id uuid,
  flow_step text,                           -- em que passo da conversa está
  link_sent boolean not null default false,
  expecting jsonb,                          -- quando um passo pede um dado
  tags text[] not null default '{}',
  email text,
  telefone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Registo de cada envio
create table if not exists ig_deliveries (
  id bigint generated always as identity primary key,
  ig_user_id text,
  automation_id uuid,
  canal text,                               -- private_reply / dm
  tipo text,                                -- flow / link / text
  status text,                              -- ok / erro / na_fila
  motivo text,
  ts timestamptz not null default now()
);
create index if not exists ig_deliveries_user_ts on ig_deliveries (ig_user_id, ts desc);

-- Fila de envios retidos pelo travão
create table if not exists ig_send_queue (
  id bigint generated always as identity primary key,
  comment_id text unique,
  automation_id uuid,
  ig_user_id text,
  username text,
  status text not null default 'pendente',  -- pendente / enviado / erro / expirado
  tentativas int not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text
);

-- O CONTADOR do travão (uma linha só). SEM ESTA TABELA o travão não tem onde contar
-- e nenhuma DM por comentário sai.
create table if not exists ig_send_budget (
  id text primary key,
  min_count int not null default 0,
  hour_count int not null default 0,
  day_count int not null default 0,
  min_start timestamptz,
  hour_start timestamptz,
  day_start timestamptz,
  err_streak int not null default 0,
  cap_minute int not null default 6,        -- limites CONSERVADORES, bem abaixo do Instagram
  cap_hour int not null default 60,
  cap_day int not null default 180,
  paused_until timestamptz
);
insert into ig_send_budget (id) values ('private_reply') on conflict (id) do nothing;

-- Passos com atraso
create table if not exists ig_scheduled (
  id bigint generated always as identity primary key,
  ig_user_id text,
  automation_id uuid,
  step_id text,
  send_at timestamptz not null,
  sent boolean not null default false,
  created_at timestamptz not null default now()
);

-- Biblioteca de ficheiros
create table if not exists ig_assets (
  id uuid primary key default gen_random_uuid(),
  nome text,
  tipo text,                                -- image / audio / video / file
  public_url text,
  attachment_id text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

-- Estado do token do Instagram
create table if not exists ig_token_status (
  id text primary key,                      -- "main"
  expires_at timestamptz,
  last_ok boolean,
  last_error text,
  last_refreshed_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Mensagens que o PRÓPRIO sistema enviou (para ignorar os "echo")
create table if not exists ig_bot_sends (
  mid text primary key,
  ts timestamptz not null default now()
);

-- Eventos já processados (para não repetir o mesmo comentário/mensagem)
create table if not exists ig_events_seen (
  id text primary key,
  ts timestamptz not null default now()
);

-- ---------- 2) FUNÇÕES DO TRAVÃO (OBRIGATÓRIAS) ----------
-- AVISO: sem estas funções o travão falha fechado e NENHUMA DM por comentário sai
-- (tudo vai para a fila e a fila nunca anda).

-- Tenta apanhar uma ficha de envio. Devolve true se pode enviar.
create or replace function take_send_slot(p_key text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  b ig_send_budget%rowtype;
  n timestamptz := now();
begin
  select * into b from ig_send_budget where id = p_key for update;  -- trava atómica
  if not found then return false; end if;

  -- disjuntor: em pausa, ninguém envia
  if b.paused_until is not null and b.paused_until > n then return false; end if;

  -- zera as janelas que já passaram
  if b.min_start  is null or n - b.min_start  >= interval '1 minute' then b.min_start  := n; b.min_count  := 0; end if;
  if b.hour_start is null or n - b.hour_start >= interval '1 hour'   then b.hour_start := n; b.hour_count := 0; end if;
  if b.day_start  is null or n - b.day_start  >= interval '1 day'    then b.day_start  := n; b.day_count  := 0; end if;

  if b.min_count >= b.cap_minute or b.hour_count >= b.cap_hour or b.day_count >= b.cap_day then
    update ig_send_budget set min_start=b.min_start, hour_start=b.hour_start, day_start=b.day_start,
      min_count=b.min_count, hour_count=b.hour_count, day_count=b.day_count where id = p_key;
    return false;
  end if;

  update ig_send_budget set
    min_start=b.min_start, hour_start=b.hour_start, day_start=b.day_start,
    min_count=b.min_count+1, hour_count=b.hour_count+1, day_count=b.day_count+1
  where id = p_key;
  return true;
end $$;

-- Regista o resultado do envio para alimentar o disjuntor.
-- Falhas "duras" (bloqueio) pausam mais depressa (3 seguidas); falhas normais pausam só após 8.
create or replace function record_send_result(p_key text, p_ok boolean, p_hard boolean) returns void
language plpgsql security definer set search_path = public as $$
declare s int;
begin
  if p_ok then
    update ig_send_budget set err_streak = 0 where id = p_key;
    return;
  end if;
  update ig_send_budget set err_streak = err_streak + 1 where id = p_key returning err_streak into s;
  if (p_hard and s >= 3) or s >= 8 then
    update ig_send_budget set paused_until = now() + interval '3 hours', err_streak = 0 where id = p_key;
  end if;
end $$;

-- Só as Edge Functions (service_role) podem chamar estas funções
revoke execute on function take_send_slot(text) from public, anon, authenticated;
revoke execute on function record_send_result(text, boolean, boolean) from public, anon, authenticated;
grant execute on function take_send_slot(text) to service_role;
grant execute on function record_send_result(text, boolean, boolean) to service_role;

-- ---------- 3) RLS (regras de acesso) ----------
-- Painel: só utilizadores autenticados. As Edge Functions usam a service_role (ignora o RLS).
do $$
declare t text;
begin
  foreach t in array array['ig_automations','ig_leads','ig_deliveries','ig_send_queue','ig_send_budget',
                           'ig_scheduled','ig_assets','ig_token_status','ig_bot_sends','ig_events_seen']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "admin_total" on %I', t);
    execute format('create policy "admin_total" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ---------- 4) VISTA PARA O SEPARADOR "INTERAÇÕES" ----------
-- Junta cada lead com o nome da automação e o número de mensagens trocadas.
-- security_invoker = as regras de acesso (RLS) das tabelas base aplicam-se a quem consulta.
create or replace view ig_leads_view with (security_invoker = true) as
select
  l.*,
  a.nome as automacao_nome,
  coalesce(d.total, 0) as interacoes,
  coalesce(d.ok, 0)    as envios_ok,
  coalesce(d.erros, 0) as envios_erro
from ig_leads l
left join ig_automations a on a.id = l.automation_id
left join (
  select ig_user_id,
         count(*) as total,
         count(*) filter (where status = 'ok') as ok,
         count(*) filter (where status = 'erro') as erros
  from ig_deliveries
  group by ig_user_id
) d on d.ig_user_id = l.ig_user_id;

revoke all on ig_leads_view from anon;
grant select on ig_leads_view to authenticated, service_role;

-- ---------- 5) ANÁLISE (separador "Análise") ----------
-- Guarda o último resultado calculado pela função ig-analysis (só atualiza quando se carrega em "Atualizar").
create table if not exists ig_analysis (
  id text primary key,                       -- "main"
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table ig_analysis enable row level security;
drop policy if exists "admin_total" on ig_analysis;
create policy "admin_total" on ig_analysis for all to authenticated using (true) with check (true);

-- ---------- 6) AUDIÊNCIA (separador "Audiência" do Início) ----------
-- "main" = último resultado da função ig-audience; "config" = {"competitors":["perfil1", ...]}
create table if not exists ig_audience (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table ig_audience enable row level security;
drop policy if exists "admin_total" on ig_audience;
create policy "admin_total" on ig_audience for all to authenticated using (true) with check (true);

-- ---------- 7) OFERTA FORMATIVA (secção "Oferta Formativa") ----------
-- Cada formação tem um estado (draft / progress / available) e uma ficha preenchida à mão ("dados").
create table if not exists formacoes (
  id uuid primary key default gen_random_uuid(),
  nome text not null default '',
  status text not null default 'draft' check (status in ('draft','progress','available')),
  categoria text default '',
  nivel text default '',
  ticket numeric,
  link_venda text default '',
  estado_venda text default '',
  dados jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table formacoes enable row level security;
drop policy if exists "admin_total" on formacoes;
create policy "admin_total" on formacoes for all to authenticated using (true) with check (true);

-- ---------- 8) PARCERIAS (secção "Parcerias") ----------
-- Parcerias sugeridas a ti ("recebida") ou por ti ("enviada"). O que não é filtrável fica em "dados".
create table if not exists parcerias (
  id uuid primary key default gen_random_uuid(),
  nome text not null default '',
  origem text not null default 'recebida' check (origem in ('recebida','enviada')),
  data_sugestao date,
  estado text not null default 'Nova',
  tipo text default '',
  oferta text default '',
  pagamento_tipo text default '',
  valor numeric,
  forma_pagamento text default '',
  pagamento_estado text default '',
  data_pagamento date,
  dados jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table parcerias enable row level security;
drop policy if exists "admin_total" on parcerias;
create policy "admin_total" on parcerias for all to authenticated using (true) with check (true);
