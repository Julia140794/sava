-- Выполнить после leads.sql и telegram-confirmations.sql. Старые заявки сохраняются.
begin;
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
set local search_path = public, extensions, pg_catalog;

create table if not exists public.calendar_services (
 id text primary key, name text not null, duration_minutes integer not null check(duration_minutes between 15 and 240)
);
create table if not exists public.calendar_staff(id text primary key, name text not null);
create table if not exists public.calendar_staff_services (
 staff_id text references public.calendar_staff(id), service_id text references public.calendar_services(id), primary key(staff_id,service_id)
);
insert into public.calendar_staff values('yulia','Юлия'),('olga','Ольга') on conflict(id) do update set name=excluded.name;
insert into public.calendar_services values
 ('face-60','Массаж лица ручной — 60 минут',60),('face-90','Массаж лица ручной — 90 минут',90),
 ('body-60','Массаж тела расслабляющий — 60 минут',60),('body-90','Массаж тела расслабляющий — 90 минут',90),
 ('shape-60','Коррекция фигуры ручная — 60 минут',60),('shape-90','Коррекция фигуры ручная — 90 минут',90),
 ('manicure-bare','Маникюр без покрытия',60),('manicure-polish','Маникюр с долговременным покрытием',120),
 ('pedicure-bare','Педикюр гигиенический без покрытия',60),('pedicure-polish','Педикюр с обработкой и покрытием',90),
 ('seas','Занятие SEAS для детей',45)
 on conflict(id) do update set name=excluded.name,duration_minutes=excluded.duration_minutes;
insert into public.calendar_staff_services select 'yulia',id from public.calendar_services on conflict do nothing;
insert into public.calendar_staff_services values('olga','manicure-bare'),('olga','manicure-polish'),('olga','pedicure-bare') on conflict do nothing;

create table if not exists public.calendar_appointments (
 id uuid primary key default gen_random_uuid(),
 lead_id uuid unique references public.leads(id) on delete cascade,
 request_key uuid unique,
 staff_id text not null references public.calendar_staff(id),
 service_id text references public.calendar_services(id),
 kind text not null default 'booking' check(kind in('booking','block')),
 state text not null default 'pending' check(state in('pending','confirmed','cancelled')),
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 busy_until timestamptz not null,
 created_at timestamptz not null default now(),
 check(starts_at<ends_at and ends_at<=busy_until),
 check((kind='booking' and lead_id is not null and service_id is not null and request_key is not null) or
       (kind='block' and lead_id is null and service_id is null))
);
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.calendar_appointments'::regclass and conname='calendar_staff_no_overlap') then
  alter table public.calendar_appointments add constraint calendar_staff_no_overlap
   exclude using gist(staff_id with =,tstzrange(starts_at,busy_until,'[)') with &&) where(state<>'cancelled');
 end if;
end $$;

create or replace function public.calendar_validate_appointment() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare local_start timestamp; local_end timestamp; duration integer;
begin
 if new.kind='block' then new.busy_until:=new.ends_at; return new; end if;
 select duration_minutes into duration from public.calendar_services where id=new.service_id;
 if duration is null or not exists(select 1 from public.calendar_staff_services where staff_id=new.staff_id and service_id=new.service_id) then
  raise exception 'CALENDAR_SERVICE_NOT_AVAILABLE' using errcode='22023';
 end if;
 new.ends_at:=new.starts_at+duration*interval '1 minute';
 new.busy_until:=new.ends_at+interval '15 minutes';
 local_start:=new.starts_at at time zone 'Europe/Minsk'; local_end:=new.busy_until at time zone 'Europe/Minsk';
 if extract(isodow from local_start)=7 or local_start::time<time '09:00' or local_end::date<>local_start::date or local_end::time>time '22:00'
    or extract(minute from local_start)::integer%15<>0 or extract(second from local_start)<>0 then
  raise exception 'CALENDAR_OUTSIDE_HOURS' using errcode='22023';
 end if;
 return new;
end $$;
drop trigger if exists calendar_validate on public.calendar_appointments;
create trigger calendar_validate before insert or update on public.calendar_appointments for each row execute function public.calendar_validate_appointment();

create or replace function public.calendar_availability(p_staff text,p_service text,p_date date)
returns table(starts_at timestamptz) language plpgsql security definer set search_path=public,pg_temp as $$
declare duration integer; day_start timestamptz; day_end timestamptz;
begin
 if p_date<(now() at time zone 'Europe/Minsk')::date or p_date>(now() at time zone 'Europe/Minsk')::date+60 then
  raise exception 'CALENDAR_DATE_RANGE' using errcode='22023';
 end if;
 select s.duration_minutes into duration from public.calendar_services s join public.calendar_staff_services x on x.service_id=s.id where s.id=p_service and x.staff_id=p_staff;
 if duration is null then raise exception 'CALENDAR_SERVICE_NOT_AVAILABLE' using errcode='22023';end if;
 if extract(isodow from p_date)=7 then return;end if;
 day_start:=(p_date+time '09:00') at time zone 'Europe/Minsk';day_end:=(p_date+time '22:00') at time zone 'Europe/Minsk';
 return query select slot from generate_series(day_start,day_end-(duration+15)*interval '1 minute',interval '15 minutes') slot
 where slot>=now()+interval '1 hour' and not exists(select 1 from public.calendar_appointments a where a.staff_id=p_staff and a.state<>'cancelled' and tstzrange(a.starts_at,a.busy_until,'[)')&&tstzrange(slot,slot+(duration+15)*interval '1 minute','[)')) order by slot;
end $$;

create or replace function public.calendar_reserve(p_request_key uuid,p_service text,p_staff text,p_start timestamptz,p_name text,p_phone text,p_message text,p_page text,p_utm jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare existing public.calendar_appointments; lead uuid; service_name text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_request_key::text,0));
 select * into existing from public.calendar_appointments where request_key=p_request_key;
 if found then
  if existing.staff_id<>p_staff or existing.service_id<>p_service or existing.starts_at<>p_start or
    not exists(select 1 from public.leads where id=existing.lead_id and name=p_name and phone=p_phone) then
    raise exception 'CALENDAR_REQUEST_REUSED' using errcode='22023';end if;
  if existing.state='cancelled' then raise exception 'CALENDAR_CANCELLED' using errcode='22023';end if;
  return jsonb_build_object('lead_id',existing.lead_id,'already_existed',true);
 end if;
 if p_start<now()+interval '1 hour' or (p_start at time zone 'Europe/Minsk')::date>(now() at time zone 'Europe/Minsk')::date+60 then
  raise exception 'CALENDAR_DATE_RANGE' using errcode='22023';end if;
 select name into service_name from public.calendar_services where id=p_service;
 if service_name is null then raise exception 'CALENDAR_SERVICE_NOT_AVAILABLE' using errcode='22023';end if;
 insert into public.leads(name,phone,service,message,page,utm,consent) values(p_name,p_phone,service_name,p_message,p_page,coalesce(p_utm,'{}'::jsonb),true) returning id into lead;
 -- Trigger calculates the service end and cleanup interval. Exclusion makes concurrent bookings safe.
 insert into public.calendar_appointments(lead_id,request_key,staff_id,service_id,starts_at,ends_at,busy_until)
 values(lead,p_request_key,p_staff,p_service,p_start,p_start+interval '1 minute',p_start+interval '1 minute');
 return jsonb_build_object('lead_id',lead,'already_existed',false);
end $$;

create or replace function public.calendar_move(p_lead uuid,p_start timestamptz)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform 1 from public.calendar_appointments where lead_id=p_lead and state<>'cancelled' for update;
 if not found then raise exception 'CALENDAR_CANCELLED' using errcode='22023';end if;
 if p_start<now()+interval '1 hour' or (p_start at time zone 'Europe/Minsk')::date>(now() at time zone 'Europe/Minsk')::date+60 then
  raise exception 'CALENDAR_DATE_RANGE' using errcode='22023';end if;
 if exists(select 1 from public.telegram_bookings where id=p_lead and delivery_status<>'pending') then
  raise exception 'CALENDAR_CONFIRMATION_LOCKED' using errcode='22023';end if;
 update public.calendar_appointments set starts_at=p_start,state='pending' where lead_id=p_lead;
end $$;

create or replace function public.calendar_cancel(p_lead uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare current_state text;
begin
 select state into current_state from public.calendar_appointments where lead_id=p_lead for update;
 if not found then raise exception 'CALENDAR_NOT_FOUND' using errcode='22023';end if;
 if current_state='cancelled' then return false;end if;
 if exists(select 1 from public.telegram_bookings where id=p_lead and delivery_status='sending') then
  raise exception 'CALENDAR_CONFIRMATION_LOCKED' using errcode='22023';end if;
 update public.calendar_appointments set state='cancelled' where lead_id=p_lead;
 update public.telegram_bookings set preview_nonce=null,owner_prompt_id=null where id=p_lead;
 return true;
end $$;

create or replace function public.calendar_prepare_confirmation(p_lead uuid,p_nonce text)
returns setof public.telegram_bookings language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform 1 from public.calendar_appointments where lead_id=p_lead and state<>'cancelled' for update;
 if not found then return;end if;
 return query update public.telegram_bookings t set delivery_status='sending'
 where t.id=p_lead and t.delivery_status='pending' and t.preview_nonce=p_nonce and t.client_chat_id is not null
 and t.appointment_at=(select a.starts_at from public.calendar_appointments a where a.lead_id=p_lead) returning t.*;
 if found then update public.calendar_appointments set state='confirmed' where lead_id=p_lead;end if;
end $$;

alter table public.calendar_services enable row level security;
alter table public.calendar_staff enable row level security;
alter table public.calendar_staff_services enable row level security;
alter table public.calendar_appointments enable row level security;
revoke all on public.calendar_services,public.calendar_staff,public.calendar_staff_services,public.calendar_appointments from anon,authenticated;
revoke all on function public.calendar_validate_appointment() from public,anon,authenticated;
revoke all on function public.calendar_availability(text,text,date),public.calendar_reserve(uuid,text,text,timestamptz,text,text,text,text,jsonb),public.calendar_move(uuid,timestamptz),public.calendar_cancel(uuid),public.calendar_prepare_confirmation(uuid,text) from public,anon,authenticated;
grant execute on function public.calendar_availability(text,text,date),public.calendar_reserve(uuid,text,text,timestamptz,text,text,text,text,jsonb),public.calendar_move(uuid,timestamptz),public.calendar_cancel(uuid),public.calendar_prepare_confirmation(uuid,text) to service_role;
grant all on public.calendar_services,public.calendar_staff,public.calendar_staff_services,public.calendar_appointments to service_role;
notify pgrst, 'reload schema';
commit;
