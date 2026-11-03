-- ============================================================
-- APPROVAL FIX  (run once, in Supabase Dashboard -> SQL Editor)
-- ============================================================
-- Problem: students registered but never clicked the link in the verification
-- email, so the database refused every approval
-- ("Student email must be verified before approval") and they never got access.
--
-- This patch does two things:
--   1. Replaces admin_set_student_status WITHOUT the email check, so the owner
--      can approve a student straight from the admin portal. Approval alone now
--      grants notes access (every storage/resource policy only requires
--      status = 'approved', never email verification).
--   2. Adds admin_student_emails(), an admin-only lookup that lets the admin
--      panel show each student's email and whether it is verified, so you know
--      who still needs a WhatsApp reminder.
--
-- Safe to re-run: both statements are CREATE OR REPLACE.
-- ============================================================

-- 1) Approval no longer requires a verified email --------------------------
create or replace function public.admin_set_student_status(target_user_id uuid, new_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid());
begin
  if not public.current_user_is_admin() then raise exception 'Admin access required'; end if;
  if new_status not in ('approved','rejected','pending','suspended') then raise exception 'Invalid status'; end if;
  if exists(select 1 from public.profiles where id=target_user_id and role in ('owner','admin')) then
    raise exception 'Cannot change staff status through this function'; end if;
  update public.profiles set status=new_status, updated_at=now()
   where id=target_user_id and role='student';
  if not found then raise exception 'Student account not found'; end if;
  insert into public.audit_logs(actor_id,action,target_type,target_id,details)
  values(actor,'student_status_changed','profile',target_user_id::text,
         jsonb_build_object('status',new_status));
end; $$;

-- 2) Admin-only view of email + verification state --------------------------
-- Returns zero rows for anyone who is not owner/admin, so no email address can
-- leak to a normal student.
create or replace function public.admin_student_emails()
returns table(user_id uuid, email text, email_verified boolean)
language sql stable security definer set search_path = '' as $$
  select u.id, u.email, (u.email_confirmed_at is not null)
    from auth.users u
   where public.current_user_is_admin();
$$;

grant execute on function public.admin_set_student_status(uuid, text) to authenticated;
grant execute on function public.admin_student_emails() to authenticated;

-- ============================================================
-- OPTIONAL but strongly recommended (dashboard click, not SQL)
-- ============================================================
-- Authentication -> Providers -> Email -> turn OFF "Confirm email".
-- Why: while that toggle is ON, Supabase does not give a brand-new student a
-- session at all, so an unverified student cannot even log in to see the notes
-- you just approved. Turning it OFF means: register -> log in immediately ->
-- access as soon as you press Approve. Email verification becomes optional.
-- ============================================================
