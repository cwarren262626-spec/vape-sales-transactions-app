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
-- config.js. This function is also called by the "admin-users" Edge
-- Function (supabase/functions/admin-users) to gate user management
-- (add user / change password / delete user) — see README.md.
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

-- ---------------------------------------------------------------
-- Atomic "make a sale" function.
--
-- The web app used to do this as two separate client-side calls:
-- insert the transaction, then read-modify-write stocks_count. That
-- has two problems:
--   1. It's a classic race condition: if two people sell the same
--      product at nearly the same time, both can read the same
--      starting stock count before either writes back, so one sale's
--      decrease silently overwrites the other's instead of stacking.
--   2. Regular (non-admin) staff aren't allowed to update ProductList
--      at all under the RLS policies above — so their stock decrease
--      was being silently rejected on every sale, not just during a
--      race.
--
-- This function fixes both: it runs as a single database transaction
-- with `for update`, which locks the product row so a second,
-- concurrent call has to wait for the first to finish and sees the
-- already-updated stock — no lost updates. It's declared
-- `security definer` so it can update ProductList on behalf of any
-- authenticated user for this one, tightly-scoped operation, without
-- opening up general product-editing rights to non-admins.
-- ---------------------------------------------------------------
create or replace function record_sale(
  p_product_id bigint,
  p_qty integer,
  p_amount numeric,
  p_remarks text
)
returns "SalesTransactions"
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product "ProductList"%rowtype;
  v_display_name text;
  v_new_tx "SalesTransactions"%rowtype;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'Quantity must be greater than zero';
  end if;

  if p_amount is null or p_amount < 0 then
    raise exception 'Amount must be zero or greater';
  end if;

  -- Row lock: a second concurrent call blocks here until this one
  -- commits, then sees the up-to-date stock count. This is the part
  -- that actually prevents the discrepancy.
  select * into v_product from "ProductList" where id = p_product_id for update;

  if not found then
    raise exception 'Product not found';
  end if;

  if v_product.stocks_count < p_qty then
    raise exception 'Only % in stock', v_product.stocks_count;
  end if;

  v_display_name := v_product.product_name
    || case when v_product.flavor is not null and v_product.flavor <> ''
         then ' • ' || v_product.flavor else '' end;

  insert into "SalesTransactions" ("ProductName", quntity, amount, "SalesPerson", remarks)
  values (v_display_name, p_qty, p_amount, coalesce(auth.jwt() ->> 'email', ''), nullif(p_remarks, ''))
  returning * into v_new_tx;

  update "ProductList"
    set stocks_count = stocks_count - p_qty
    where id = p_product_id;

  return v_new_tx;
end;
$$;

-- Let any signed-in user call it (it's the safe, narrow operation —
-- not general update rights on ProductList).
grant execute on function record_sale(bigint, integer, numeric, text) to authenticated;
