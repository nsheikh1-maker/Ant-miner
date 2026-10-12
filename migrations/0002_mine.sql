create table if not exists mine_config (
  id integer primary key,
  owner_salt text,
  owner_hash text,
  wallet text not null default '',
  network text not null default 'mainnet',
  shop_enabled boolean not null default false,
  multiplier double precision not null default 1,
  announcement text not null default '',
  maintenance boolean not null default false,
  packs_json text not null default ''
);

insert into mine_config (id)
values (1)
on conflict (id) do nothing;

create table if not exists mine_scores (
  user_id text primary key,
  name text not null,
  total double precision not null,
  level integer not null,
  hidden boolean not null default false,
  supporter boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists mine_scores_board_idx on mine_scores (hidden, total desc);

create table if not exists mine_flags (
  user_id text primary key,
  supporter boolean not null default false
);

create table if not exists mine_grants (
  user_id text primary key,
  ant_total double precision not null default 0
);

create table if not exists mine_orders (
  id text primary key,
  user_id text not null,
  payer_name text not null,
  kind text not null,
  pack_id text,
  lamports bigint not null,
  ant_credit double precision not null default 0,
  wallet text not null,
  network text not null,
  reference_key text not null,
  signature text,
  status text not null default 'pending',
  credited boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists mine_orders_signature_idx on mine_orders (signature) where signature is not null;
create index if not exists mine_orders_user_idx on mine_orders (user_id, created_at desc);
