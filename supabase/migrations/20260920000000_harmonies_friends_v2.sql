-- Amis v2 (sans inscription) : l'identité est l'appareil (pid + secret), chaque joueur reçoit un code d'ami ;
-- amitiés mutuelles ; abonnements Web Push ; index des parties par joueur (colonne pids) ; notifications serveur
-- (pg_net → fonction Edge harmonies-push) quand un tour change, qu'une partie commence/finit ou qu'un message arrive.
-- Remplace les comptes par téléphone + PIN de la migration précédente (jamais utilisés).
-- (appliquée sur le projet Supabase « harmonies » ; conservée ici pour référence / recréation)

drop function if exists public.harmonies_signup(text, text, integer, text);
drop function if exists public.harmonies_login(text, text);
drop function if exists public.harmonies_update_profile(text, text, text, integer);
drop function if exists public.harmonies_home(text, text);
drop function if exists public.harmonies_add_friend(text, text, text);
drop function if exists public.harmonies_remove_friend(text, text, text);
drop function if exists public.harmonies_invite(text, text, text, text);
drop function if exists public.harmonies_dismiss_invite(text, text, bigint);
drop function if exists public.harmonies_auth(text, text);
drop table if exists public.harmonies_invites;
drop table if exists public.harmonies_friends;
drop table if exists public.harmonies_accounts;

-- ---------- Tables ----------
create table public.harmonies_accounts (
  pid text primary key check (pid ~ '^[A-Za-z0-9_-]{3,40}$'),
  secret text not null default encode(extensions.gen_random_bytes(18), 'hex'),
  code text not null unique,
  name text not null check (char_length(name) between 1 and 16),
  avatar integer not null default 0,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create table public.harmonies_friends (
  owner text not null references public.harmonies_accounts(pid) on delete cascade,
  friend text not null references public.harmonies_accounts(pid) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner, friend),
  check (owner <> friend)
);
create index harmonies_friends_friend_idx on public.harmonies_friends (friend);
create table public.harmonies_push (
  id bigint generated always as identity primary key,
  pid text not null references public.harmonies_accounts(pid) on delete cascade,
  endpoint text not null unique,
  sub jsonb not null,
  ua text not null default '',
  created_at timestamptz not null default now(),
  last_used timestamptz not null default now()
);
create index harmonies_push_pid_idx on public.harmonies_push (pid);
alter table public.harmonies_accounts enable row level security;
alter table public.harmonies_friends enable row level security;
alter table public.harmonies_push enable row level security;

-- Joueurs humains de chaque partie (pour lister « mes parties ») ; joueurs présents au moment d'un message de chat.
alter table public.harmonies_games add column if not exists pids text[] not null default '{}';
create index if not exists harmonies_games_pids_idx on public.harmonies_games using gin (pids);
alter table public.harmonies_chat add column if not exists present text[] not null default '{}';

create or replace function public.harmonies_games_index() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.pids := coalesce((select array_agg(distinct p->>'pid') from jsonb_array_elements(new.state->'players') p
    where p->>'pid' is not null and coalesce((p->>'bot')::int, 0) = 0), '{}');
  return new;
end $$;
drop trigger if exists harmonies_games_index on public.harmonies_games;
create trigger harmonies_games_index before insert or update on public.harmonies_games
  for each row execute function public.harmonies_games_index();
-- remplissage des parties existantes sans toucher à updated_at
alter table public.harmonies_games disable trigger harmonies_touch;
update public.harmonies_games set pids = '{}';
alter table public.harmonies_games enable trigger harmonies_touch;

-- ---------- Comptes ----------
create or replace function public.harmonies_new_code() returns text
language plpgsql set search_path = '' as $$
declare v text; b bytea; i int; a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  loop
    b := extensions.gen_random_bytes(6); v := '';
    for i in 0..5 loop v := v || substr(a, (get_byte(b, i) % 32) + 1, 1); end loop;
    exit when not exists (select 1 from public.harmonies_accounts where code = v);
  end loop;
  return v;
end $$;

-- Vérifie (pid, secret) et note la dernière activité.
create or replace function public.harmonies_auth(p_pid text, p_secret text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.harmonies_accounts set last_seen = now() where pid = p_pid and secret = p_secret and p_secret <> '';
  if not found then raise exception 'not signed in' using errcode = '28000'; end if;
end $$;

create or replace function public.harmonies_register(p_pid text, p_name text, p_avatar integer) returns json
language plpgsql security definer set search_path = '' as $$
declare a public.harmonies_accounts;
begin
  if exists (select 1 from public.harmonies_accounts where pid = p_pid) then
    raise exception 'exists' using errcode = '23505';
  end if;
  insert into public.harmonies_accounts (pid, code, name, avatar) values (p_pid, public.harmonies_new_code(), p_name, coalesce(p_avatar, 0)) returning * into a;
  return json_build_object('pid', a.pid, 'secret', a.secret, 'code', a.code, 'name', a.name, 'avatar', a.avatar);
end $$;

create or replace function public.harmonies_update_profile(p_pid text, p_secret text, p_name text, p_avatar integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.harmonies_auth(p_pid, p_secret);
  update public.harmonies_accounts set name = p_name, avatar = coalesce(p_avatar, 0) where pid = p_pid;
end $$;

-- ---------- Résumé d'une partie (liste des parties) ----------
create or replace function public.harmonies_game_summary(g public.harmonies_games) returns json
language sql stable set search_path = '' as $$
  select json_build_object(
    'id', g.id, 'version', g.version, 'updated_at', g.updated_at, 'created_at', g.created_at,
    'status', g.state->>'status', 'side', g.state->'opts'->>'side', 'spirits', coalesce((g.state->'opts'->>'spirits')::boolean, false),
    'host', g.state->>'host', 'turn', g.state->'turn', 'turnNo', g.state->'turnNo', 'endReason', g.state->>'endReason',
    'lastBy', g.state->>'lastBy', 'rematch', g.state->>'rematch', 'resigned', g.state->'resigned', 'cancelledBy', g.state->'cancelledBy',
    'played', jsonb_array_length(coalesce(g.state->'log', '[]'::jsonb)) > 0,
    'players', (select coalesce(json_agg(json_build_object('pid', p->>'pid', 'name', p->>'name', 'avatar', coalesce((p->>'avatar')::int, 0), 'bot', coalesce((p->>'bot')::int, 0)) order by ord), '[]'::json)
      from jsonb_array_elements(g.state->'players') with ordinality as t(p, ord)),
    'winners', g.state->'result'->'winners',
    'totals', (select json_agg(s->'total' order by ord) from jsonb_array_elements(g.state->'result'->'scores') with ordinality as t(s, ord)));
$$;

-- Tout ce qu'affiche l'accueil : profil, amis (avec dernière activité), parties du joueur (sauf salles d'attente abandonnées).
create or replace function public.harmonies_home(p_pid text, p_secret text) returns json
language plpgsql security definer set search_path = '' as $$
declare a public.harmonies_accounts; v_friends json; v_games json;
begin
  perform public.harmonies_auth(p_pid, p_secret);
  select * into a from public.harmonies_accounts where pid = p_pid;
  select coalesce(json_agg(json_build_object('pid', b.pid, 'name', b.name, 'avatar', b.avatar, 'code', b.code, 'last_seen', b.last_seen) order by b.name), '[]'::json)
    into v_friends from public.harmonies_friends f join public.harmonies_accounts b on b.pid = f.friend where f.owner = p_pid;
  select coalesce(json_agg(public.harmonies_game_summary(g) order by g.updated_at desc), '[]'::json) into v_games
    from public.harmonies_games g
    where g.id in (select x.id from public.harmonies_games x where x.pids @> array[p_pid]
            and x.state->>'status' <> 'cancelled'
            and not (x.state->>'status' = 'lobby' and x.created_at < now() - interval '2 days')
          order by x.updated_at desc limit 60);
  return json_build_object('account', json_build_object('pid', a.pid, 'name', a.name, 'avatar', a.avatar, 'code', a.code),
    'friends', v_friends, 'games', v_games, 'now', now());
end $$;

-- Résumés de parties par code (appareils sans profil : parties récentes mémorisées localement).
create or replace function public.harmonies_summaries(p_ids text[]) returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(public.harmonies_game_summary(g) order by g.updated_at desc), '[]'::json)
  from public.harmonies_games g where g.id = any(p_ids);
$$;

-- ---------- Amis (mutuels) : par code d'ami, ou par pid d'un joueur de la même partie ----------
create or replace function public.harmonies_add_friend(p_pid text, p_secret text, p_code text, p_friend text) returns json
language plpgsql security definer set search_path = '' as $$
declare b public.harmonies_accounts;
begin
  perform public.harmonies_auth(p_pid, p_secret);
  if coalesce(p_friend, '') <> '' then
    select * into b from public.harmonies_accounts where pid = p_friend;
    if not found then raise exception 'This player has no profile yet' using errcode = 'P0002'; end if;
  else
    select * into b from public.harmonies_accounts where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
    if not found then raise exception 'No player with this code' using errcode = 'P0002'; end if;
  end if;
  if b.pid = p_pid then raise exception 'That is your own code'; end if;
  insert into public.harmonies_friends (owner, friend) values (p_pid, b.pid), (b.pid, p_pid) on conflict do nothing;
  return json_build_object('pid', b.pid, 'name', b.name, 'avatar', b.avatar, 'code', b.code, 'last_seen', b.last_seen);
end $$;

create or replace function public.harmonies_remove_friend(p_pid text, p_secret text, p_friend text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.harmonies_auth(p_pid, p_secret);
  delete from public.harmonies_friends where (owner = p_pid and friend = p_friend) or (owner = p_friend and friend = p_pid);
end $$;

-- ---------- Web Push ----------
create or replace function public.harmonies_push_subscribe(p_pid text, p_secret text, p_sub jsonb, p_ua text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.harmonies_auth(p_pid, p_secret);
  if coalesce(p_sub->>'endpoint', '') = '' then raise exception 'invalid subscription'; end if;
  insert into public.harmonies_push (pid, endpoint, sub, ua) values (p_pid, p_sub->>'endpoint', p_sub, left(coalesce(p_ua, ''), 200))
    on conflict (endpoint) do update set pid = excluded.pid, sub = excluded.sub, ua = excluded.ua, last_used = now();
end $$;

create or replace function public.harmonies_push_unsubscribe(p_pid text, p_secret text, p_endpoint text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.harmonies_auth(p_pid, p_secret);
  delete from public.harmonies_push where pid = p_pid and endpoint = p_endpoint;
end $$;

-- Nombre de parties où c'est au joueur de jouer (pastille de l'icône) — fonction Edge uniquement.
create or replace function public.harmonies_turn_count(p_pid text) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.harmonies_games g
  where g.pids @> array[p_pid] and g.state->>'status' = 'playing'
    and g.state->'players'->((g.state->>'turn')::int)->>'pid' = p_pid;
$$;

-- Secrets (coffre Vault) : clés VAPID et clé partagée trigger → fonction Edge. Réservés au rôle service.
create or replace function public.harmonies_secret(p_name text) returns text
language sql security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1;
$$;
create or replace function public.harmonies_secret_set(p_name text, p_value text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then perform vault.create_secret(p_value, p_name); else perform vault.update_secret(v_id, p_value); end if;
end $$;
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'harmonies_push_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'harmonies_push_key');
  end if;
end $$;

-- ---------- Notifications serveur : pg_net → fonction Edge harmonies-push ----------
create extension if not exists pg_net with schema extensions;
create or replace function public.harmonies_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_key text; v_body jsonb;
begin
  if tg_table_name = 'harmonies_games' then
    if tg_op = 'UPDATE' and new.state->>'status' is not distinct from old.state->>'status'
       and new.state->'turn' is not distinct from old.state->'turn' and new.state->'turnNo' is not distinct from old.state->'turnNo'
       and new.pids = old.pids then return null; end if;
    v_body := jsonb_build_object('event', 'game', 'game', new.id, 'op', tg_op, 'version', new.version,
      'old', case when tg_op = 'UPDATE' then jsonb_build_object('status', old.state->>'status', 'turn', old.state->'turn',
        'turnNo', old.state->'turnNo', 'pids', to_jsonb(old.pids)) else null end);
  else
    v_body := jsonb_build_object('event', 'chat', 'id', new.id, 'game', new.game);
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'harmonies_push_key';
  if v_key is null then return null; end if;
  perform net.http_post(
    url := 'https://jeqdtpuoufapovxvwtwa.supabase.co/functions/v1/harmonies-push',
    body := v_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-harmonies-key', v_key),
    timeout_milliseconds := 8000);
  return null;
end $$;
drop trigger if exists harmonies_games_notify on public.harmonies_games;
create trigger harmonies_games_notify after insert or update on public.harmonies_games
  for each row execute function public.harmonies_notify();
drop trigger if exists harmonies_chat_notify on public.harmonies_chat;
create trigger harmonies_chat_notify after insert on public.harmonies_chat
  for each row execute function public.harmonies_notify();

-- ---------- Droits ----------
grant execute on function public.harmonies_register(text, text, integer), public.harmonies_update_profile(text, text, text, integer),
  public.harmonies_home(text, text), public.harmonies_summaries(text[]),
  public.harmonies_add_friend(text, text, text, text), public.harmonies_remove_friend(text, text, text),
  public.harmonies_push_subscribe(text, text, jsonb, text), public.harmonies_push_unsubscribe(text, text, text) to anon, authenticated;
revoke execute on function public.harmonies_auth(text, text), public.harmonies_new_code(), public.harmonies_game_summary(public.harmonies_games),
  public.harmonies_turn_count(text), public.harmonies_secret(text), public.harmonies_secret_set(text, text), public.harmonies_notify()
  from public, anon, authenticated;
grant execute on function public.harmonies_turn_count(text), public.harmonies_secret(text), public.harmonies_secret_set(text, text) to service_role;
