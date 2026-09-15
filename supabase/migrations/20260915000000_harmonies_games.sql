-- Parties d'Harmonies : une ligne par partie, état complet en JSON, verrou optimiste via "version".
-- (appliquée sur le projet Supabase « harmonies » ; conservée ici pour référence / recréation)
create table public.harmonies_games (
  id text primary key,
  state jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.harmonies_games enable row level security;

-- Pas de comptes utilisateurs : les parties sont identifiées par un code aléatoire connu des seuls joueurs.
create policy "harmonies_select" on public.harmonies_games
  for select to anon, authenticated using (true);
create policy "harmonies_insert" on public.harmonies_games
  for insert to anon, authenticated with check (true);
create policy "harmonies_update" on public.harmonies_games
  for update to anon, authenticated using (true) with check (true);

create or replace function public.harmonies_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger harmonies_touch before update on public.harmonies_games
  for each row execute function public.harmonies_touch();

-- Temps réel : les clients s'abonnent aux mises à jour de leur partie.
alter publication supabase_realtime add table public.harmonies_games;
