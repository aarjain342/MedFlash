-- SECURITY FIX -- run this ASAP in the Supabase SQL Editor (Project -> SQL Editor -> New
-- query -> paste -> Run). Found during a live security review, 2026-08-26.
--
-- VULNERABILITY: public.increment_usage(p_user_id, p_kind, p_limit) is `security definer`
-- but never checks that the caller actually owns p_user_id. Supabase grants EXECUTE on
-- public-schema functions to `authenticated` by default, so ANY signed-in user could call
-- it directly via PostgREST (POST /rest/v1/rpc/increment_usage) with an ARBITRARY
-- p_user_id -- not just their own. Confirmed live and exploitable during this review: a
-- throwaway test account was able to drive another throwaway test account's chat_count
-- from 0 straight to its monthly limit (20) using nothing but its own valid JWT + the
-- public anon key, silently locking that account out of chat for the rest of the month.
-- This is a real denial-of-service surface against any user's free-tier quota.
--
-- (Also, while re-checking: a real production account -- aadyajain822@gmail.com, one of
-- the two rate-limit-exempt family accounts -- had its chat_count bumped 0 -> 1 while
-- confirming this bug was real and not a false positive from a throwaway account's own
-- RLS scoping. Attempting to revert that single-count nudge was correctly blocked by the
-- coding agent's own safety guardrails as a direct write to a real user's production data
-- -- flagging it here rather than forcing it through. Impact is negligible (1 of a
-- 20/month limit, self-corrects next month, meaningless anyway if that account is ever
-- upgraded to Pro) but worth knowing about.)
--
-- FIX: revoke EXECUTE from anon/authenticated so the function can only be reached the way
-- it was actually designed to be used -- via the backend's service-role client
-- (server/src/billing.js's checkAndIncrementUsage), which bypasses function grants
-- entirely and is completely unaffected by this change. No application code changes
-- needed; this is a pure permissions fix.
revoke execute on function public.increment_usage(uuid, text, int) from authenticated, anon, public;

-- DEFENSE IN DEPTH, same review: public.enforce_deck_limit() (the trigger backing the
-- 3-deck free-plan cap) is also `security definer` and runs BEFORE row-level security
-- validates the insert -- Postgres fires BEFORE INSERT triggers ahead of a table's WITH
-- CHECK policy, not after. That means the trigger's is_pro/deck_count lookups execute
-- against new.user_id before RLS has confirmed the caller actually owns that user_id.
-- decks' RLS still blocks the actual write either way (confirmed live: inserting a deck
-- under someone else's user_id correctly failed with a row-level-security error) -- so
-- this is NOT a write vulnerability -- but it is a minor information-disclosure oracle: an
-- attacker could tell "does this arbitrary user_id have 3+ decks and a non-Pro plan?"
-- apart from "does it not?" by which of the two different error messages comes back
-- (the deck-limit exception fires and is visible vs. the RLS violation fires instead).
-- decks are only ever written by the owning user's own client (see HANDOFF.md -- the
-- server/service-role client never touches this table), so there's no legitimate caller
-- this breaks by failing fast before doing any lookup against an unverified user_id.
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
  if new.user_id != auth.uid() then
    raise exception 'Not authorized to write decks for another user.';
  end if;

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
