-- Run this in the Supabase SQL editor for a fresh project.
-- If you already have these tables from the Android app, skip this
-- and just make sure RLS is enabled + policies below exist.

create table if not exists "ProductList" (
  id bigint generated always as identity primary key,
  product_name text not null,
  brand text,
  flavor text,
  stocks_count integer not null default 0,
  created_at timestamptz not null default now()
);

-- Note: column name "quntity" is a preserved typo from the original
-- Android app's schema so this stays a drop-in replacement. Rename
-- it (and the reference in app.js) if you'd rather fix it.
create table if not exists "SalesTransactions" (
  id bigint generated always as identity primary key,
  "ProductName" text not null,
  quntity integer not null,
  amount numeric not null,
  "SalesPerson" text not null,
  remarks text,
  created_at timestamptz not null default now()
);

alter table "ProductList" enable row level security;
alter table "SalesTransactions" enable row level security;

-- Any authenticated user can read/write products & transactions.
-- Tighten these further (e.g. restrict product writes to admins)
-- using a Postgres function that checks auth.jwt() ->> 'email'
-- against your admin list if you want DB-level enforcement to
-- match the app's client-side admin check.
create policy "Authenticated read products" on "ProductList"
  for select using (auth.role() = 'authenticated');
create policy "Authenticated write products" on "ProductList"
  for insert with check (auth.role() = 'authenticated');
create policy "Authenticated update products" on "ProductList"
  for update using (auth.role() = 'authenticated');
create policy "Authenticated delete products" on "ProductList"
  for delete using (auth.role() = 'authenticated');

create policy "Authenticated read transactions" on "SalesTransactions"
  for select using (auth.role() = 'authenticated');
create policy "Authenticated write transactions" on "SalesTransactions"
  for insert with check (auth.role() = 'authenticated');
create policy "Authenticated delete transactions" on "SalesTransactions"
  for delete using (auth.role() = 'authenticated');
