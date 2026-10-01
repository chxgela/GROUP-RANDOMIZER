-- RANDOM GROUP MAKER
-- Run this entire file in Supabase SQL Editor.
-- It creates tables, RLS policies, realtime, and concurrency-safe RPC functions.

create extension if not exists pgcrypto;

create table if not exists public.facilitators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  facilitator_id uuid not null references auth.users(id) on delete cascade,
  subject text not null check (char_length(trim(subject)) between 1 and 120),
  class_section text not null check (char_length(trim(class_section)) between 1 and 120),
  total_students integer not null check (total_students > 0 and total_students <= 1000),
  status text not null default 'draft' check (status in ('draft','active','full','ended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  group_number integer not null check (group_number > 0),
  capacity integer not null check (capacity > 0 and capacity <= 1000),
  assigned_count integer not null default 0 check (assigned_count >= 0),
  created_at timestamptz not null default now(),
  unique(session_id, group_number),
  unique(session_id, id)
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  group_id uuid not null,
  student_name text not null check (char_length(trim(student_name)) between 1 and 120),
  normalized_name text generated always as (lower(regexp_replace(trim(student_name), '\s+', ' ', 'g'))) stored,
  participant_token uuid not null,
  assigned_at timestamptz not null default now(),
  unique(session_id, normalized_name),
  unique(session_id, participant_token),
  foreign key (session_id, group_id) references public.groups(session_id, id) on delete cascade
);

create index if not exists idx_sessions_facilitator on public.sessions(facilitator_id, created_at desc);
create index if not exists idx_groups_session on public.groups(session_id, group_number);
create index if not exists idx_assignments_session on public.assignments(session_id, assigned_at);
create index if not exists idx_assignments_token on public.assignments(session_id, participant_token);

-- Helper: current user is a facilitator.
create or replace function public.is_facilitator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.facilitators f
    where f.user_id = (select auth.uid())
  );
$$;

-- Sessions: students may read only basic session metadata; facilitators manage their own.
alter table public.facilitators enable row level security;
alter table public.sessions enable row level security;
alter table public.groups enable row level security;
alter table public.assignments enable row level security;

drop policy if exists "facilitators own row" on public.facilitators;
create policy "facilitators own row" on public.facilitators
for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "public read sessions" on public.sessions;
create policy "public read sessions" on public.sessions
for select to anon, authenticated
using (true);

drop policy if exists "facilitator manage own sessions" on public.sessions;
create policy "facilitator manage own sessions" on public.sessions
for all to authenticated
using (facilitator_id = (select auth.uid()) and public.is_facilitator())
with check (facilitator_id = (select auth.uid()) and public.is_facilitator());

-- Group rows are public-read so students can see live counts.
drop policy if exists "public read groups" on public.groups;
create policy "public read groups" on public.groups
for select to anon, authenticated using (true);

-- No direct student writes to groups.
revoke insert, update, delete on public.groups from anon, authenticated;

-- Assignments are readable only by facilitators.
drop policy if exists "facilitator read assignments" on public.assignments;
create policy "facilitator read assignments" on public.assignments
for select to authenticated
using (
  exists (
    select 1 from public.sessions s
    where s.id = assignments.session_id
      and s.facilitator_id = (select auth.uid())
      and public.is_facilitator()
  )
);

revoke insert, update, delete on public.assignments from anon, authenticated;

grant select on public.sessions, public.groups to anon, authenticated;
grant select on public.facilitators, public.assignments to authenticated;

-- Create session + groups in one database transaction.
create or replace function public.create_grouping_session(
  p_subject text,
  p_class_section text,
  p_total_students integer,
  p_capacities integer[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_sum integer;
  i integer;
begin
  if not public.is_facilitator() then
    raise exception 'not authorized';
  end if;

  if p_total_students is null or p_total_students < 1 then
    raise exception 'invalid total students';
  end if;

  if p_capacities is null or array_length(p_capacities, 1) < 1 then
    raise exception 'at least one group is required';
  end if;

  v_sum := (select coalesce(sum(x),0) from unnest(p_capacities) x);
  if v_sum <> p_total_students then
    raise exception 'group capacity must equal total students';
  end if;

  insert into public.sessions(facilitator_id, subject, class_section, total_students, status)
  values ((select auth.uid()), trim(p_subject), trim(p_class_section), p_total_students, 'draft')
  returning id into v_session_id;

  for i in 1..array_length(p_capacities,1) loop
    insert into public.groups(session_id, group_number, capacity)
    values (v_session_id, i, p_capacities[i]);
  end loop;

  return v_session_id;
end;
$$;

-- Atomic random assignment. Row locking prevents over-capacity under concurrent requests.
create or replace function public.pick_group(
  p_session_id uuid,
  p_student_name text,
  p_participant_token uuid
)
returns table (
  assignment_id uuid,
  student_name text,
  group_number integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions%rowtype;
  v_group public.groups%rowtype;
  v_assignment public.assignments%rowtype;
  v_existing public.assignments%rowtype;
begin
  if p_student_name is null or char_length(trim(p_student_name)) = 0 then
    raise exception 'name is required';
  end if;

  if p_participant_token is null then
    raise exception 'participant token is required';
  end if;

  select * into v_session
  from public.sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'session not found';
  end if;

  -- Refresh/retry protection: same browser token gets the original assignment.
  select * into v_existing
  from public.assignments
  where session_id = p_session_id
    and participant_token = p_participant_token
  limit 1;

  if found then
    return query select v_existing.id, v_existing.student_name,
      (select g.group_number from public.groups g where g.id = v_existing.group_id);
    return;
  end if;

  if v_session.status <> 'active' then
    raise exception 'session is not active';
  end if;

  -- Prevent the same name being used twice (case/spacing insensitive).
  select * into v_existing
  from public.assignments
  where session_id = p_session_id
    and normalized_name = lower(regexp_replace(trim(p_student_name), '\s+', ' ', 'g'))
  limit 1;

  if found then
    raise exception 'name already picked';
  end if;

  -- Lock one currently available group. Random ordering is decided inside the database.
  select * into v_group
  from public.groups
  where session_id = p_session_id
    and assigned_count < capacity
  order by random()
  limit 1
  for update skip locked;

  if not found then
    update public.sessions set status = 'full', updated_at = now()
    where id = p_session_id;
    raise exception 'session is full';
  end if;

  insert into public.assignments(session_id, group_id, student_name, participant_token)
  values (p_session_id, v_group.id, trim(p_student_name), p_participant_token)
  returning * into v_assignment;

  update public.groups
  set assigned_count = assigned_count + 1
  where id = v_group.id;

  if not exists (
    select 1 from public.groups
    where session_id = p_session_id and assigned_count < capacity
  ) then
    update public.sessions set status = 'full', updated_at = now()
    where id = p_session_id;
  end if;

  return query select v_assignment.id, v_assignment.student_name, v_group.group_number;
exception
  when unique_violation then
    -- Covers a name/token race without allowing duplicate assignments.
    select * into v_existing
    from public.assignments
    where session_id = p_session_id
      and (participant_token = p_participant_token or
           normalized_name = lower(regexp_replace(trim(p_student_name), '\s+', ' ', 'g')))
    limit 1;
    if found then
      return query select v_existing.id, v_existing.student_name,
        (select g.group_number from public.groups g where g.id = v_existing.group_id);
      return;
    end if;
    raise;
end;
$$;

create or replace function public.get_my_assignment(
  p_session_id uuid,
  p_participant_token uuid
)
returns table (
  student_name text,
  group_number integer
)
language sql
security definer
set search_path = ''
as $$
  select a.student_name, g.group_number
  from public.assignments a
  join public.groups g on g.id = a.group_id
  where a.session_id = p_session_id
    and a.participant_token = p_participant_token
  limit 1;
$$;

create or replace function public.set_session_status(
  p_session_id uuid,
  p_status text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.is_facilitator() then raise exception 'not authorized'; end if;
  if p_status not in ('active','ended') then raise exception 'invalid status'; end if;

  update public.sessions
  set status = p_status, updated_at = now()
  where id = p_session_id and facilitator_id = (select auth.uid());

  if not found then raise exception 'session not found'; end if;
end;
$$;

create or replace function public.reset_grouping_session(
  p_session_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_facilitator() then raise exception 'not authorized'; end if;

  perform 1 from public.sessions
  where id = p_session_id and facilitator_id = (select auth.uid())
  for update;

  if not found then raise exception 'session not found'; end if;

  delete from public.assignments where session_id = p_session_id;
  update public.groups set assigned_count = 0 where session_id = p_session_id;
  update public.sessions set status = 'active', updated_at = now() where id = p_session_id;
end;
$$;

revoke execute on function public.create_grouping_session(text,text,integer,integer[]) from public, anon;
revoke execute on function public.pick_group(uuid,text,uuid) from public;
revoke execute on function public.get_my_assignment(uuid,uuid) from public;
revoke execute on function public.set_session_status(uuid,text) from public, anon;
revoke execute on function public.reset_grouping_session(uuid) from public, anon;

grant execute on function public.create_grouping_session(text,text,integer,integer[]) to authenticated;
grant execute on function public.pick_group(uuid,text,uuid) to anon, authenticated;
grant execute on function public.get_my_assignment(uuid,uuid) to anon, authenticated;
grant execute on function public.set_session_status(uuid,text) to authenticated;
grant execute on function public.reset_grouping_session(uuid) to authenticated;

-- Realtime: enable live group/session/assignment changes.
do $$
begin
  begin
    alter publication supabase_realtime add table public.groups;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.sessions;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.assignments;
  exception when duplicate_object then null;
  end;
end $$;

-- The assignment/session-changing RPCs above are SECURITY DEFINER because direct
-- INSERT/UPDATE/DELETE access is intentionally denied by RLS. They use an empty
-- search_path and fully-qualified public table references.
--
-- IMPORTANT: after creating your Supabase Auth account, run:
-- insert into public.facilitators(user_id)
-- values ('YOUR-AUTH-USER-UUID');
--
-- Never put a service_role key in the website.
