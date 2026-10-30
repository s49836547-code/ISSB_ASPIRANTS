-- ISSB ASPIRANTS: initial Supabase schema
-- Run in Supabase SQL Editor. Review policies before production use.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  role text not null default 'student' check (role in ('student','admin','owner')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, full_name, phone, status, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name',''),
    coalesce(new.raw_user_meta_data ->> 'phone',''),
    'pending','student'
  ) on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create table if not exists public.packages (
  id text primary key,
  name text not null,
  description text not null default '',
  price_pkr integer not null check (price_pkr >= 0),
  features jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
insert into public.packages(id,name,description,price_pkr,features,sort_order) values
('verbal','Verbal Intelligence','Practice material for verbal intelligence preparation.',500,'["Verbal practice resources","Access after payment approval","Lifetime access while entitlement remains active"]',1),
('non-verbal','Non-Verbal Intelligence','Visual and non-verbal reasoning preparation materials.',500,'["Non-verbal practice resources","Access after payment approval","Lifetime access while entitlement remains active"]',2),
('academic','Academic Preparation','Core academic preparation materials.',700,'["Academic study resources","Access after payment approval","Lifetime access while entitlement remains active"]',3),
('complete','Complete Preparation','A combined preparation package for the full study journey.',1500,'["Verbal + non-verbal resources","Academic preparation resources","Access after payment approval"]',4)
on conflict (id) do nothing;

create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  category text not null default 'General',
  access_type text not null default 'free' check (access_type in ('free','paid')),
  package_id text references public.packages(id),
  storage_path text not null,
  published boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint paid_resource_has_package check (access_type <> 'paid' or package_id is not null)
);

create table if not exists public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  package_id text not null references public.packages(id),
  active boolean not null default true,
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(user_id, package_id)
);

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  package_id text not null references public.packages(id),
  transaction_ref text not null,
  amount_pkr integer not null check (amount_pkr > 0),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.practice_tests (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'General',
  description text not null default '',
  url text not null check (url like 'https://%'),
  published boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  published boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  subject text not null,
  message text not null,
  status text not null default 'new' check (status in ('new','read','closed')),
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id),
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.current_user_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('owner','admin'));
$$;
create or replace function public.current_user_is_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'owner');
$$;

-- Student status can only be changed through this guarded function.
create or replace function public.admin_set_student_status(target_user_id uuid, new_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid());
begin
  if not public.current_user_is_admin() then raise exception 'Admin access required'; end if;
  if new_status not in ('approved','rejected','pending') then raise exception 'Invalid status'; end if;
  if exists(select 1 from public.profiles where id=target_user_id and role in ('owner','admin')) then raise exception 'Cannot change staff status through this function'; end if;
  if new_status='approved' and not exists(select 1 from auth.users where id=target_user_id and email_confirmed_at is not null) then raise exception 'Student email must be verified before approval'; end if;
  update public.profiles set status=new_status, updated_at=now() where id=target_user_id and role='student';
  if not found then raise exception 'Student account not found'; end if;
  insert into public.audit_logs(actor_id,action,target_type,target_id,details)
  values(actor,'student_status_changed','profile',target_user_id::text,jsonb_build_object('status',new_status));
end;
$$;

-- Payment approval grants package entitlement only after the reviewer explicitly approves.
create or replace function public.admin_review_payment(target_payment_id uuid, new_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); p public.payment_requests%rowtype; package_price integer;
begin
  if not public.current_user_is_admin() then raise exception 'Admin access required'; end if;
  if new_status not in ('approved','rejected') then raise exception 'Invalid payment status'; end if;
  select * into p from public.payment_requests where id=target_payment_id for update;
  if not found then raise exception 'Payment request not found'; end if;
  if p.status <> 'pending' then raise exception 'This payment request has already been reviewed'; end if;
  select price_pkr into package_price from public.packages where id=p.package_id and active=true;
  if new_status='approved' then
    if package_price is null or package_price <> p.amount_pkr then raise exception 'Package price mismatch; verify manually'; end if;
    if not exists(select 1 from public.profiles where id=p.user_id and status='approved') then raise exception 'Student account is not approved'; end if;
    insert into public.entitlements(user_id,package_id,active,granted_by) values(p.user_id,p.package_id,true,actor)
    on conflict(user_id,package_id) do update set active=true,granted_by=excluded.granted_by;
  end if;
  update public.payment_requests set status=new_status, reviewed_by=actor, reviewed_at=now() where id=p.id;
  insert into public.audit_logs(actor_id,action,target_type,target_id,details)
  values(actor,'payment_'||new_status,'payment_request',p.id::text,jsonb_build_object('user_id',p.user_id,'package_id',p.package_id,'amount_pkr',p.amount_pkr));
end;
$$;

alter table public.profiles enable row level security;
alter table public.packages enable row level security;
alter table public.resources enable row level security;
alter table public.entitlements enable row level security;
alter table public.payment_requests enable row level security;
alter table public.practice_tests enable row level security;
alter table public.announcements enable row level security;
alter table public.contact_messages enable row level security;
alter table public.audit_logs enable row level security;

-- Profiles: users may read/update only their own non-privileged fields. Role/status are not client-editable.
drop policy if exists "profile select own or admin" on public.profiles;
create policy "profile select own or admin" on public.profiles for select to authenticated using (id=(select auth.uid()) or public.current_user_is_admin());
-- No client-side profile UPDATE policy: role and approval status must not be user-editable.
drop policy if exists "profile update own contact fields" on public.profiles;
drop policy if exists "admin manage profiles" on public.profiles;
create policy "admin manage profiles" on public.profiles for select to authenticated using (public.current_user_is_admin());

-- Public catalogue only; no file bytes or storage paths are exposed in this catalogue API policy.
drop policy if exists "public read active packages" on public.packages;
create policy "public read active packages" on public.packages for select to anon, authenticated using (active=true or public.current_user_is_admin());
drop policy if exists "admin manage packages" on public.packages;
create policy "admin manage packages" on public.packages for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());
drop policy if exists "read published resource metadata" on public.resources;
create policy "read published resource metadata" on public.resources for select to authenticated using (published=true and (access_type='free' or public.current_user_is_admin() or exists(select 1 from public.entitlements e where e.user_id=(select auth.uid()) and e.package_id=resources.package_id and e.active=true)) or public.current_user_is_admin());
drop policy if exists "admin manage resources" on public.resources;
create policy "admin manage resources" on public.resources for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());
drop policy if exists "read own entitlements" on public.entitlements;
create policy "read own entitlements" on public.entitlements for select to authenticated using (user_id=(select auth.uid()) or public.current_user_is_admin());
drop policy if exists "admin manage entitlements" on public.entitlements;
create policy "admin manage entitlements" on public.entitlements for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());
drop policy if exists "student submit own payment request" on public.payment_requests;
create policy "student submit own payment request" on public.payment_requests for insert to authenticated with check (user_id=(select auth.uid()) and status='pending' and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='approved') and exists(select 1 from public.packages k where k.id=package_id and k.active=true and k.price_pkr=amount_pkr));
drop policy if exists "read own payments or admin" on public.payment_requests;
create policy "read own payments or admin" on public.payment_requests for select to authenticated using (user_id=(select auth.uid()) or public.current_user_is_admin());
drop policy if exists "read published tests" on public.practice_tests;
create policy "read published tests" on public.practice_tests for select to anon, authenticated using (published=true or public.current_user_is_admin());
drop policy if exists "admin manage tests" on public.practice_tests;
create policy "admin manage tests" on public.practice_tests for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());
drop policy if exists "read published announcements" on public.announcements;
create policy "read published announcements" on public.announcements for select to anon, authenticated using (published=true or public.current_user_is_admin());
drop policy if exists "admin manage announcements" on public.announcements;
create policy "admin manage announcements" on public.announcements for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());
drop policy if exists "public submit contact messages" on public.contact_messages;
create policy "public submit contact messages" on public.contact_messages for insert to anon, authenticated with check (length(name) between 1 and 100 and length(email) between 3 and 254 and length(subject) between 1 and 150 and length(message) between 1 and 3000);
drop policy if exists "admin read and manage contact messages" on public.contact_messages;
create policy "admin read and manage contact messages" on public.contact_messages for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());
drop policy if exists "admin read audit logs" on public.audit_logs;
create policy "admin read audit logs" on public.audit_logs for select to authenticated using (public.current_user_is_admin());

-- Private storage bucket for PDFs. Create a bucket with this exact ID, or run the insert below.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('private-notes','private-notes',false,52428800,array['application/pdf'])
on conflict(id) do update set public=false, file_size_limit=52428800, allowed_mime_types=array['application/pdf'];
drop policy if exists "approved users can read eligible PDFs" on storage.objects;
create policy "approved users can read eligible PDFs" on storage.objects for select to authenticated using (
  bucket_id='private-notes' and exists(
    select 1 from public.resources r join public.profiles p on p.id=(select auth.uid())
    where r.storage_path=name and r.published=true and p.status='approved'
    and (r.access_type='free' or public.current_user_is_admin() or exists(
      select 1 from public.entitlements e where e.user_id=(select auth.uid()) and e.package_id=r.package_id and e.active=true
    ))
  )
);
drop policy if exists "admins upload update delete PDFs" on storage.objects;
create policy "admins upload update delete PDFs" on storage.objects for all to authenticated using (bucket_id='private-notes' and public.current_user_is_admin()) with check (bucket_id='private-notes' and public.current_user_is_admin());

-- IMPORTANT OWNER SETUP (after your account has been registered and email verified):
-- Run this manually in SQL Editor, replacing the email with YOUR owner account email.
-- update public.profiles p set role='owner', status='approved'
-- from auth.users u where p.id=u.id and lower(u.email)=lower('YOUR-OWNER-EMAIL');
-- Do not expose the service_role key or database password in browser code or GitHub.
