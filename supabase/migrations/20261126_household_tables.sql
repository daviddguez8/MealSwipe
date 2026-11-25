-- ============================================================================
-- Split the single `households` row into household-keyed tables, so each
-- household has its own recipes, edits, photos, ratings and week, and the
-- MealSwipe recipes ("Classic") live once in `platform_recipes`.
--
--   platform_recipes   the MealSwipe deck every household starts from
--   household_recipes  per household: 'own' recipes and 'edit' (edited copy
--                      of a platform recipe)
--   household_hidden   per household recipes hidden from the deck and list
--                      (MealSwipe recipes can be hidden, never deleted)
--   household_photos   per household photo for any recipe (kept apart so a
--                      photo doesn't turn a Classic recipe into an edit)
--   household_ratings  per household 0.5-5 stars (half steps) for any recipe
--   household_plans    per household week: swipe decisions, plan, checkmarks,
--                      deck order
--   households         passcode, name, settings, realtime channel, version
--
-- The browser still never touches tables: ms_household_load / _save check
-- the passcode on every call (security definer, like ms_load / ms_save).
--
-- Additive: the old jsonb columns on `households` stay untouched, and the
-- old ms_load / ms_save keep working until the new app is live. Once a
-- household saves through the new function, the old ms_save refuses (so a
-- stale tab can't write to the old columns) and the old columns are no
-- longer read. Drop them in a later cleanup migration.
-- ============================================================================

create table if not exists public.platform_recipes (
  id text primary key,
  data jsonb not null,            -- recipe object without id (title, cuisine, ingredients, steps, ...)
  sort integer not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.household_recipes (
  household_id uuid not null references public.households(id) on delete cascade,
  recipe_id text not null,
  kind text not null check (kind in ('own', 'edit')),
  data jsonb not null,            -- full recipe object (without id/image)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (household_id, recipe_id)
);

create table if not exists public.household_hidden (
  household_id uuid not null references public.households(id) on delete cascade,
  recipe_id text not null,
  hidden_at timestamptz not null default now(),
  primary key (household_id, recipe_id)
);

create table if not exists public.household_photos (
  household_id uuid not null references public.households(id) on delete cascade,
  recipe_id text not null,
  image text not null,
  updated_at timestamptz not null default now(),
  primary key (household_id, recipe_id)
);

create table if not exists public.household_ratings (
  household_id uuid not null references public.households(id) on delete cascade,
  recipe_id text not null,
  stars numeric(2,1) not null check (stars between 0.5 and 5 and stars * 2 = floor(stars * 2)),
  updated_at timestamptz not null default now(),
  primary key (household_id, recipe_id)
);

create table if not exists public.household_plans (
  household_id uuid primary key references public.households(id) on delete cascade,
  decisions jsonb not null default '{}'::jsonb,
  plan jsonb not null default '{}'::jsonb,
  checked jsonb not null default '{}'::jsonb,
  deck_order jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.households add column if not exists data_version bigint not null default 1;
alter table public.households add column if not exists created_at timestamptz not null default now();
alter table public.households add column if not exists split_at timestamptz;          -- first save through the new tables
alter table public.households add column if not exists legacy_version bigint;         -- old `version` last copied over

alter table public.platform_recipes enable row level security;
alter table public.household_recipes enable row level security;
alter table public.household_hidden enable row level security;
alter table public.household_photos enable row level security;
alter table public.household_ratings enable row level security;
alter table public.household_plans enable row level security;

-- ---------------------------------------------------------------------------
-- Copy one household's old jsonb columns into the new tables (replacing what
-- is there). Recipes equal to the platform version become Classic (no row);
-- changed ones become 'edit'; custom ones 'own'; MealSwipe recipes the
-- household had deleted become hidden (they can't be deleted any more).
create or replace function public._ms_copy_legacy(hid uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare h public.households;
begin
  select * into h from households where id = hid for update;
  if h.id is null then return; end if;

  delete from household_recipes where household_id = hid;
  delete from household_hidden where household_id = hid;
  delete from household_photos where household_id = hid;

  insert into household_photos (household_id, recipe_id, image)
  select hid, r->>'id', r->>'image'
    from jsonb_array_elements(coalesce(h.recipes, '[]'::jsonb)) r
   where coalesce(r->>'image', '') <> '';

  insert into household_recipes (household_id, recipe_id, kind, data)
  select hid, r->>'id',
         case when p.id is null or (r->>'custom')::boolean is true then 'own' else 'edit' end,
         r - 'id' - 'image' - 'custom'
    from jsonb_array_elements(coalesce(h.recipes, '[]'::jsonb)) r
    left join platform_recipes p on p.id = r->>'id'
   where p.id is null
      or (r->>'custom')::boolean is true
      or (r - 'id' - 'image' - 'custom' - 'photoCredit') <> p.data;

  insert into household_hidden (household_id, recipe_id)
  select hid, s.id
    from jsonb_array_elements_text(coalesce(h.seen_starter_ids, '[]'::jsonb)) s(id)
    join platform_recipes p on p.id = s.id
   where not exists (select 1 from jsonb_array_elements(coalesce(h.recipes, '[]'::jsonb)) r where r->>'id' = s.id)
  on conflict do nothing;

  insert into household_plans (household_id, decisions, plan, checked, deck_order)
  values (hid, coalesce(h.decisions, '{}'), coalesce(h.plan, '{}'), coalesce(h.checked, '{}'),
          coalesce((select jsonb_agg(r->'id') from jsonb_array_elements(coalesce(h.recipes, '[]'::jsonb)) r), '[]'))
  on conflict (household_id) do update
    set decisions = excluded.decisions, plan = excluded.plan, checked = excluded.checked,
        deck_order = excluded.deck_order, updated_at = now();

  update households set legacy_version = h.version, data_version = data_version + 1 where id = hid;
end $$;

-- ---------------------------------------------------------------------------
-- Cheap "is this passcode valid" check (used by the Ask Claude function).
create or replace function public.ms_check(code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare h public.households;
begin
  h := _household_for(code);
  if h.id is null then return _passcode_error(); end if;
  return jsonb_build_object('ok', true, 'householdId', h.id);
end $$;

-- ---------------------------------------------------------------------------
create or replace function public.ms_household_load(code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare h public.households;
  pl public.household_plans;
begin
  h := _household_for(code);
  if h.id is null then return _passcode_error(); end if;
  -- Old app saved since the last copy (and the new one hasn't taken over yet).
  if h.split_at is null and h.legacy_version is distinct from h.version then
    perform _ms_copy_legacy(h.id);
    select * into h from households where id = h.id;
  end if;
  select * into pl from household_plans where household_id = h.id;
  return jsonb_build_object(
    'householdId', h.id,
    'name', h.name,
    'version', h.data_version,
    'channel', h.channel,
    'settings', h.settings,
    'platform', coalesce((select jsonb_agg(p.data || jsonb_build_object('id', p.id) order by p.sort, p.id)
                            from platform_recipes p where p.active), '[]'),
    'recipes', coalesce((select jsonb_object_agg(r.recipe_id, jsonb_build_object('kind', r.kind, 'data', r.data))
                           from household_recipes r where r.household_id = h.id), '{}'),
    'hidden', coalesce((select jsonb_object_agg(x.recipe_id, true) from household_hidden x where x.household_id = h.id), '{}'),
    'photos', coalesce((select jsonb_object_agg(f.recipe_id, f.image) from household_photos f where f.household_id = h.id), '{}'),
    'ratings', coalesce((select jsonb_object_agg(x.recipe_id, x.stars) from household_ratings x where x.household_id = h.id), '{}'),
    'decisions', coalesce(pl.decisions, '{}'),
    'plan', coalesce(pl.plan, '{}'),
    'checked', coalesce(pl.checked, '{}'),
    'order', coalesce(pl.deck_order, '[]'),
    'isNew', h.recipes is null and pl.household_id is null,
    'updatedAt', h.updated_at);
end $$;

-- ---------------------------------------------------------------------------
-- patch keys (all optional):
--   recipes  { id: {kind, data} | null }     photos  { id: dataUrl | null }
--   ratings  { id: 0.5..5 | null }           hidden  { id: true | null }
--   decisions / plan / checked  { key: value | null }, or null to clear all
--   order    [ids]                            settings  { ... } (merged)
create or replace function public.ms_household_save(code text, patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare h public.households;
  pl public.household_plans;
  e record;
  merged jsonb;
  k text;
begin
  h := _household_for(code);
  if h.id is null then return _passcode_error(); end if;
  if h.split_at is null and h.legacy_version is distinct from h.version then
    perform _ms_copy_legacy(h.id);
  end if;

  if patch ? 'recipes' then
    for e in select * from jsonb_each(patch->'recipes') loop
      if e.value = 'null'::jsonb then
        delete from household_recipes where household_id = h.id and recipe_id = e.key;
      else
        insert into household_recipes (household_id, recipe_id, kind, data)
        values (h.id, e.key, e.value->>'kind', e.value->'data')
        on conflict (household_id, recipe_id) do update
          set kind = excluded.kind, data = excluded.data, updated_at = now();
      end if;
    end loop;
  end if;

  if patch ? 'photos' then
    for e in select * from jsonb_each(patch->'photos') loop
      if jsonb_typeof(e.value) = 'string' and e.value #>> '{}' <> '' then
        insert into household_photos (household_id, recipe_id, image) values (h.id, e.key, e.value #>> '{}')
        on conflict (household_id, recipe_id) do update set image = excluded.image, updated_at = now();
      else
        delete from household_photos where household_id = h.id and recipe_id = e.key;
      end if;
    end loop;
  end if;

  if patch ? 'ratings' then
    for e in select * from jsonb_each(patch->'ratings') loop
      if jsonb_typeof(e.value) = 'number' and (e.value)::text::numeric between 0.5 and 5 then
        insert into household_ratings (household_id, recipe_id, stars) values (h.id, e.key, round((e.value)::text::numeric * 2) / 2)
        on conflict (household_id, recipe_id) do update set stars = excluded.stars, updated_at = now();
      else
        delete from household_ratings where household_id = h.id and recipe_id = e.key;
      end if;
    end loop;
  end if;

  if patch ? 'hidden' then
    for e in select * from jsonb_each(patch->'hidden') loop
      if e.value = 'true'::jsonb then
        insert into household_hidden (household_id, recipe_id) values (h.id, e.key) on conflict do nothing;
      else
        delete from household_hidden where household_id = h.id and recipe_id = e.key;
      end if;
    end loop;
  end if;

  insert into household_plans (household_id) values (h.id) on conflict do nothing;
  select * into pl from household_plans where household_id = h.id for update;
  foreach k in array array['decisions', 'plan', 'checked'] loop
    if patch ? k then
      merged := case k when 'decisions' then pl.decisions when 'plan' then pl.plan else pl.checked end;
      if patch->k = 'null'::jsonb then
        merged := '{}'::jsonb;
      else
        merged := merged || (patch->k);
        merged := (select coalesce(jsonb_object_agg(x.key, x.value), '{}'::jsonb)
                     from jsonb_each(merged) x where x.value <> 'null'::jsonb);
      end if;
      if k = 'decisions' then pl.decisions := merged;
      elsif k = 'plan' then pl.plan := merged;
      else pl.checked := merged; end if;
    end if;
  end loop;
  update household_plans set
    decisions = pl.decisions, plan = pl.plan, checked = pl.checked,
    deck_order = case when patch ? 'order' then patch->'order' else deck_order end,
    updated_at = now()
  where household_id = h.id;

  update households set
    settings = case when patch ? 'settings' then settings || (patch->'settings') else settings end,
    split_at = coalesce(split_at, now()),
    data_version = data_version + 1,
    updated_at = now()
  where id = h.id
  returning data_version into h.data_version;
  return jsonb_build_object('version', h.data_version);
end $$;

-- Old ms_save: refuse once the household has moved to the new tables, so a
-- tab still running the old app can't write to columns nobody reads.
create or replace function public.ms_save(code text, patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare h public.households;
  merged jsonb;
  k text;
begin
  h := _household_for(code);
  if h.id is null then return _passcode_error(); end if;
  if h.split_at is not null then
    return jsonb_build_object('error', 'MealSwipe was updated. Reload the page to keep going.');
  end if;
  foreach k in array array['decisions','plan','checked'] loop
    if patch ? k then
      merged := case k when 'decisions' then h.decisions when 'plan' then h.plan else h.checked end;
      if patch->k = 'null'::jsonb then
        merged := '{}'::jsonb;
      else
        merged := merged || (patch->k);
        merged := (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
                   from jsonb_each(merged) e where e.value <> 'null'::jsonb);
      end if;
      if k = 'decisions' then h.decisions := merged;
      elsif k = 'plan' then h.plan := merged;
      else h.checked := merged; end if;
    end if;
  end loop;
  update households set
    decisions = h.decisions,
    plan = h.plan,
    checked = h.checked,
    recipes = case when patch ? 'recipes' then patch->'recipes' else recipes end,
    settings = case when patch ? 'settings' then settings || (patch->'settings') else settings end,
    seen_starter_ids = case when patch ? 'seenStarterIds' then patch->'seenStarterIds' else seen_starter_ids end,
    version = version + 1,
    updated_at = now()
  where id = h.id
  returning version into h.version;
  return jsonb_build_object('version', h.version);
end $$;

-- ---------------------------------------------------------------------------
-- Start a new household from the passcode screen. Throttled so the open
-- endpoint can't be used to fill the database.
create or replace function public.ms_create_household(name text, new_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare nc text := btrim(coalesce(new_code, ''));
  nm text := left(btrim(coalesce(name, '')), 60);
  hid uuid;
begin
  if (select count(*) from households where created_at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('error', 'Too many new households right now. Try again in an hour.');
  end if;
  if length(nc) < 8 then
    return jsonb_build_object('error', 'The passcode needs at least 8 characters.');
  end if;
  if exists (select 1 from households where passcode_hash = crypt(nc, passcode_hash)) then
    return jsonb_build_object('error', 'Pick a different passcode.');
  end if;
  insert into households (name, passcode_hash, settings, split_at)
  values (case when nm = '' then 'Home' else nm end, crypt(nc, gen_salt('bf')), '{}'::jsonb, now())
  returning id into hid;
  insert into household_plans (household_id) values (hid);
  return jsonb_build_object('ok', true, 'householdId', hid);
end $$;

revoke all on function public._ms_copy_legacy(uuid) from public, anon, authenticated;
revoke all on function public.ms_create_household(text, text) from public;
grant execute on function public.ms_create_household(text, text) to anon, authenticated;
revoke all on function public.ms_check(text) from public;
revoke all on function public.ms_household_load(text) from public;
revoke all on function public.ms_household_save(text, jsonb) from public;
grant execute on function public.ms_check(text) to anon, authenticated;
grant execute on function public.ms_household_load(text) to anon, authenticated;
grant execute on function public.ms_household_save(text, jsonb) to anon, authenticated;
