-- ScopePay Phase 4: persistent proposals and client responses
create extension if not exists pgcrypto;

create table if not exists public.scopepay_proposals (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  proposal jsonb not null,
  status text not null default 'pending_client' check (status in ('pending_client','approved','revision_requested','rejected','expired')),
  client_token_hash text not null unique,
  client_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz
);

create table if not exists public.scopepay_proposal_events (
  id bigint generated always as identity primary key,
  proposal_id uuid not null references public.scopepay_proposals(id) on delete cascade,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists scopepay_proposals_status_idx on public.scopepay_proposals(status);
create index if not exists scopepay_proposals_expiry_idx on public.scopepay_proposals(expires_at);
create index if not exists scopepay_events_proposal_idx on public.scopepay_proposal_events(proposal_id, created_at desc);

alter table public.scopepay_proposals enable row level security;
alter table public.scopepay_proposal_events enable row level security;
-- No anon/authenticated policies are intentionally created. Only the server-side
-- service-role key can access these tables; never expose that key in browser code.
