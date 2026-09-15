-- Comptes (numéro de téléphone + code PIN, sans SMS), amis et invitations.
-- Aucune policy RLS : les tables ne sont accessibles que par les fonctions ci-dessous (SECURITY DEFINER), qui vérifient
-- le secret de l'appareil. Les invitations sont en plus diffusées par Realtime Broadcast (canal acct-<téléphone>).
create table public.harmonies_accounts (
  phone text primary key check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  name text not null check (char_length(name) between 1 and 16),
  avatar integer not null default 0,
  pin_hash text not null check (char_length(pin_hash) = 64),
  secret text not null default encode(gen_random_bytes(18), 'hex'),
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create table public.harmonies_friends (
  owner text not null references public.harmonies_accounts(phone) on delete cascade,
  friend text not null references public.harmonies_accounts(phone) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner, friend),
  check (owner <> friend)
);
create table public.harmonies_invites (
  id bigint generated always as identity primary key,
  game text not null references public.harmonies_games(id) on delete cascade,
  from_phone text not null references public.harmonies_accounts(phone) on delete cascade,
  to_phone text not null references public.harmonies_accounts(phone) on delete cascade,
  created_at timestamptz not null default now()
);
create index harmonies_invites_to_idx on public.harmonies_invites (to_phone, id);
create index harmonies_friends_friend_idx on public.harmonies_friends (friend);

alter table public.harmonies_accounts enable row level security;
alter table public.harmonies_friends enable row level security;
alter table public.harmonies_invites enable row level security;

-- Vérifie (téléphone, secret) et met à jour la dernière activité.
create or replace function public.harmonies_auth(p_phone text, p_secret text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.harmonies_accounts set last_seen = now() where phone = p_phone and secret = p_secret and p_secret <> '';
  if not found then raise exception 'not signed in' using errcode = '28000'; end if;
  return true;
end $$;

create or replace function public.harmonies_signup(p_phone text, p_name text, p_avatar integer, p_pin_hash text) returns json
language plpgsql security definer set search_path = '' as $$
declare a public.harmonies_accounts;
begin
  if exists (select 1 from public.harmonies_accounts where phone = p_phone) then
    raise exception 'This number already has an account — sign in instead' using errcode = '23505';
  end if;
  insert into public.harmonies_accounts (phone, name, avatar, pin_hash) values (p_phone, p_name, coalesce(p_avatar, 0), p_pin_hash) returning * into a;
  return json_build_object('phone', a.phone, 'name', a.name, 'avatar', a.avatar, 'secret', a.secret);
end $$;

create or replace function public.harmonies_login(p_phone text, p_pin_hash text) returns json
language plpgsql security definer set search_path = '' as $$
declare a public.harmonies_accounts;
begin
  select * into a from public.harmonies_accounts where phone = p_phone and pin_hash = p_pin_hash;
  if not found then raise exception 'Wrong number or PIN' using errcode = '28000'; end if;
  update public.harmonies_accounts set last_seen = now() where phone = a.phone;
  return json_build_object('phone', a.phone, 'name', a.name, 'avatar', a.avatar, 'secret', a.secret);
end $$;

create or replace function public.harmonies_update_profile(p_phone text, p_secret text, p_name text, p_avatar integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.harmonies_auth(p_phone, p_secret);
  update public.harmonies_accounts set name = p_name, avatar = coalesce(p_avatar, 0) where phone = p_phone;
end $$;

-- Tout ce qu'affiche l'accueil : profil, amis, invitations en attente (parties encore en salle d'attente, < 24 h).
create or replace function public.harmonies_home(p_phone text, p_secret text) returns json
language plpgsql security definer set search_path = '' as $$
declare v_friends json; v_invites json; a public.harmonies_accounts;
begin
  perform public.harmonies_auth(p_phone, p_secret);
  select * into a from public.harmonies_accounts where phone = p_phone;
  select coalesce(json_agg(json_build_object('phone', f.friend, 'name', b.name, 'avatar', b.avatar, 'last_seen', b.last_seen) order by b.name), '[]'::json)
    into v_friends from public.harmonies_friends f join public.harmonies_accounts b on b.phone = f.friend where f.owner = p_phone;
  select coalesce(json_agg(json_build_object('id', i.id, 'game', i.game, 'from', json_build_object('phone', b.phone, 'name', b.name, 'avatar', b.avatar),
      'side', g.state->'opts'->>'side', 'spirits', (g.state->'opts'->>'spirits')::boolean, 'created_at', i.created_at) order by i.id desc), '[]'::json)
    into v_invites from public.harmonies_invites i join public.harmonies_accounts b on b.phone = i.from_phone join public.harmonies_games g on g.id = i.game
    where i.to_phone = p_phone and i.created_at > now() - interval '24 hours' and g.state->>'status' = 'lobby';
  return json_build_object('account', json_build_object('phone', a.phone, 'name', a.name, 'avatar', a.avatar), 'friends', v_friends, 'invites', v_invites);
end $$;

create or replace function public.harmonies_add_friend(p_phone text, p_secret text, p_friend text) returns json
language plpgsql security definer set search_path = '' as $$
declare b public.harmonies_accounts;
begin
  perform public.harmonies_auth(p_phone, p_secret);
  if p_friend = p_phone then raise exception 'That is your own number'; end if;
  select * into b from public.harmonies_accounts where phone = p_friend;
  if not found then raise exception 'No account with this number yet — ask your friend to sign up' using errcode = 'P0002'; end if;
  insert into public.harmonies_friends (owner, friend) values (p_phone, p_friend) on conflict do nothing;
  return json_build_object('phone', b.phone, 'name', b.name, 'avatar', b.avatar);
end $$;

create or replace function public.harmonies_remove_friend(p_phone text, p_secret text, p_friend text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.harmonies_auth(p_phone, p_secret);
  delete from public.harmonies_friends where owner = p_phone and friend = p_friend;
end $$;

create or replace function public.harmonies_invite(p_phone text, p_secret text, p_to text, p_game text) returns json
language plpgsql security definer set search_path = '' as $$
declare v_id bigint; a public.harmonies_accounts; g public.harmonies_games;
begin
  perform public.harmonies_auth(p_phone, p_secret);
  select * into g from public.harmonies_games where id = p_game;
  if not found or g.state->>'status' <> 'lobby' then raise exception 'This game can no longer be joined'; end if;
  if not exists (select 1 from public.harmonies_accounts where phone = p_to) then raise exception 'Unknown friend'; end if;
  select * into a from public.harmonies_accounts where phone = p_phone;
  delete from public.harmonies_invites where from_phone = p_phone and to_phone = p_to and game = p_game;
  insert into public.harmonies_invites (game, from_phone, to_phone) values (p_game, p_phone, p_to) returning id into v_id;
  return json_build_object('id', v_id, 'game', p_game, 'from', json_build_object('phone', a.phone, 'name', a.name, 'avatar', a.avatar),
    'side', g.state->'opts'->>'side', 'spirits', (g.state->'opts'->>'spirits')::boolean);
end $$;

create or replace function public.harmonies_dismiss_invite(p_phone text, p_secret text, p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.harmonies_auth(p_phone, p_secret);
  delete from public.harmonies_invites where id = p_id and to_phone = p_phone;
end $$;

grant execute on function public.harmonies_signup(text, text, integer, text), public.harmonies_login(text, text),
  public.harmonies_update_profile(text, text, text, integer), public.harmonies_home(text, text),
  public.harmonies_add_friend(text, text, text), public.harmonies_remove_friend(text, text, text),
  public.harmonies_invite(text, text, text, text), public.harmonies_dismiss_invite(text, text, bigint) to anon, authenticated;
revoke execute on function public.harmonies_auth(text, text) from public, anon, authenticated;
