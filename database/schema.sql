-- Aplicar somente no projeto dedicado RT UPA Sul.
begin;
create table public.rt_members (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.rt_members enable row level security;
revoke all on public.rt_members from anon, authenticated;
grant select on public.rt_members to authenticated;
create policy member_self on public.rt_members for select to authenticated
using (user_id = (select auth.uid()));

create table public.rt_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  items jsonb not null default '{}' check (jsonb_typeof(items) = 'object' and octet_length(items::text) <= 2000000),
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);
alter table public.rt_state enable row level security;
revoke all on public.rt_state from anon, authenticated;
grant select, insert, update on public.rt_state to authenticated;
create policy state_read on public.rt_state for select to authenticated
using (user_id = (select auth.uid()) and exists (select 1 from public.rt_members where user_id = (select auth.uid())));
create policy state_insert on public.rt_state for insert to authenticated
with check (user_id = (select auth.uid()) and exists (select 1 from public.rt_members where user_id = (select auth.uid())));
create policy state_update on public.rt_state for update to authenticated
using (user_id = (select auth.uid()) and exists (select 1 from public.rt_members where user_id = (select auth.uid())))
with check (user_id = (select auth.uid()) and exists (select 1 from public.rt_members where user_id = (select auth.uid())));

create function public.save_rt_state(new_items jsonb, expected_revision integer)
returns integer language plpgsql security invoker set search_path = '' as $$
declare next_revision integer;
begin
  if expected_revision = 0 then
    insert into public.rt_state (user_id, items) values (auth.uid(), new_items)
    on conflict (user_id) do nothing returning revision into next_revision;
  else
    update public.rt_state set items = new_items, revision = revision + 1, updated_at = now()
    where user_id = auth.uid() and revision = expected_revision
    returning revision into next_revision;
  end if;
  if next_revision is null then
    raise exception 'Conflicting revision' using errcode = '23505';
  end if;
  return next_revision;
end;
revoke all on function public.save_rt_state(jsonb, integer) from public, anon;
grant execute on function public.save_rt_state(jsonb, integer) to authenticated;
commit;
