-- Additive, non-destructive authoritative serial ledger.
create table if not exists serial_counters(namespace text primary key,last_serial bigint not null,updated_at timestamptz not null default now(),constraint serial_counters_nonnegative check(last_serial>=0));
create table if not exists serial_allocations(
 serial_number bigint primary key,namespace text not null default 'dashboard',machine_identity text not null unique,order_id text not null,sales_order_number text not null default '',machine_unit_id text not null,idempotency_key text not null unique,qr_token text not null unique,
 status text not null check(status in ('allocated_pending','generated','processed','dispatched','voided')),source text not null default 'dashboard',allocated_at timestamptz not null default now(),generated_at timestamptz,processed_at timestamptz,dispatched_at timestamptz,voided_at timestamptz,updated_at timestamptz not null default now(),metadata jsonb not null default '{}'::jsonb);
create table if not exists serial_allocation_events(id bigserial primary key,serial_number bigint not null references serial_allocations(serial_number),event_type text not null,from_status text,to_status text,detail jsonb not null default '{}'::jsonb,created_at timestamptz not null default now());
create table if not exists serial_workflow_mirrors(machine_identity text primary key,serial_number bigint not null references serial_allocations(serial_number),state text not null default 'pending' check(state in ('pending','mirrored')),attempts integer not null default 0,last_error text,updated_at timestamptz not null default now());
create index if not exists serial_allocations_order_idx on serial_allocations(order_id);
create index if not exists serial_allocations_status_idx on serial_allocations(status);
create index if not exists serial_workflow_mirrors_pending_idx on serial_workflow_mirrors(state) where state='pending';
insert into serial_counters(namespace,last_serial) values('dashboard',26270758) on conflict do nothing;
