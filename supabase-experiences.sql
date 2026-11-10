-- ============================================================
-- ISSB ASPIRANTS — Student Experiences section
-- Run this ONCE in Supabase → SQL Editor → New query → Run.
-- (Safe to run again — everything is "if not exists".)
-- ============================================================

create table if not exists public.experiences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  result text not null default 'Initial test cleared'
    check (result in ('Initial test cleared','ISSB recommended','Reappear — preparing again','Still preparing')),
  body text not null check (char_length(body) between 20 and 4000),
  helped_with text not null default '',
  status text not null default 'pending' check (status in ('pending','published','rejected')),
  admin_reply text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists experiences_status_idx on public.experiences(status, created_at);

alter table public.experiences enable row level security;

-- Anyone can READ published stories (and admins can read all).
drop policy if exists "experiences public read" on public.experiences;
create policy "experiences public read" on public.experiences
  for select to anon, authenticated
  using (status = 'published' or user_id = auth.uid() or public.current_user_is_admin());

-- Anyone (even without login) can SUBMIT — but always as 'pending', never published directly.
drop policy if exists "experiences open insert" on public.experiences;
create policy "experiences open insert" on public.experiences
  for insert to anon, authenticated
  with check (status = 'pending' and (user_id is null or user_id = auth.uid()));

-- Only the admin (you) can publish/reject/reply.
drop policy if exists "experiences admin update" on public.experiences;
create policy "experiences admin update" on public.experiences
  for update to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- Only the admin (you) can delete.
drop policy if exists "experiences admin delete" on public.experiences;
create policy "experiences admin delete" on public.experiences
  for delete to authenticated
  using (public.current_user_is_admin());

-- Grants: older "grant ... on all tables" statements do NOT cover new tables,
-- so these explicit grants are required.
grant select, insert on public.experiences to anon;
grant select, insert, update, delete on public.experiences to authenticated;
