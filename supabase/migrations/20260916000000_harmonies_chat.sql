-- Chat de partie : une ligne par message, diffusée aux autres joueurs par le temps réel (événements INSERT).
-- (appliquée sur le projet Supabase « harmonies » ; conservée ici pour référence / recréation)
create table public.harmonies_chat (
  id bigint generated always as identity primary key,
  game text not null references public.harmonies_games(id) on delete cascade,
  pid text not null,
  name text not null default '',
  avatar integer not null default 0,
  text text not null check (char_length(text) between 1 and 300),
  created_at timestamptz not null default now()
);
create index harmonies_chat_game_idx on public.harmonies_chat (game, id);

alter table public.harmonies_chat enable row level security;

create policy "harmonies_chat_select" on public.harmonies_chat
  for select to anon, authenticated using (true);
create policy "harmonies_chat_insert" on public.harmonies_chat
  for insert to anon, authenticated with check (true);

alter publication supabase_realtime add table public.harmonies_chat;
