-- ============================================================
-- ISSB ASPIRANTS — allow notes in ANY common format
-- Run this ONCE in Supabase → SQL Editor → New query → Run.
-- (Safe to run again — it only updates one bucket row.)
--
-- Until this is run, the private-notes bucket accepts PDF only,
-- so Word / PowerPoint / Excel / text / picture uploads are
-- rejected by the server even though the website accepts them.
-- ============================================================

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
