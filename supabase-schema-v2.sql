-- ISSB ASPIRANTS — Schema Migration v2 (ADDITIVE)
-- Run this in the Supabase SQL Editor AFTER supabase-schema.sql.
-- It does NOT drop tables or delete data. It upgrades the database to match the
-- master specification: suspended accounts, resource subject/file_type/preview,
-- package<->resource many-to-many, package publish states, payment snapshot,
-- configurable site settings, and guarded entitlement management.
-- Safe to re-run: every statement is idempotent.

create extension if not exists pgcrypto;

-- ============================================================
-- 1) PROFILES: allow the 'suspended' status (spec sections 6, 7, 10)
-- ============================================================
alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check
  check (status in ('pending','approved','rejected','suspended'));

-- ============================================================
-- 2) RESOURCES: subject, file_type, preview flag, updated_at (spec sections 11, 14)
-- ============================================================
alter table public.resources add column if not exists subject     text        not null default '';
alter table public.resources add column if not exists file_type   text        not null default 'pdf';
alter table public.resources add column if not exists is_preview  boolean     not null default false;
alter table public.resources add column if not exists updated_at  timestamptz not null default now();
create index if not exists idx_resources_category   on public.resources(category);
create index if not exists idx_resources_subject    on public.resources(subject);
create index if not exists idx_resources_access     on public.resources(access_type);

-- ============================================================
-- 3) PACKAGES: publish state (draft/published/archived) + updated_at (spec section 8)
--    'active' is kept for backward compatibility and auto-synced from 'status'.
-- ============================================================
alter table public.packages add column if not exists updated_at timestamptz not null default now();
alter table public.packages add column if not exists status text not null default 'published';
alter table public.packages drop constraint if exists packages_status_check;
alter table public.packages add constraint packages_status_check
  check (status in ('draft','published','archived'));
-- Backfill status from the legacy active flag.
update public.packages set status = case when active then 'published' else 'draft' end;

create or replace function public.sync_package_active()
returns trigger language plpgsql as $$
begin
  new.active := (new.status = 'published');
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists trg_sync_package_active on public.packages;
create trigger trg_sync_package_active before insert or update on public.packages
for each row execute procedure public.sync_package_active();

-- ============================================================
-- 4) PACKAGE_RESOURCES: many-to-many link (spec section 14)
--    Supports multiple resources per package and a resource shared across packages.
-- ============================================================
create table if not exists public.package_resources (
  package_id  text        not null references public.packages(id)  on delete cascade,
  resource_id uuid        not null references public.resources(id) on delete cascade,
  is_preview  boolean     not null default false,
  created_at  timestamptz not null default now(),
  primary key (package_id, resource_id)
);
create index if not exists idx_package_resources_resource on public.package_resources(resource_id);

-- Backfill from the legacy single-package column so existing data keeps working.
insert into public.package_resources(package_id, resource_id, is_preview)
select r.package_id, r.id, r.is_preview
from public.resources r
where r.package_id is not null
on conflict (package_id, resource_id) do nothing;

alter table public.package_resources enable row level security;
drop policy if exists "read package_resources" on public.package_resources;
create policy "read package_resources" on public.package_resources
  for select to authenticated using (true);
drop policy if exists "admin manage package_resources" on public.package_resources;
create policy "admin manage package_resources" on public.package_resources
  for all to authenticated
  using (public.current_user_is_admin()) with check (public.current_user_is_admin());

-- ============================================================
-- 5) PAYMENT_REQUESTS: snapshot the package name at request time (spec section 10)
-- ============================================================
alter table public.payment_requests add column if not exists package_name_snapshot text not null default '';
update public.payment_requests pr
   set package_name_snapshot = p.name
  from public.packages p
 where pr.package_id = p.id and pr.package_name_snapshot = '';

-- ============================================================
-- 6) SITE_SETTINGS: configurable academy info (spec sections 2, 13G)
--    Public/authenticated may READ; only admins may WRITE. Never store secrets here.
-- ============================================================
create table if not exists public.site_settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.site_settings enable row level security;
drop policy if exists "read site settings" on public.site_settings;
create policy "read site settings" on public.site_settings
  for select to anon, authenticated using (true);
drop policy if exists "admin manage site settings" on public.site_settings;
create policy "admin manage site settings" on public.site_settings
  for all to authenticated
  using (public.current_user_is_admin()) with check (public.current_user_is_admin());

insert into public.site_settings(key, value) values
  ('contact', jsonb_build_object(
      'whatsapp','03319824359',
      'easypaisa','03472433655',
      'channel_url','https://whatsapp.com/channel/0029VbBqGMj8qIzjSRWwHr1V')),
  ('contributors', jsonb_build_array(
      jsonb_build_object('name','Ahmad','role','Study material contributor & WhatsApp channel operator','bio',''),
      jsonb_build_object('name','Najeebullah','role','Study material contributor & WhatsApp channel operator','bio',''))),
  ('payment_instructions', jsonb_build_object(
      'text','Send the exact package amount via EasyPaisa to 03472433655, then submit your transaction reference (TID) below. Never send your EasyPaisa PIN or password.'))
on conflict (key) do nothing;

-- ============================================================
-- 7) updated_at auto-touch triggers
-- ============================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch before update on public.profiles
for each row execute procedure public.touch_updated_at();
drop trigger if exists trg_resources_touch on public.resources;
create trigger trg_resources_touch before update on public.resources
for each row execute procedure public.touch_updated_at();

-- ============================================================
-- 8) Guarded admin functions
-- ============================================================

-- 8a) Student status now supports suspend/restore. A suspended student instantly
--     loses protected access because every storage/resource policy requires status='approved'.
-- NOTE (2026-11-03): the email_confirmed_at check below has been REMOVED on the live
--     database. See supabase-approval-fix.sql, which is the current version of this
--     function and also adds public.admin_student_emails(). Do not re-run this block.
create or replace function public.admin_set_student_status(target_user_id uuid, new_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid());
begin
  if not public.current_user_is_admin() then raise exception 'Admin access required'; end if;
  if new_status not in ('approved','rejected','pending','suspended') then raise exception 'Invalid status'; end if;
  if exists(select 1 from public.profiles where id=target_user_id and role in ('owner','admin')) then
    raise exception 'Cannot change staff status through this function'; end if;
  if new_status='approved' and not exists(
      select 1 from auth.users where id=target_user_id and email_confirmed_at is not null) then
    raise exception 'Student email must be verified before approval'; end if;
  update public.profiles set status=new_status, updated_at=now()
   where id=target_user_id and role='student';
  if not found then raise exception 'Student account not found'; end if;
  insert into public.audit_logs(actor_id,action,target_type,target_id,details)
  values(actor,'student_status_changed','profile',target_user_id::text,
         jsonb_build_object('status',new_status));
end; $$;

-- 8b) Grant or revoke a package entitlement, with an audit-log entry (spec sections 10, 15).
create or replace function public.admin_set_entitlement(target_user_id uuid, target_package_id text, make_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid());
begin
  if not public.current_user_is_admin() then raise exception 'Admin access required'; end if;
  if not exists(select 1 from public.packages where id=target_package_id) then raise exception 'Unknown package'; end if;
  if not exists(select 1 from public.profiles where id=target_user_id) then raise exception 'Unknown user'; end if;
  insert into public.entitlements(user_id,package_id,active,granted_by)
  values(target_user_id,target_package_id,make_active,actor)
  on conflict(user_id,package_id) do update set active=make_active, granted_by=actor;
  insert into public.audit_logs(actor_id,action,target_type,target_id,details)
  values(actor, case when make_active then 'entitlement_granted' else 'entitlement_revoked' end,
         'entitlement', target_user_id::text, jsonb_build_object('package_id',target_package_id));
end; $$;

-- 8c) Server-side authorization check + path release for a download.
--     Returns the storage path ONLY if the caller is eligible; otherwise raises.
--     This prevents unentitled users from enumerating private file paths (spec section 11).
create or replace function public.authorized_resource_path(resource_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); r public.resources%rowtype; ok boolean := false; approved boolean;
begin
  select * into r from public.resources where id = resource_id and published = true;
  if not found then raise exception 'Resource not found'; end if;
  select exists(select 1 from public.profiles where id=uid and status='approved') into approved;
  if public.current_user_is_admin() then
    ok := true;
  elsif r.access_type = 'free' then
    ok := approved;
  else
    ok := approved and (
      exists(select 1 from public.entitlements e
              where e.user_id=uid and e.active=true
                and (e.package_id = r.package_id
                     or exists(select 1 from public.package_resources pr
                                where pr.resource_id = r.id and pr.package_id = e.package_id)))
    );
  end if;
  if not ok then raise exception 'Not authorized for this resource'; end if;
  return r.storage_path;
end; $$;

-- ============================================================
-- 9) Rewrite resource + storage read policies for many-to-many access.
--    Paid resource metadata stays hidden until the student is entitled (no enumeration).
--    Suspended/pending/rejected accounts are excluded because storage requires status='approved'.
-- ============================================================
drop policy if exists "read published resource metadata" on public.resources;
create policy "read published resource metadata" on public.resources for select to authenticated using (
  public.current_user_is_admin()
  or (
    published = true
    and (
      access_type = 'free'
      or exists(
        select 1 from public.entitlements e
        where e.user_id = (select auth.uid()) and e.active = true
          and (e.package_id = resources.package_id
               or exists(select 1 from public.package_resources pr
                          where pr.resource_id = resources.id and pr.package_id = e.package_id))
      )
    )
  )
);

-- Logged-out visitors may see ONLY free published note metadata (titles/descriptions),
-- never paid notes. Paid notes stay invisible until a student owns the package.
drop policy if exists "public read free resource metadata" on public.resources;
create policy "public read free resource metadata" on public.resources
  for select to anon
  using (published = true and access_type = 'free');

-- ============================================================
-- 9a) PRIVATE STORAGE BUCKET for PDFs (FIX for "notes upload" failing).
--     The uploader writes to db.storage.from('private-notes'); if this bucket does not
--     exist the upload throws "Bucket not found" before the row is ever saved.
--     Idempotent: safe to re-run. Private (public = false), 50 MB cap, PDF only.
-- ============================================================
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values('private-notes', 'private-notes', false, 52428800, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = 52428800,
      allowed_mime_types = array['application/pdf'];

-- Admins may upload/replace/delete inside the bucket; the read policy below gates downloads.
drop policy if exists "admins upload update delete PDFs" on storage.objects;
create policy "admins upload update delete PDFs" on storage.objects for all to authenticated
  using (bucket_id = 'private-notes' and public.current_user_is_admin())
  with check (bucket_id = 'private-notes' and public.current_user_is_admin());

drop policy if exists "approved users can read eligible PDFs" on storage.objects;
create policy "approved users can read eligible PDFs" on storage.objects for select to authenticated using (
  bucket_id = 'private-notes' and exists(
    select 1 from public.resources r
    join public.profiles p on p.id = (select auth.uid())
    where r.storage_path = name and r.published = true and p.status = 'approved'
      and (
        r.access_type = 'free'
        or public.current_user_is_admin()
        or exists(
          select 1 from public.entitlements e
          where e.user_id = (select auth.uid()) and e.active = true
            and (e.package_id = r.package_id
                 or exists(select 1 from public.package_resources pr
                            where pr.resource_id = r.id and pr.package_id = e.package_id))
        )
      )
  )
);

-- ============================================================
-- 10) GRANTs (FIX for "permission denied for table entitlements / payment_requests").
--     Row Level Security still decides WHICH rows a caller can see; these grants only
--     let the query REACH the RLS layer. Without them, Postgres rejects the query
--     before RLS even runs. This matches Supabase's own default-privileges model.
--     Safe to re-run: GRANT is idempotent (re-granting does nothing harmful).
-- ============================================================
grant usage on schema public to anon, authenticated, service_role;

-- anon (logged-out visitors) may only READ the public catalog tables.
grant select on public.packages to anon;
grant select on public.resources to anon;
grant select on public.announcements to anon;
grant select on public.site_settings to anon;
grant select on public.package_resources to anon;

-- authenticated (signed-in students/staff) may read + write within their own RLS rules.
grant select, insert, update, delete on all tables in schema public to authenticated;

-- service_role (backend/admin only — never exposed to the browser) gets full access.
grant all on all tables in schema public to service_role;

grant usage, select on all sequences in schema public to authenticated, service_role;

-- Apply the same privileges automatically to any table created from now on.
alter default privileges in schema public grant select on tables to anon;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;

-- ============================================================
-- 11) PAYMENT RECEIPT UPLOADS (Issue B).
--     Students attach a screenshot/PDF of their EasyPaisa receipt when requesting a
--     package. The file goes to a PRIVATE 'payment-receipts' bucket under a folder
--     named with the student's own uid; the owner/admin reviews it in the Payments tab.
--     Safe to re-run.
-- ============================================================
alter table public.payment_requests add column if not exists receipt_path text;
alter table public.payment_requests add column if not exists receipt_mime text;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values('payment-receipts', 'payment-receipts', false, 8388608,
       array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = 8388608,
      allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf'];

-- A student may upload a receipt only into their own <uid>/ folder, and only if approved.
drop policy if exists "student upload own receipt" on storage.objects;
create policy "student upload own receipt" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists(select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'approved')
  );

-- Owner/admin can read any receipt; a student can read back only their own.
drop policy if exists "read payment receipts" on storage.objects;
create policy "read payment receipts" on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-receipts'
    and (public.current_user_is_admin() or (storage.foldername(name))[1] = (select auth.uid())::text)
  );

-- ============================================================
-- DONE. After running this:
--  * Owner role assignment is still the manual SQL at the bottom of supabase-schema.sql.
--  * The frontend (app.js) must be updated to use subject/file_type, the many-to-many
--    link, package status, suspended handling, and authorized_resource_path() for downloads.
-- ============================================================
