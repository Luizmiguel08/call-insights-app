create table if not exists public.system_flags (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value boolean not null default false,
  updated_at timestamptz not null default now()
);

grant select on public.system_flags to authenticated;
grant select on public.system_flags to anon;
grant all on public.system_flags to service_role;

alter table public.system_flags enable row level security;

create policy "Allow public read of system_flags"
  on public.system_flags
  for select
  to anon, authenticated
  using (true);

create policy "Only service_role can write system_flags"
  on public.system_flags
  for all
  to service_role
  using (true)
  with check (true);

insert into public.system_flags (key, value)
values ('maintenance_mode', true)
on conflict (key) do update set value = true, updated_at = now();