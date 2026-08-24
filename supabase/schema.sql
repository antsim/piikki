-- piikki: Supabase schema
--
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New query)
-- on a fresh project. It creates the two tables the app reads and writes, and
-- opens them up to the anon key.
--
-- Security model: there is no login in the app yet, so every request uses the
-- project's anon key, which every visitor to the deployed page can see (that
-- is how Supabase's anon key is designed to work — it is not a secret, it is
-- meant to sit in a client bundle). The access boundary is therefore the
-- *page*, not the database: keep the deployed app behind your hosting
-- provider's password protection. The policies below deliberately allow the
-- anon role to do anything to these two tables. If you add real login later
-- (Supabase Auth), tighten these policies to check auth.uid() instead.

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

drop policy if exists "anon full access" on transactions;
create policy "anon full access" on transactions
  for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "anon full access" on settings;
create policy "anon full access" on settings
  for all
  to anon, authenticated
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
