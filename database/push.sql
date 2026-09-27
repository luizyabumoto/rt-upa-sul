-- Dedicated RT UPA Sul project only. Secrets are provisioned separately in Vault.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create table public.rt_push_subscriptions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.rt_members(user_id) on delete cascade,
 endpoint text not null unique check(length(endpoint) < 2048),
 subscription jsonb not null check(octet_length(subscription::text)<4096),
 enabled boolean not null default true,
 updated_at timestamptz not null default now()
);
create index rt_push_user on public.rt_push_subscriptions(user_id);
alter table public.rt_push_subscriptions enable row level security;
revoke all on public.rt_push_subscriptions from anon, authenticated;
grant select, insert, update on public.rt_push_subscriptions to authenticated;
grant all on public.rt_push_subscriptions to service_role;
create policy own_push_select on public.rt_push_subscriptions for select to authenticated using(user_id=(select auth.uid()));
create policy own_push_insert on public.rt_push_subscriptions for insert to authenticated with check(user_id=(select auth.uid()) and exists(select 1 from public.rt_members where user_id=(select auth.uid())));
create policy own_push_update on public.rt_push_subscriptions for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()) and exists(select 1 from public.rt_members where user_id=(select auth.uid())));

create table public.rt_push_deliveries (
 subscription_id uuid not null references public.rt_push_subscriptions(id) on delete cascade,
 delivery_key text not null,
 attempts integer not null default 1,
 claimed_at timestamptz not null default now(),
 delivered_at timestamptz,
 last_status integer,
 primary key(subscription_id,delivery_key)
);
alter table public.rt_push_deliveries enable row level security;
revoke all on public.rt_push_deliveries from anon, authenticated;
grant all on public.rt_push_deliveries to service_role;

create function public.rt_claim_push(p_subscription uuid,p_key text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare claimed uuid;
begin
 insert into public.rt_push_deliveries(subscription_id,delivery_key) values(p_subscription,p_key)
 on conflict(subscription_id,delivery_key) do update
 set claimed_at=now(),attempts=public.rt_push_deliveries.attempts+1
 where public.rt_push_deliveries.delivered_at is null and public.rt_push_deliveries.claimed_at<now()-interval '10 minutes' and public.rt_push_deliveries.attempts<5
 returning subscription_id into claimed;
 return claimed is not null;
end $$;
revoke all on function public.rt_claim_push(uuid,text) from public,anon,authenticated;
grant execute on function public.rt_claim_push(uuid,text) to service_role;

-- A service-only bridge to Vault. No client role can execute this function.
create function public.rt_push_config() returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_object_agg(name,decrypted_secret) from vault.decrypted_secrets
 where name in ('rt_vapid_public','rt_vapid_private','rt_push_cron_secret')
 and (select auth.role())='service_role';
$$;
revoke all on function public.rt_push_config() from public,anon,authenticated;
grant execute on function public.rt_push_config() to service_role;
create function public.rt_register_push(p_endpoint text,p_subscription jsonb) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.rt_members where user_id=auth.uid()) then raise exception 'Access denied'; end if;
 if p_endpoint !~ '^https://(web\.push\.apple\.com|fcm\.googleapis\.com|[a-z0-9.-]*push\.services\.mozilla\.com)/' or p_subscription->>'endpoint' is distinct from p_endpoint then raise exception 'Invalid endpoint'; end if;
 if (select count(*) from public.rt_push_subscriptions where user_id=auth.uid() and enabled)>9 and not exists(select 1 from public.rt_push_subscriptions where endpoint=p_endpoint) then raise exception 'Device limit'; end if;
 insert into public.rt_push_subscriptions(user_id,endpoint,subscription) values(auth.uid(),p_endpoint,p_subscription)
 on conflict(endpoint) do update set subscription=excluded.subscription,enabled=true,updated_at=now();
end $$;
revoke all on function public.rt_register_push(text,jsonb) from public,anon;
grant execute on function public.rt_register_push(text,jsonb) to authenticated;
create function public.rt_disable_push(p_endpoint text) returns void
language sql security invoker set search_path='' as $$
 update public.rt_push_subscriptions set enabled=false,updated_at=now() where endpoint=p_endpoint and user_id=auth.uid();
$$;
revoke all on function public.rt_disable_push(text) from public,anon;
grant execute on function public.rt_disable_push(text) to authenticated;
commit;
