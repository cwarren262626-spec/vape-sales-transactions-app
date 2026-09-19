# KuslagVape — Sales Transactions (Web)

A plain HTML/CSS/JS port of the Android app, using Supabase for auth,
database, and stock updates. No build step — just static files.

## Files
- `index.html` — page structure (login screen + tabbed app shell)
- `style.css` — theme and layout (refined dark UI)
- `app.js` — all app logic (auth, product search, transactions, product CRUD, stock report, user management)
- `config.js` — **edit this** with your Supabase project URL/key and admin email list
- `schema.sql` — table + RLS setup for a fresh Supabase project
- `supabase/functions/admin-users/index.ts` — Edge Function that powers the Users tab (see below)

## 1. Supabase setup
1. Create a project at supabase.com (or use your existing one from the Android app).
2. If starting fresh, run `schema.sql` in the SQL editor.
3. In **Authentication → Users**, create the accounts your staff will sign in with (email + password), same as the Android app used — or use the new **Users** tab in the app itself (see below).
4. In **Project Settings → API**, copy the **Project URL** and **anon public** key into `config.js`.
5. Update `ADMIN_EMAILS` in `config.js` with whichever accounts should be able to add/edit/delete products, manage transactions, and manage users. Also update the matching list inside `is_admin()` in `schema.sql`.

## 2. Run locally
Just open `index.html` in a browser, or serve the folder with any static server, e.g.:
```
npx serve .
```

## 3. Deploy via GitHub + Cloudflare Pages
1. Push this folder to a GitHub repo.
2. In Cloudflare Pages, create a project connected to that repo.
3. Build settings: **no build command**, output directory `/` (root) — it's a static site.
4. Deploy. Cloudflare will give you a `*.pages.dev` URL (and you can attach a custom domain).

## 4. User management (Users tab)
The **Users** tab (visible to admins only) lets an admin create a new
login, change any user's password, or remove a user — without going
into the Supabase dashboard.

This can't be done safely with the public `anon` key that ships in
`config.js` — creating accounts or setting someone else's password
requires Supabase's `service_role` key, which must **never** be sent
to a browser. So this feature is backed by a small Edge Function that
holds that key on the server instead, and re-checks `is_admin()` on
every call before doing anything.

To turn it on:
1. Install the Supabase CLI and log in: `supabase login`
2. Link the CLI to your project: `supabase link --project-ref <your-project-ref>`
3. Deploy the function:
   ```
   supabase functions deploy admin-users
   ```
   No extra secrets to configure — `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically to every
   Edge Function in your project.
4. That's it — the Users tab calls this function automatically
   (`supabaseClient.functions.invoke("admin-users", ...)`), using the
   signed-in admin's own session.

If the Users tab shows a "Failed to load users" error, it almost
always means step 3 hasn't been done yet for this project.

## Security model
- Admin status is decided in three places, and all three must stay in sync: client-side in `app.js` (matching the signed-in email against `ADMIN_EMAILS`, for hiding/showing buttons), server-side via the Postgres `is_admin()` function in `schema.sql` (enforced by RLS on `ProductList`/`SalesTransactions`), and inside the `admin-users` Edge Function, which calls that same `is_admin()` before touching any account. If you change who's an admin, update `ADMIN_EMAILS` in `config.js` **and** the email list inside `is_admin()` in `schema.sql`.
- Any logged-in user can read products/transactions and create a new transaction (i.e. make a sale). Only admins can add/edit/delete products, edit/delete an existing transaction, or manage users — enforced by RLS (and, for user management, by the Edge Function), not just by hiding the buttons.
- If you already applied the earlier version of `schema.sql` (before admin-only RLS), re-run the updated file — it drops the old "any authenticated user can write" policies before creating the admin-gated ones.

## What changed in this pass (latest)
- **Sales trend chart moved off Transactions and onto the Dashboard**, and rebuilt as an animated inline SVG: a 14-day gradient area chart where the line draws itself in, the fill rises under it, points pop in on a stagger, and the best day's marker keeps a slow pulse. Hovering any point shows the date and that day's revenue. The Transactions tab is now just the filter + list.
- **Top products is now a real animated bar chart** (inline SVG, no chart library): gradient horizontal bars that grow from the left on a stagger, with a shine sweep, rank badges, and a hover tooltip per bar.
- **Fixed the oversized nav selection on desktop.** The sidebar is a column flex container, but the nav buttons kept the mobile `flex: 1`, so each one stretched to fill the whole viewport height — making the active item's highlight look enormous. They're now `flex: 0 0 auto` (natural height).
- **Layout is fluid now.** The content area and the mobile tab bar no longer cap at a fixed 640px / 1120px; they use all available width, and the product/user grids reflow into as many columns as fit on wide screens.
- Both charts respect `prefers-reduced-motion` — they render in their final state with no animation for anyone who's asked for that.

## What changed in the previous pass
- Visual refresh: new dark palette, type scale, SVG tab icons (swapped out the emoji), pill-shaped chips, centered modals with a scale/fade transition, an avatar + role chip in the top bar, and general spacing/contrast cleanup across every screen.
- **Transactions** tab now has a **Filter by user** dropdown, built from whoever has an actual sale on record.
- New **Users** tab (admin-only): list accounts, add a user, change a user's password, or delete a user — via the `admin-users` Edge Function described above.
- New **Dashboard** tab (admin-only): total revenue, transaction count, units sold, stock on hand, out-of-stock/low-stock counts, top products, top salespeople, and recent activity.
- Fixed a bug where the Products nav button had an `admin-only-nav` id but was never actually hidden from non-admins — the Users/Dashboard tabs are now the ones gated that way; Products stays visible to everyone (matching the existing RLS, which lets any signed-in user read the product list).
- Fixed a bug where the two floating "+" buttons (add product / add user) could stay visible after switching tabs or switching accounts in the same browser tab — their visibility is now decided in one place (`switchTab`), tied directly to the current tab and role, every time.
- **Made "record a sale" atomic** (`record_sale()` in `schema.sql`, called via `supabaseClient.rpc(...)` in `app.js`). Previously, saving a transaction and decreasing stock were two separate client-side steps, which had two problems: (1) a race condition where two simultaneous sales of the same product could each read the same starting stock count and one's decrease would silently overwrite the other's, and (2) non-admin staff weren't allowed to update `ProductList` under RLS at all, so their stock decrease was quietly failing on every sale. The new function does both steps as one locked database transaction, so concurrent sales stack correctly and non-admins can sell without hitting a permissions wall. **You need to re-run the updated `schema.sql` in the SQL editor for this to take effect.**

## Notes / assumptions carried over from the Android app
- The `SalesTransactions.quntity` column name keeps the original typo so this is a drop-in fit for an existing database — see the comment in `schema.sql` if you'd rather rename it.
- The original `TransactionsListScreen`/`AdminConfig` Kotlin files weren't included, so the transaction list and admin gating are rebuilt from what `MainActivity.kt` calls (`isAdmin` passed in) rather than copied line-for-line.
