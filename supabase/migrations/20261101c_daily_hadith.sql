-- IUFyou: Daily Hadith banner. One row per calendar date; the public site shows the most
-- recent published row whose date is today or earlier. Editing is admin-only (row-level security).
create table if not exists public.daily_hadith (
  id          uuid primary key default gen_random_uuid(),
  show_date   date not null unique,
  text        text not null check (char_length(btrim(text)) between 10 and 600),
  source      text not null default '' check (char_length(source) <= 120),
  published   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.daily_hadith enable row level security;

drop policy if exists hadith_public_read on public.daily_hadith;
create policy hadith_public_read on public.daily_hadith for select to anon, authenticated
  using (published and show_date <= current_date + 1);   -- +1 day tolerates visitors ahead of UTC
drop policy if exists hadith_admin_read on public.daily_hadith;
create policy hadith_admin_read on public.daily_hadith for select to authenticated using ((select public.is_iufu_admin()));
drop policy if exists hadith_admin_insert on public.daily_hadith;
create policy hadith_admin_insert on public.daily_hadith for insert to authenticated with check ((select public.is_iufu_admin()));
drop policy if exists hadith_admin_update on public.daily_hadith;
create policy hadith_admin_update on public.daily_hadith for update to authenticated
  using ((select public.is_iufu_admin())) with check ((select public.is_iufu_admin()));

revoke all on public.daily_hadith from public, anon, authenticated;
grant select on public.daily_hadith to anon;
grant select, insert, update on public.daily_hadith to authenticated;

create or replace function public.iufu_touch() returns trigger language plpgsql set search_path to '' as $f$
begin new.updated_at := now(); return new; end $f$;
drop trigger if exists daily_hadith_touch on public.daily_hadith;
create trigger daily_hadith_touch before update on public.daily_hadith for each row execute function public.iufu_touch();

-- Audit: who changed which Hadith and when (old/new values kept for videos and hadith).
create or replace function public.log_iufu_change()
returns trigger language plpgsql security definer set search_path to '' as $f$
declare r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_log(actor, table_name, record_id, operation, actor_email, old_data, new_data)
  values ((select auth.uid()), tg_table_name, coalesce(r->>'id', r->>'key'), tg_op,
          nullif((select auth.jwt()) ->> 'email', ''),
          case when tg_table_name in ('videos','daily_hadith') and tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_table_name in ('videos','daily_hadith') and tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return case when tg_op = 'DELETE' then old else new end;
end $f$;
drop trigger if exists daily_hadith_audit on public.daily_hadith;
create trigger daily_hadith_audit after insert or update or delete on public.daily_hadith
  for each row execute function public.log_iufu_change();
