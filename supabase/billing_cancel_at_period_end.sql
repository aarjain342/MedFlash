-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query -> paste
-- -> Run), same as supabase/billing.sql was.
--
-- Adds tracking for Stripe's `subscription.cancel_at_period_end` flag. Without this, a
-- user who cancels via the Customer Portal (which defaults to "stays active until the
-- billing period ends" rather than an immediate cancellation) sees the Settings page keep
-- saying "Renews <date>" right up until the subscription actually lapses -- misleading,
-- since it's not going to renew. The webhook handler and UI can't tell "will renew" apart
-- from "will end" without this column, since Stripe's own `status` field stays 'active'
-- for the whole cancel-pending window.
--
-- Purely additive (a new nullable-defaulted column) -- safe to run against the live table,
-- no downtime, no backfill needed for existing rows (defaults to false, which is correct:
-- an existing active/trialing subscription with no cancellation on file *is* still
-- renewing).
alter table public.subscriptions
  add column if not exists cancel_at_period_end boolean not null default false;
