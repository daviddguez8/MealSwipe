-- Change a household's passcode from inside the app.
-- Needs the current passcode (checked and throttled like ms_load/ms_save).
-- Also rotates the realtime channel name, so anyone who only knew the old
-- passcode can no longer listen for or send "changed" pings.
create or replace function public.ms_change_passcode(code text, new_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  h public.households;
  nc text := btrim(coalesce(new_code, ''));
  new_channel text := encode(gen_random_bytes(12), 'hex');
begin
  h := _household_for(code);
  if h.id is null then return _passcode_error(); end if;
  if length(nc) < 8 then
    return jsonb_build_object('error', 'The new passcode needs at least 8 characters.');
  end if;
  if h.passcode_hash = crypt(nc, h.passcode_hash) then
    return jsonb_build_object('error', 'The new passcode is the same as the current one.');
  end if;
  if exists (select 1 from households where id <> h.id and passcode_hash = crypt(nc, passcode_hash)) then
    return jsonb_build_object('error', 'Pick a different passcode.');
  end if;
  update households
     set passcode_hash = crypt(nc, gen_salt('bf')),
         channel = new_channel,
         updated_at = now()
   where id = h.id;
  return jsonb_build_object('ok', true, 'channel', new_channel, 'oldChannel', h.channel);
end $$;

revoke all on function public.ms_change_passcode(text, text) from public;
grant execute on function public.ms_change_passcode(text, text) to anon, authenticated;
