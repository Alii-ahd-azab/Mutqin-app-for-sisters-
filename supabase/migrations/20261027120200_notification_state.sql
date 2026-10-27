-- Mutqin for Sisters: persisted notification INTERACTION state and master-admin batch follows.
-- Same model as Mutqin for Men.
--
-- Notifications stay DERIVED from the program status (overdue Tasmi'a / review, rest days, distant
-- reviews); nothing here is a source of truth for a debt. Stored per user, keyed by the stable
-- notification key computed by the shared code (supabase/functions/_shared/logic/notifications.ts):
--   seen_at      the panel was opened while the (non-urgent) notification was showing
--   archived_at  the notification itself was clicked; it then lives in «عرض كل التنبيهات»
-- One row per (user, key): repeated refreshes never add rows. title/body/kind/tone are a display
-- snapshot for the history list only.
--
-- admin_notification_batch_subscriptions: which batches a MASTER admin follows for the serious
-- member alerts. Batch admins have no rows: their scope is their batch assignments.
-- All writes go through the RPCs below (caller = auth.uid()); RLS lets each user read only her own.

create table public.notification_states (
    user_id uuid not null references public.profiles(id) on delete cascade,
    notification_key text not null check (char_length(notification_key) between 1 and 200),
    kind text not null default '' check (char_length(kind) <= 40),
    tone text not null default '' check (char_length(tone) <= 20),
    urgent boolean not null default false,
    title text not null default '' check (char_length(title) <= 300),
    body text not null default '' check (char_length(body) <= 1000),
    seen_at timestamptz,
    archived_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (user_id, notification_key)
);
create index notification_states_archived_idx on public.notification_states (user_id, archived_at desc) where archived_at is not null;

create table public.admin_notification_batch_subscriptions (
    admin_user_id uuid not null references public.profiles(id) on delete cascade,
    batch_id uuid not null references public.batches(id) on delete cascade,
    enabled boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (admin_user_id, batch_id)
);

alter table public.notification_states enable row level security;
alter table public.admin_notification_batch_subscriptions enable row level security;

revoke all on table public.notification_states from public;
revoke all on table public.admin_notification_batch_subscriptions from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.notification_states, public.admin_notification_batch_subscriptions from %I', r);
    end if;
  end loop;
end $$;
grant select on table public.notification_states to authenticated;
grant select on table public.admin_notification_batch_subscriptions to authenticated;

create policy notification_states_select_own on public.notification_states
  for select to authenticated using (user_id = (select auth.uid()));
create policy notification_follows_select_own on public.admin_notification_batch_subscriptions
  for select to authenticated using (admin_user_id = (select auth.uid()) and (select app_private.is_master_admin()));

-- The caller must be an active account.
create function app_private.active_caller() returns uuid
    language plpgsql stable security definer
    set search_path to ''
    as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists (select 1 from public.profiles p where p.id = v_uid and p.active) then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- Opening the panel: these (non-urgent) notifications are now seen. Idempotent; never archives.
create function public.notifications_mark_seen(p_items jsonb) returns integer
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_uid uuid := app_private.active_caller();
  v_n integer;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 100 then
    raise exception 'طلب غير صالح' using errcode = '22023';
  end if;
  insert into public.notification_states as s (user_id, notification_key, kind, tone, urgent, title, body, seen_at)
  select v_uid, left(i->>'key', 200), left(coalesce(i->>'kind', ''), 40), left(coalesce(i->>'tone', ''), 20),
         coalesce((i->>'urgent')::boolean, false), left(coalesce(i->>'title', ''), 300), left(coalesce(i->>'body', ''), 1000), now()
  from jsonb_array_elements(p_items) i
  where coalesce(i->>'key', '') <> ''
  on conflict (user_id, notification_key) do update
    set seen_at = coalesce(s.seen_at, now()), updated_at = now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Clicking the notification itself: archived (and seen). Idempotent: the first click's time is kept.
create function public.notification_archive(p_item jsonb) returns timestamptz
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_uid uuid := app_private.active_caller();
  v_key text := left(coalesce(p_item->>'key', ''), 200);
  v_at timestamptz;
begin
  if v_key = '' then
    raise exception 'طلب غير صالح' using errcode = '22023';
  end if;
  insert into public.notification_states as s (user_id, notification_key, kind, tone, urgent, title, body, seen_at, archived_at)
  values (v_uid, v_key, left(coalesce(p_item->>'kind', ''), 40), left(coalesce(p_item->>'tone', ''), 20),
          coalesce((p_item->>'urgent')::boolean, false), left(coalesce(p_item->>'title', ''), 300), left(coalesce(p_item->>'body', ''), 1000), now(), now())
  on conflict (user_id, notification_key) do update
    set archived_at = coalesce(s.archived_at, now()), seen_at = coalesce(s.seen_at, now()),
        kind = excluded.kind, tone = excluded.tone, urgent = excluded.urgent, title = excluded.title, body = excluded.body,
        updated_at = now()
  returning archived_at into v_at;
  return v_at;
end;
$$;

-- Master admin: follow (or stop following) one batch's serious member alerts.
create function public.set_notification_batch_follow(p_batch_id uuid, p_enabled boolean) returns boolean
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_uid uuid := app_private.active_caller();
begin
  if not app_private.is_master_admin() then
    raise exception 'متابعة الدفعات متاحة للمشرفة العامة فقط' using errcode = '42501';
  end if;
  if not exists (select 1 from public.batches b where b.id = p_batch_id and b.archived_at is null) then
    raise exception 'الدفعة غير موجودة' using errcode = 'P0002';
  end if;
  insert into public.admin_notification_batch_subscriptions as f (admin_user_id, batch_id, enabled)
  values (v_uid, p_batch_id, coalesce(p_enabled, false))
  on conflict (admin_user_id, batch_id) do update set enabled = excluded.enabled, updated_at = now();
  return coalesce(p_enabled, false);
end;
$$;

do $$
declare
  f text;
  r text;
begin
  foreach f in array array[
    'app_private.active_caller()', 'public.notifications_mark_seen(jsonb)',
    'public.notification_archive(jsonb)', 'public.set_notification_batch_follow(uuid, boolean)'] loop
    execute format('revoke all on function %s from public', f);
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on function %s from %I', f, r);
      end if;
    end loop;
  end loop;
end;
$$;

grant execute on function public.notifications_mark_seen(jsonb) to authenticated;
grant execute on function public.notification_archive(jsonb) to authenticated;
grant execute on function public.set_notification_batch_follow(uuid, boolean) to authenticated;
