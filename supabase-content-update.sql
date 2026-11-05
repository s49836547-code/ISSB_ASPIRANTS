-- ============================================================
-- CONTENT UPDATE  (run once, Supabase Dashboard -> SQL Editor)
-- ============================================================
-- Adds the tables behind four new site features:
--   1. guides          -> Guidance centre. Two separate interview-attire galleries
--                         ('formal-suit' and 'shalwar-kameez'), each with its own
--                         pictures, plus 'video-guidance', 'interview-tips',
--                         'information' and 'call' entries. All managed from the
--                         admin portal.
--   2. reviews         -> Student experience/review section with academy reply.
--   3. threads +
--      thread_messages -> Response panel: two-way conversation between a student
--                         and the admin/owner.
--   4. guidance-media  -> PUBLIC storage bucket for guide pictures and videos.
--
-- IF IT FAILS: look at the error line number. Sections 1-5 are ordinary tables
-- and can be re-run safely. If only the upload gives "Bucket not found", re-run
-- SECTION 6 ON ITS OWN in a fresh SQL Editor query — the SQL Editor aborts the
-- whole script at the first error, so a failure above silently skips the bucket.
--
-- Announcements already existed (public.announcements); the site now shows them
-- in a ticker on every page, which needs no schema change.
--
-- NOTE ON GRANTS: the older scripts used
-- "grant ... on all tables in schema public", which does NOT apply to tables
-- created afterwards. So explicit grants are included below — without them RLS
-- would pass but every query would fail with "permission denied".
--
-- Safe to re-run: every statement uses IF NOT EXISTS / OR REPLACE / DO NOTHING.
-- Bucket inserts must stay in this standalone file (a big combined script can
-- abort before reaching them).
-- ============================================================

-- ------------------------------------------------------------
-- 1) GUIDES (Guidance centre)
-- ------------------------------------------------------------
create table if not exists public.guides (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'other',
  summary text not null default '',
  points text[] not null default '{}',
  image_url text not null default '',
  image_urls text[] not null default '{}',
  video_url text not null default '',
  published boolean not null default false,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- For databases where guides already exists from an earlier run.
alter table public.guides add column if not exists image_urls text[] not null default '{}';
create index if not exists guides_published_idx on public.guides(published, sort_order);
create index if not exists guides_category_idx on public.guides(category, sort_order);

alter table public.guides enable row level security;
drop policy if exists "guides public read" on public.guides;
create policy "guides public read" on public.guides for select
  to anon, authenticated
  using (published = true or public.current_user_is_admin());
drop policy if exists "guides admin write" on public.guides;
create policy "guides admin write" on public.guides for all
  to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- ------------------------------------------------------------
-- 2) REVIEWS (student experience section)
-- ------------------------------------------------------------
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null default '',
  rating integer not null default 5 check (rating between 1 and 5),
  body text not null,
  context text not null default 'Initial test',
  status text not null default 'pending' check (status in ('pending','published','rejected')),
  admin_reply text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists reviews_status_idx on public.reviews(status, created_at);

alter table public.reviews enable row level security;
drop policy if exists "reviews public read" on public.reviews;
create policy "reviews public read" on public.reviews for select
  to anon, authenticated
  using (status = 'published' or user_id = auth.uid() or public.current_user_is_admin());
-- A student can only ever create their own review, and it always starts as pending.
drop policy if exists "reviews student insert" on public.reviews;
create policy "reviews student insert" on public.reviews for insert
  to authenticated
  with check (user_id = auth.uid() and status = 'pending');
drop policy if exists "reviews student edit own" on public.reviews;
create policy "reviews student edit own" on public.reviews for update
  to authenticated
  using (user_id = auth.uid() and status <> 'published')
  with check (user_id = auth.uid() and status = 'pending');
drop policy if exists "reviews student delete own" on public.reviews;
create policy "reviews student delete own" on public.reviews for delete
  to authenticated
  using (user_id = auth.uid());
drop policy if exists "reviews admin moderate" on public.reviews;
create policy "reviews admin moderate" on public.reviews for all
  to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- ------------------------------------------------------------
-- 3) RESPONSE PANEL (threads + messages)
-- ------------------------------------------------------------
create table if not exists public.threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null,
  status text not null default 'open' check (status in ('open','closed')),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists threads_user_idx on public.threads(user_id, last_message_at);

create table if not exists public.thread_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  sender_id uuid references auth.users(id),
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists thread_messages_thread_idx on public.thread_messages(thread_id, created_at);

-- No sender_role column on purpose: who is speaking is derived from the thread
-- owner, so a student can never forge an "admin" label.
alter table public.threads enable row level security;
alter table public.thread_messages enable row level security;

drop policy if exists "threads read" on public.threads;
create policy "threads read" on public.threads for select
  to authenticated
  using (user_id = auth.uid() or public.current_user_is_admin());
drop policy if exists "threads student create" on public.threads;
create policy "threads student create" on public.threads for insert
  to authenticated
  with check (user_id = auth.uid());
drop policy if exists "threads update" on public.threads;
create policy "threads update" on public.threads for update
  to authenticated
  using (user_id = auth.uid() or public.current_user_is_admin());
drop policy if exists "threads admin delete" on public.threads;
create policy "threads admin delete" on public.threads for delete
  to authenticated
  using (public.current_user_is_admin());

drop policy if exists "messages read" on public.thread_messages;
create policy "messages read" on public.thread_messages for select
  to authenticated
  using (exists (select 1 from public.threads t
                  where t.id = thread_id
                    and (t.user_id = auth.uid() or public.current_user_is_admin())));
drop policy if exists "messages write" on public.thread_messages;
create policy "messages write" on public.thread_messages for insert
  to authenticated
  with check (sender_id = auth.uid()
              and exists (select 1 from public.threads t
                           where t.id = thread_id
                             and (t.user_id = auth.uid() or public.current_user_is_admin())));
drop policy if exists "messages admin delete" on public.thread_messages;
create policy "messages admin delete" on public.thread_messages for delete
  to authenticated
  using (public.current_user_is_admin());

-- Keep threads.last_message_at fresh so the inbox sorts correctly.
create or replace function public.touch_thread_last_message()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.threads set last_message_at = now() where id = new.thread_id;
  return new;
end; $$;
drop trigger if exists trg_thread_messages_touch on public.thread_messages;
create trigger trg_thread_messages_touch after insert on public.thread_messages
for each row execute procedure public.touch_thread_last_message();

-- ------------------------------------------------------------
-- 4) updated_at trigger for guides
-- ------------------------------------------------------------
-- Defined here too, so this file does not depend on supabase-schema-v2.sql
-- having been run first.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_guides_touch on public.guides;
create trigger trg_guides_touch before update on public.guides
for each row execute procedure public.touch_updated_at();

-- ------------------------------------------------------------
-- 5) GRANTS (required for tables created after the original script)
-- ------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant select on public.guides to anon;
grant select on public.reviews to anon;
grant select, insert, update, delete on public.guides to authenticated;
grant select, insert, update, delete on public.reviews to authenticated;
grant select, insert, update, delete on public.threads to authenticated;
grant select, insert, update, delete on public.thread_messages to authenticated;
grant all on public.guides, public.reviews, public.threads, public.thread_messages to service_role;

-- ------------------------------------------------------------
-- 6) PUBLIC media bucket for guide pictures and videos
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('guidance-media', 'guidance-media', true, 52428800,
        array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm'])
on conflict (id) do update set public = true;

drop policy if exists "guidance media public read" on storage.objects;
create policy "guidance media public read" on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'guidance-media');
drop policy if exists "guidance media admin write" on storage.objects;
create policy "guidance media admin write" on storage.objects for all
  to authenticated
  using (bucket_id = 'guidance-media' and public.current_user_is_admin())
  with check (bucket_id = 'guidance-media' and public.current_user_is_admin());

-- ------------------------------------------------------------
-- Verify (optional): run these after applying
-- ------------------------------------------------------------
-- select id,name,public from storage.buckets;
-- select table_name from information_schema.tables
--  where table_schema='public' and table_name in ('guides','reviews','threads','thread_messages');
