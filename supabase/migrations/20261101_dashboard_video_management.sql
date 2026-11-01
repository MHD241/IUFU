-- IUFyou dashboard: ADDITIVE migration on top of the existing schema
-- (public.videos, public.admins, public.audit_log, is_iufu_admin(), log_iufu_change()).
-- Nothing is dropped or renamed. Existing policies and triggers keep working.

-- 1. The public site orders videos and splits them into Episodes vs Shorts.
alter table public.videos
  add column if not exists kind text not null default 'video',
  add column if not exists position integer not null default 0;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'videos_kind_check') then
    alter table public.videos add constraint videos_kind_check check (kind in ('video','short'));
  end if;
end $$;

create index if not exists videos_kind_position_idx on public.videos (kind, position);
-- The same video cannot be live twice in the same section.
create unique index if not exists videos_live_unique on public.videos (kind, youtube_id)
  where published and youtube_id is not null;

-- 2. The audit log must say WHAT changed, not only who/when.
alter table public.audit_log
  add column if not exists actor_email text,
  add column if not exists old_data jsonb,
  add column if not exists new_data jsonb;

create or replace function public.log_iufu_change()
returns trigger language plpgsql security definer set search_path to '' as $f$
declare r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_log(actor, table_name, record_id, operation, actor_email, old_data, new_data)
  values ((select auth.uid()), tg_table_name, coalesce(r->>'id', r->>'key'), tg_op,
          nullif((select auth.jwt()) ->> 'email', ''),
          case when tg_table_name = 'videos' and tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_table_name = 'videos' and tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return case when tg_op = 'DELETE' then old else new end;
end $f$;

-- 3. Atomic publish of a reviewed batch. SECURITY INVOKER: the existing
--    row-level-security policies (is_iufu_admin()) still decide everything.
--    changes = [{op:'add'|'update'|'remove'|'restore', id?, kind?, youtube_id?, title?, category?, position?}]
create or replace function public.iufu_apply_changes(changes jsonb)
returns jsonb language plpgsql security invoker set search_path to '' as $f$
declare c jsonb; r public.videos; out jsonb := '[]'::jsonb; n int := 0;
begin
  if not public.is_iufu_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if jsonb_typeof(changes) is distinct from 'array' or jsonb_array_length(changes) = 0 then
    raise exception 'No changes supplied' using errcode = '22023';
  end if;
  if jsonb_array_length(changes) > 100 then
    raise exception 'Too many changes in one batch (max 100)' using errcode = '22023';
  end if;

  for c in select * from jsonb_array_elements(changes) loop
    n := n + 1; r := null;
    if c ? 'youtube_id' and coalesce(c->>'youtube_id','') !~ '^[A-Za-z0-9_-]{11}$' then
      raise exception 'Change %: not a valid YouTube video ID', n using errcode = '22023';
    end if;
    if c ? 'title' and btrim(coalesce(c->>'title','')) = '' then
      raise exception 'Change %: title cannot be empty', n using errcode = '22023';
    end if;

    case c->>'op'
      when 'add' then
        if c->>'kind' not in ('video','short') or not (c ? 'youtube_id') or not (c ? 'title') then
          raise exception 'Change %: kind, youtube_id and title are required', n using errcode = '22023';
        end if;
        insert into public.videos(title, youtube_id, category, kind, position, published, published_at)
        values (btrim(c->>'title'), c->>'youtube_id',
                coalesce(nullif(btrim(c->>'category'), ''), 'السيرة النبوية'),
                c->>'kind', (c->>'position')::int, true, now())
        returning * into r;
      when 'update' then
        update public.videos set
          youtube_id = case when c ? 'youtube_id' then c->>'youtube_id' else youtube_id end,
          title      = case when c ? 'title'      then btrim(c->>'title') else title end,
          category   = case when c ? 'category'   then coalesce(nullif(btrim(c->>'category'), ''), category) else category end,
          updated_at = now()
        where id = (c->>'id')::uuid
        returning * into r;
      when 'remove' then
        update public.videos set published = false, updated_at = now()
        where id = (c->>'id')::uuid returning * into r;
      when 'restore' then
        update public.videos set published = true, published_at = coalesce(published_at, now()), updated_at = now()
        where id = (c->>'id')::uuid returning * into r;
      else
        raise exception 'Change %: unknown operation', n using errcode = '22023';
    end case;

    if r.id is null then
      raise exception 'Change % affected no record (not found or not permitted)', n using errcode = 'P0002';
    end if;
    out := out || to_jsonb(r);
  end loop;
  return out;
end $f$;

revoke all on function public.iufu_apply_changes(jsonb) from public, anon;
grant execute on function public.iufu_apply_changes(jsonb) to authenticated;
