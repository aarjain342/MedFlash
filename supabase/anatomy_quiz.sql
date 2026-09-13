-- Anatomy Quiz schema: run this once in the Supabase SQL Editor
-- (Project -> SQL Editor -> New query -> paste -> Run).
--
-- Mirrors the decks/quizzes split, deliberately: anatomy_decks holds the large,
-- write-once page images + label data; anatomy_progress holds tiny per-deck study
-- progress that gets rewritten on every answer. Keeping these separate means
-- recording a guess never re-uploads a deck's images (unlike StudyView's known,
-- still-open full-deck-rewrite issue on the flashcard side — see HANDOFF.md).
--
-- Both tables are written directly from the browser with the signed-in user's own
-- session (client/src/lib/db.js), not by the backend's service-role client — so
-- unlike billing.sql's tables, these need full owner-scoped read/write RLS, not
-- select-only.

create table if not exists public.anatomy_decks (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  source_file text,
  created_at timestamptz not null default now(),
  -- [{ page, image, labels: [{ id, label, box: [ymin, xmin, ymax, xmax] }] }]
  -- box coordinates are 0-1000 normalized (Gemini's spatial-grounding convention).
  -- image lives once per page (not per label) — see HANDOFF.md's 29.5MB-deck incident.
  pages jsonb not null default '[]'::jsonb
);

alter table public.anatomy_decks enable row level security;

drop policy if exists "users manage own anatomy decks" on public.anatomy_decks;
create policy "users manage own anatomy decks" on public.anatomy_decks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists anatomy_decks_user_id_idx on public.anatomy_decks(user_id);

create table if not exists public.anatomy_progress (
  deck_id uuid primary key references public.anatomy_decks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- { cursor, results: { [labelId]: boolean }, complete }
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.anatomy_progress enable row level security;

drop policy if exists "users manage own anatomy progress" on public.anatomy_progress;
create policy "users manage own anatomy progress" on public.anatomy_progress
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
