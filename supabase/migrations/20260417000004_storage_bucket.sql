-- Private bucket for call recordings.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'call-recordings',
  'call-recordings',
  false,
  524288000,  -- 500 MB
  array['audio/wav','audio/x-wav','audio/mpeg','audio/mp3']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Deny all anon+authenticated access via Storage RLS; service_role bypasses.
-- (Not creating any policies == deny by default with RLS enabled.)
