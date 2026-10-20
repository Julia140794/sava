-- Дополнение к существующим заявкам: НЕ удаляет и НЕ меняет leads.
create table if not exists public.telegram_bookings (
 id uuid primary key references public.leads(id) on delete cascade,
 token_hash text not null unique check (char_length(token_hash) = 64),
 expires_at timestamptz not null,
 created_at timestamptz not null default now(),
 client_chat_id text,
 owner_notified_at timestamptz,
 service text not null check (char_length(service) <= 100),
 owner_prompt_id bigint,
 prompt_expires_at timestamptz,
 appointment_at timestamptz,
 preview_nonce text,
 delivery_status text not null default 'pending'
   check (delivery_status in ('pending', 'sending', 'delivered', 'uncertain')),
 confirmed_at timestamptz,
 telegram_message_id bigint
);
alter table public.telegram_bookings enable row level security;
revoke all on public.telegram_bookings from anon, authenticated;
