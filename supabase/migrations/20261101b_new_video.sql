-- IUFyou: the "New video" section. Reuses the existing public.videos.featured column.
-- At most ONE published video can be the New video at any time (enforced by the database).
create unique index if not exists videos_one_new on public.videos ((true)) where featured and published;

-- Same function as before plus: add with is_new, set_new, clear_new, and remove clears the New flag.
create or replace function public.iufu_apply_changes(changes jsonb)
returns jsonb language plpgsql security invoker set search_path to '' as $f$
declare c jsonb; r public.videos; out jsonb := '[]'::jsonb; n int := 0; skip boolean;
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
    n := n + 1; r := null; skip := false;
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
        if coalesce((c->>'is_new')::boolean, false) then
          update public.videos set featured = false, updated_at = now() where featured;
        end if;
        insert into public.videos(title, youtube_id, category, kind, position, published, published_at, featured)
        values (btrim(c->>'title'), c->>'youtube_id',
                coalesce(nullif(btrim(c->>'category'), ''), 'السيرة النبوية'),
                c->>'kind', (c->>'position')::int, true, now(), coalesce((c->>'is_new')::boolean, false))
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
        update public.videos set published = false, featured = false, updated_at = now()
        where id = (c->>'id')::uuid returning * into r;
      when 'restore' then
        update public.videos set published = true, published_at = coalesce(published_at, now()), updated_at = now()
        where id = (c->>'id')::uuid returning * into r;
      when 'set_new' then
        update public.videos set featured = false, updated_at = now() where featured and id <> (c->>'id')::uuid;
        update public.videos set featured = true, updated_at = now()
        where id = (c->>'id')::uuid and published returning * into r;
      when 'clear_new' then
        update public.videos set featured = false, updated_at = now() where featured;
        skip := true;
      else
        raise exception 'Change %: unknown operation', n using errcode = '22023';
    end case;

    if not skip then
      if r.id is null then
        raise exception 'Change % affected no record (not found, removed, or not permitted)', n using errcode = 'P0002';
      end if;
      out := out || to_jsonb(r);
    end if;
  end loop;
  return out;
end $f$;

revoke all on function public.iufu_apply_changes(jsonb) from public, anon;
grant execute on function public.iufu_apply_changes(jsonb) to authenticated;
