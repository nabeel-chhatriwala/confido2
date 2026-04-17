-- Reject non-@confido.health sign-ups as defense-in-depth.
-- Primary enforcement is the Google OAuth hd= parameter.

create or replace function internal.enforce_confido_email() returns trigger
  language plpgsql security definer set search_path = auth, pg_temp as $$
begin
  if new.email is null or lower(new.email) !~ '@confido\.health$' then
    raise exception 'Sign-up blocked: only @confido.health emails allowed.';
  end if;
  return new;
end;
$$;

drop trigger if exists confido_email_only on auth.users;
create trigger confido_email_only
  before insert on auth.users
  for each row execute function internal.enforce_confido_email();

-- Also auto-create a public.users row on first sign-in.
create or replace function internal.mirror_auth_user() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.users (id, email, role)
    values (new.id, new.email, 'viewer')
    on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists mirror_auth_user on auth.users;
create trigger mirror_auth_user
  after insert on auth.users
  for each row execute function internal.mirror_auth_user();
