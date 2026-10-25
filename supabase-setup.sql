-- OPTIONNEL : historique des duels.
-- Le duel en temps réel (Broadcast + Presence) n'a besoin d'aucune table.
-- À coller dans Supabase > SQL Editor.

create table if not exists public.matches (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  room        text not null,
  theme       text not null,
  host_name   text not null,
  guest_name  text not null,
  host_score  int  not null,
  guest_score int  not null
);

alter table public.matches enable row level security;

drop policy if exists "lecture publique" on public.matches;
create policy "lecture publique" on public.matches
  for select using (true);

-- Insertion ouverte mais bornée (score max : 19 x 100 + 200 = 2100 pour 20 questions).
drop policy if exists "insertion bornee" on public.matches;
create policy "insertion bornee" on public.matches
  for insert with check (
    char_length(host_name)  between 1 and 14 and
    char_length(guest_name) between 1 and 14 and
    char_length(room) = 4 and
    host_score  between 0 and 2500 and
    guest_score between 0 and 2500
  );

-- Pas de policy update/delete : personne ne peut modifier l'historique depuis le site.
