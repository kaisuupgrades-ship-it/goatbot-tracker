-- GOAT BOT Tracker — Supabase Schema
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor > New query)

-- Enable UUID extension (usually already enabled)
create extension if not exists "uuid-ossp";

-- ─────────────────────────────────────────────────────────────
-- CONTESTS TABLE
-- ─────────────────────────────────────────────────────────────
create table if not exists contests (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  name        text not null default 'Pick of the Day Contest',
  start_date  date not null default current_date,
  bankroll    numeric(12, 2) default 100,
  is_public   boolean default false,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique(user_id)  -- one active contest per user (can be changed later)
);

-- ─────────────────────────────────────────────────────────────
-- PICKS TABLE
-- ─────────────────────────────────────────────────────────────
create table if not exists picks (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  contest_id  uuid references contests(id) on delete set null,
  date        date not null,
  day_number  integer,
  sport       text not null,
  team        text not null,
  bet_type    text default 'Moneyline',
  matchup     text,
  odds        integer not null,
  book        text,
  result      text check (result in ('WIN', 'LOSS', 'PUSH', 'PENDING')) default 'PENDING',
  profit      numeric(10, 3),
  notes       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY (RLS) — users only see their own data
-- ─────────────────────────────────────────────────────────────
alter table contests enable row level security;
alter table picks enable row level security;

-- Contests policies
create policy "Users can view own contests"
  on contests for select using (auth.uid() = user_id);

create policy "Users can insert own contests"
  on contests for insert with check (auth.uid() = user_id);

create policy "Users can update own contests"
  on contests for update using (auth.uid() = user_id);

create policy "Users can delete own contests"
  on contests for delete using (auth.uid() = user_id);

-- Picks policies
create policy "Users can view own picks"
  on picks for select using (auth.uid() = user_id);

create policy "Users can insert own picks"
  on picks for insert with check (auth.uid() = user_id);

create policy "Users can update own picks"
  on picks for update using (auth.uid() = user_id);

create policy "Users can delete own picks"
  on picks for delete using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- INDEXES for performance
-- ─────────────────────────────────────────────────────────────
create index if not exists picks_user_id_idx on picks(user_id);
create index if not exists picks_date_idx on picks(date);
create index if not exists picks_result_idx on picks(result);
create index if not exists contests_user_id_idx on contests(user_id);

-- ─────────────────────────────────────────────────────────────
-- AUTO-UPDATE updated_at timestamps
-- ─────────────────────────────────────────────────────────────
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger update_contests_updated_at
  before update on contests
  for each row execute function update_updated_at_column();

create trigger update_picks_updated_at
  before update on picks
  for each row execute function update_updated_at_column();

-- ─────────────────────────────────────────────────────────────
-- OPTIONAL: Seed your existing picks (run after setup)
-- ─────────────────────────────────────────────────────────────
-- Replace 'YOUR-USER-UUID' with your actual user UUID from Supabase Auth dashboard
-- insert into contests (user_id, name, start_date, bankroll)
-- values ('YOUR-USER-UUID', 'Pick of the Day 2026', '2026-04-01', 100);
--
-- insert into picks (user_id, date, day_number, sport, team, bet_type, matchup, odds, book, result, profit, notes)
-- values
--   ('YOUR-USER-UUID', '2026-04-02', 2, 'MLB', 'Atlanta Braves', 'Moneyline', 'ATL Braves at ARI Diamondbacks', -118, 'FanDuel', 'WIN', 0.847, 'Reynaldo Lopez vs Ryne Nelson — clean pitching mismatch'),
--   ('YOUR-USER-UUID', '2026-04-03', 3, 'MLB', 'Pittsburgh Pirates', 'Moneyline', 'BAL Orioles at PIT Pirates', 105, 'FanDuel', 'WIN', 1.050, 'Mitch Keller home opener, Konnor Griffin debut, BAL depleted');
