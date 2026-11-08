-- ScopePay Phase 5: milestone payments and verified PayPal webhook events.
-- Apply this after phase4-schema.sql in the Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.scopepay_payments (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.scopepay_proposals(id) on delete cascade,
  milestone_index integer not null check (milestone_index >= 0),
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  paypal_order_id text unique,
  paypal_capture_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

-- A failed attempt can be retried, but each milestone can have only one
-- pending or paid payment at a time.
create unique index if not exists scopepay_payments_one_active_per_milestone_idx
  on public.scopepay_payments (proposal_id, milestone_index)
  where status in ('pending', 'paid');

create index if not exists scopepay_payments_proposal_idx
  on public.scopepay_payments (proposal_id, milestone_index);
create index if not exists scopepay_payments_status_created_idx
  on public.scopepay_payments (status, created_at desc);

create table if not exists public.scopepay_webhook_events (
  id bigint generated always as identity primary key,
  event_id text not null unique,
  event_type text not null,
  resource_id text,
  order_id text,
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processed', 'ignored', 'failed')),
  payload jsonb not null,
  processing_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists scopepay_webhook_events_status_received_idx
  on public.scopepay_webhook_events (processing_status, received_at desc);

alter table public.scopepay_payments enable row level security;
alter table public.scopepay_webhook_events enable row level security;
-- No anon/authenticated policies are created. Server-side service-role access only.
