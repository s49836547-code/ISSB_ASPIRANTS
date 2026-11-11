-- Run in Supabase SQL Editor; safe to repeat without changing notes, files or existing replies.
begin;

drop policy if exists "experiences open insert" on public.experiences;
create policy "experiences open insert" on public.experiences
  for insert to anon, authenticated
  with check (status = 'pending' and admin_reply = '' and (user_id is null or user_id = auth.uid()));

drop policy if exists "reviews student insert" on public.reviews;
create policy "reviews student insert" on public.reviews for insert
  to authenticated
  with check (user_id = auth.uid() and status = 'pending' and admin_reply = '');

-- Preserve genuine replies when students edit their own pending review.
create or replace function public.protect_review_admin_reply()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.admin_reply is distinct from old.admin_reply and not public.current_user_is_admin() then
    raise exception 'Only academy admins can change review replies.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_review_admin_reply on public.reviews;
create trigger protect_review_admin_reply before update on public.reviews
  for each row execute function public.protect_review_admin_reply();

update storage.buckets
   set allowed_mime_types = array[
         'application/pdf',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.ms-powerpoint',
         'application/vnd.openxmlformats-officedocument.presentationml.presentation',
         'application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'text/plain',
         'text/markdown',
         'image/png',
         'image/jpeg',
         'image/webp'
       ],
       file_size_limit = 52428800
 where id = 'private-notes';

commit;
