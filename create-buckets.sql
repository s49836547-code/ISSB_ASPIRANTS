-- ============================================================
-- STANDALONE: create the two private storage buckets.
-- Run ONLY this file in Supabase Dashboard -> SQL Editor -> Run.
-- It prints a result table at the end so you can SEE whether it worked.
-- Safe to re-run.
-- ============================================================

-- Re-running setup preserves an existing bucket's MIME allowlist.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('private-notes', 'private-notes', false, 52428800, array[
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
])
on conflict (id) do update
  set public = false,
      file_size_limit = 52428800;

-- 2) payment-receipts : receipt image/PDF uploaded by a student
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-receipts', 'payment-receipts', false, 8388608,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = 8388608,
      allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf'];

-- 3) VERIFY: this should return 2 rows (private-notes, payment-receipts).
--    Look at the Results panel below the Run button.
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('private-notes', 'payment-receipts')
order by id;
