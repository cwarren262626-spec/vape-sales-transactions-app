-- Run this in the Supabase SQL editor for a fresh project.
-- If you already have these tables from the Android app, skip the
-- CREATE TABLE statements and just apply the RLS section below.

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

-- ---------------------------------------------------------------
-- Admin check, enforced at the database level (not just hidden
-- buttons in the UI). Keep this list in sync with ADMIN_EMAILS in
-- config.js.
-- ---------------------------------------------------------------
create or replace function is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') in (
    'crisostomo.warren.26@gmail.com'
  );
$$;

-- Drop old policies first (safe to run even on a fresh project,
-- and lets you re-run this file after editing is_admin()'s list).
drop policy if exists "Authenticated read products" on "ProductList";
drop policy if exists "Authenticated write products" on "ProductList";
drop policy if exists "Authenticated update products" on "ProductList";
drop policy if exists "Authenticated delete products" on "ProductList";
drop policy if exists "Admin write products" on "ProductList";
drop policy if exists "Admin update products" on "ProductList";
drop policy if exists "Admin delete products" on "ProductList";

drop policy if exists "Authenticated read transactions" on "SalesTransactions";
drop policy if exists "Authenticated write transactions" on "SalesTransactions";
drop policy if exists "Authenticated create transactions" on "SalesTransactions";
drop policy if exists "Authenticated delete transactions" on "SalesTransactions";
drop policy if exists "Admin update transactions" on "SalesTransactions";
drop policy if exists "Admin delete transactions" on "SalesTransactions";

-- Products: everyone logged in can read (needed for the New
-- Transaction dropdown); only admins can add/edit/delete.
create policy "Authenticated read products" on "ProductList"
  for select using (auth.role() = 'authenticated');
create policy "Admin write products" on "ProductList"
  for insert with check (is_admin());
create policy "Admin update products" on "ProductList"
  for update using (is_admin());
create policy "Admin delete products" on "ProductList"
  for delete using (is_admin());

-- Transactions: everyone logged in can read and create a sale;
-- only admins can edit or delete an existing record.
create policy "Authenticated read transactions" on "SalesTransactions"
  for select using (auth.role() = 'authenticated');
create policy "Authenticated create transactions" on "SalesTransactions"
  for insert with check (auth.role() = 'authenticated');
create policy "Admin update transactions" on "SalesTransactions"
  for update using (is_admin());
create policy "Admin delete transactions" on "SalesTransactions"
  for delete using (is_admin());
