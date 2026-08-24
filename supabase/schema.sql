-- piikki: Supabase schema
--
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New query)
-- on a fresh project. It creates the two tables the app reads and writes, and
-- restricts them to signed-in users. Re-running it on a project that already
-- has these tables is safe — every statement is written to not error on a
-- second run — so if you set this up before auth existed, just re-run the
-- whole file to pick up the tightened policies below.
--
-- Security model: the app has Supabase Auth now (see README), so every
-- request must carry a valid session for one of the accounts you create by
-- hand in the dashboard — there is no self-signup. The `anon` role (i.e.
-- nobody logged in) gets no access at all; only `authenticated` does. This is
-- real defense in depth: even someone who extracts the anon key from the
-- client bundle cannot read or write the database without a valid login,
-- unlike the anon-key-only model this schema used to use. Keep the deployed
-- page behind your hosting provider's password too — that stops an
-- unauthenticated visitor from even reaching the login screen, but it's now
-- a second layer, not the only one.

create table if not exists transactions (
  id uuid primary key,
  date date not null,
  description text not null default '',
  amount_cents integer not null check (amount_cents >= 0),
  payer text not null check (payer in ('me', 'partner')),
  category_id text not null,
  split_kind text not null check (split_kind in ('expense', 'settlement')),
  split_my_share numeric(4, 3) not null check (split_my_share >= 0 and split_my_share <= 1),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists transactions_date_idx on transactions (date);

-- Single-row settings table: names, currency, split-rule catalogue.
create table if not exists settings (
  id text primary key default 'singleton' check (id = 'singleton'),
  my_name text not null default 'Me',
  partner_name text not null default 'Partner',
  currency text not null default 'EUR',
  locale text not null default 'fi-FI',
  categories jsonb not null default '[]'::jsonb,
  default_category_id text not null default 'household',
  last_export_at timestamptz
);

alter table transactions enable row level security;
alter table settings enable row level security;

-- Drop the old anon-key-era policy if this project had it (safe if it never did).
drop policy if exists "anon full access" on transactions;
drop policy if exists "anon full access" on settings;

drop policy if exists "authenticated full access" on transactions;
create policy "authenticated full access" on transactions
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated full access" on settings;
create policy "authenticated full access" on settings
  for all
  to authenticated
  using (true)
  with check (true);

-- Realtime: lets both devices see the other one's changes live. Supabase
-- projects created after ~2024 have this on by default for new tables; this
-- is here so it works on older projects too. Wrapped so re-running the
-- script (or a project that already has it on) doesn't error.
do $$
begin
  alter publication supabase_realtime add table transactions;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table settings;
exception when duplicate_object then null;
end $$;

-- This file does not create the two user accounts — do that by hand:
-- Authentication -> Users -> Add user, once for each of you, with
-- "Auto Confirm User" checked so there's no email-verification step. See the
-- README for the full walkthrough.
