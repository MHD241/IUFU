-- IUFyou: admin-controlled speed of the rolling Hadith banner (1 = very slow ... 5 = very fast, 3 = normal).
-- One row only. Public can read it; only admins can change it; changes are audited.
create table if not exists public.banner_settings (
  id           boolean primary key default true check (id),
  hadith_speed smallint not null default 3 check (hadith_speed between 1 and 5),
  updated_at   timestamptz not null default now()
);
insert into public.banner_settings (id) values (true) on conflict do nothing;
alter table public.banner_settings enable row level security;

drop policy if exists banner_public_read on public.banner_settings;
create policy banner_public_read on public.banner_settings for select to anon, authenticated using (true);
drop policy if exists banner_admin_update on public.banner_settings;
create policy banner_admin_update on public.banner_settings for update to authenticated
  using ((select public.is_iufu_admin())) with check ((select public.is_iufu_admin()));

revoke all on public.banner_settings from public, anon, authenticated;
grant select on public.banner_settings to anon;
grant select, update on public.banner_settings to authenticated;

drop trigger if exists banner_settings_touch on public.banner_settings;
create trigger banner_settings_touch before update on public.banner_settings for each row execute function public.iufu_touch();

create or replace function public.log_iufu_change()
returns trigger language plpgsql security definer set search_path to '' as $f$
declare r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_log(actor, table_name, record_id, operation, actor_email, old_data, new_data)
  values ((select auth.uid()), tg_table_name, coalesce(r->>'id', r->>'key'), tg_op,
          nullif((select auth.jwt()) ->> 'email', ''),
          case when tg_table_name in ('videos','daily_hadith','banner_settings') and tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_table_name in ('videos','daily_hadith','banner_settings') and tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return case when tg_op = 'DELETE' then old else new end;
end $f$;
drop trigger if exists banner_settings_audit on public.banner_settings;
create trigger banner_settings_audit after update on public.banner_settings
  for each row execute function public.log_iufu_change();
