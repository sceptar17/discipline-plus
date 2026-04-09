create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.exercises (
  id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  category text not null,
  equipment text not null,
  notes text not null default '',
  default_type text not null check (default_type in ('count', 'sets', 'duration', 'distance', 'for-time', 'weighted')),
  allowed jsonb not null default '[]'::jsonb,
  target jsonb not null default '{}'::jsonb,
  refs jsonb not null default '[]'::jsonb,
  progress_metric text not null check (progress_metric in ('count', 'time', 'weight')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.plans (
  id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  focus text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.plan_days (
  id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id text not null references public.plans(id) on delete cascade,
  day_number integer not null,
  notes text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (plan_id, day_number)
);

create table if not exists public.plan_items (
  id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_day_id text not null references public.plan_days(id) on delete cascade,
  exercise_id text not null references public.exercises(id) on delete cascade,
  type text not null check (type in ('count', 'sets', 'duration', 'distance', 'for-time', 'weighted')),
  target jsonb not null default '{}'::jsonb,
  ref text not null check (ref in ('last-result', 'personal-best')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.runs (
  id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id text references public.plans(id) on delete set null,
  start_date date not null,
  name text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.schedule_days (
  id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  notes text not null default '',
  skipped boolean not null default false,
  run_id text references public.runs(id) on delete set null,
  day_no integer,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, date)
);

create table if not exists public.schedule_items (
  id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  schedule_day_id text not null references public.schedule_days(id) on delete cascade,
  exercise_id text not null references public.exercises(id) on delete cascade,
  type text not null check (type in ('count', 'sets', 'duration', 'distance', 'for-time', 'weighted')),
  target jsonb not null default '{}'::jsonb,
  ref text not null check (ref in ('last-result', 'personal-best')),
  done boolean not null default false,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.logs (
  id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_item_id text references public.schedule_items(id) on delete set null,
  exercise_id text not null references public.exercises(id) on delete cascade,
  date date not null,
  type text not null check (type in ('count', 'sets', 'duration', 'distance', 'for-time', 'weighted')),
  target jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists logs_source_item_id_unique
  on public.logs(source_item_id)
  where source_item_id is not null;

create index if not exists exercises_user_id_name_idx on public.exercises(user_id, name);
create index if not exists plans_user_id_name_idx on public.plans(user_id, name);
create index if not exists plan_days_plan_id_day_number_idx on public.plan_days(plan_id, day_number);
create index if not exists plan_items_plan_day_id_idx on public.plan_items(plan_day_id);
create index if not exists runs_user_id_start_date_idx on public.runs(user_id, start_date);
create index if not exists schedule_days_user_id_date_idx on public.schedule_days(user_id, date);
create index if not exists schedule_items_schedule_day_id_idx on public.schedule_items(schedule_day_id);
create index if not exists logs_user_id_exercise_id_date_idx on public.logs(user_id, exercise_id, date);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists exercises_set_updated_at on public.exercises;
create trigger exercises_set_updated_at
before update on public.exercises
for each row execute function public.set_updated_at();

drop trigger if exists plans_set_updated_at on public.plans;
create trigger plans_set_updated_at
before update on public.plans
for each row execute function public.set_updated_at();

drop trigger if exists plan_days_set_updated_at on public.plan_days;
create trigger plan_days_set_updated_at
before update on public.plan_days
for each row execute function public.set_updated_at();

drop trigger if exists plan_items_set_updated_at on public.plan_items;
create trigger plan_items_set_updated_at
before update on public.plan_items
for each row execute function public.set_updated_at();

drop trigger if exists runs_set_updated_at on public.runs;
create trigger runs_set_updated_at
before update on public.runs
for each row execute function public.set_updated_at();

drop trigger if exists schedule_days_set_updated_at on public.schedule_days;
create trigger schedule_days_set_updated_at
before update on public.schedule_days
for each row execute function public.set_updated_at();

drop trigger if exists schedule_items_set_updated_at on public.schedule_items;
create trigger schedule_items_set_updated_at
before update on public.schedule_items
for each row execute function public.set_updated_at();

drop trigger if exists logs_set_updated_at on public.logs;
create trigger logs_set_updated_at
before update on public.logs
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.exercises enable row level security;
alter table public.plans enable row level security;
alter table public.plan_days enable row level security;
alter table public.plan_items enable row level security;
alter table public.runs enable row level security;
alter table public.schedule_days enable row level security;
alter table public.schedule_items enable row level security;
alter table public.logs enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
for select using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own" on public.profiles
for delete using (auth.uid() = id);

drop policy if exists "exercises_own_all" on public.exercises;
create policy "exercises_own_all" on public.exercises
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "plans_own_all" on public.plans;
create policy "plans_own_all" on public.plans
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "plan_days_own_all" on public.plan_days;
create policy "plan_days_own_all" on public.plan_days
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "plan_items_own_all" on public.plan_items;
create policy "plan_items_own_all" on public.plan_items
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "runs_own_all" on public.runs;
create policy "runs_own_all" on public.runs
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "schedule_days_own_all" on public.schedule_days;
create policy "schedule_days_own_all" on public.schedule_days
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "schedule_items_own_all" on public.schedule_items;
create policy "schedule_items_own_all" on public.schedule_items
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "logs_own_all" on public.logs;
create policy "logs_own_all" on public.logs
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
