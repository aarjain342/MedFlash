-- MedFlash billing schema: run this once in the Supabase SQL Editor
-- (Project -> SQL Editor -> New query -> paste -> Run).
--
-- Two tables (subscriptions, usage_counters) track Stripe subscription state and
-- monthly free-tier usage. Both are written only by the backend's service-role
-- client (webhook handler / plan-limit middleware) — RLS below only grants
-- `select` to the owning user, no `insert`/`update`/`delete` for `authenticated`.

create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text,
  plan text check (plan in ('monthly', 'annual')),
  status text not null default 'none', -- none | active | trialing | past_due | canceled
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

drop policy if exists "users read own subscription" on public.subscriptions;
create policy "users read own subscription" on public.subscriptions
  for select using (auth.uid() = user_id);

create table if not exists public.usage_counters (
  user_id uuid not null references auth.users(id) on delete cascade,
  month date not null, -- always the 1st of the month, e.g. 2026-08-01
  generations_count int not null default 0,
  chat_count int not null default 0,
  primary key (user_id, month)
);

alter table public.usage_counters enable row level security;

drop policy if exists "users read own usage" on public.usage_counters;
create policy "users read own usage" on public.usage_counters
  for select using (auth.uid() = user_id);

-- Atomically increments a monthly counter and reports whether the caller is still
-- under `p_limit`. Runs as security definer so it can write despite the RLS
-- policies above (only ever called by the backend's service-role client, which
-- already bypasses RLS on its own — security definer here just keeps the function
-- safe to call from a non-service-role context too, e.g. future direct RPC use).
create or replace function public.increment_usage(p_user_id uuid, p_kind text, p_limit int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  cur_month date := date_trunc('month', now())::date;
  new_count int;
begin
  insert into public.usage_counters (user_id, month)
  values (p_user_id, cur_month)
  on conflict (user_id, month) do nothing;

  if p_kind = 'generation' then
    update public.usage_counters
      set generations_count = generations_count + 1
      where user_id = p_user_id and month = cur_month and generations_count < p_limit
      returning generations_count into new_count;
  elsif p_kind = 'chat' then
    update public.usage_counters
      set chat_count = chat_count + 1
      where user_id = p_user_id and month = cur_month and chat_count < p_limit
      returning chat_count into new_count;
  else
    raise exception 'Unknown usage kind: %', p_kind;
  end if;

  return new_count is not null; -- true = incremented (allowed), false = already at the limit
end;
$$;

-- Free plan is capped at 3 decks. Deck writes go straight from the client to
-- Supabase (see client/src/lib/db.js upsertDeckRemote), so this trigger is the
-- real enforcement boundary, not any Express route.
--
-- IMPORTANT: upsertDeckRemote always calls .upsert(), including when saving
-- progress on a deck the user already has (e.g. StudyView flipping a card).
-- Postgres fires BEFORE INSERT triggers for every candidate row of an upsert
-- BEFORE conflict resolution happens, even for rows that end up as updates — so
-- without the existing-row check below, a user at the 3-deck cap would get
-- blocked from studying decks they already own, not just from creating new ones.
create or replace function public.enforce_deck_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  already_exists boolean;
  deck_count int;
  is_pro boolean;
begin
  select exists(select 1 from public.decks where id = new.id) into already_exists;
  if already_exists then
    return new; -- this upsert is really an update to a deck the user already has
  end if;

  select exists(
    select 1 from public.subscriptions
    where user_id = new.user_id and status in ('active', 'trialing')
  ) into is_pro;
  if is_pro then
    return new;
  end if;

  select count(*) into deck_count from public.decks where user_id = new.user_id;
  if deck_count >= 3 then
    raise exception 'Free plan is limited to 3 decks — upgrade to MedFlash Pro for unlimited decks.';
  end if;

  return new;
end;
$$;

drop trigger if exists decks_enforce_limit on public.decks;
create trigger decks_enforce_limit
  before insert on public.decks
  for each row execute function public.enforce_deck_limit();
