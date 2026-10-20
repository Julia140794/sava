create table if not exists public.leads (
 id uuid primary key default gen_random_uuid(),
 created_at timestamptz not null default now(),
 name text not null check (char_length(name) between 1 and 100),
 phone text not null check (char_length(phone) between 7 and 30),
 service text not null check (char_length(service) <= 100),
 message text not null default '' check (char_length(message) <= 1000),
 page text check (char_length(page) <= 2000),
 utm jsonb not null default '{}',
 consent boolean not null check (consent = true)
);
alter table public.leads enable row level security;
revoke all on public.leads from anon, authenticated;
