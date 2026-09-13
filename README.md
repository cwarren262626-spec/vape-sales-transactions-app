# KuslagVape — Sales Transactions (Web)

A plain HTML/CSS/JS port of the Android app, using Supabase for auth,
database, and stock updates. No build step — just static files.

## Files
- `index.html` — page structure (login screen + 3-tab app shell)
- `style.css` — theme and layout
- `app.js` — all app logic (auth, product search, transactions, product CRUD, stock report)
- `config.js` — **edit this** with your Supabase project URL/key and admin email list
- `schema.sql` — table + RLS setup for a fresh Supabase project

## 1. Supabase setup
1. Create a project at supabase.com (or use your existing one from the Android app).
2. If starting fresh, run `schema.sql` in the SQL editor.
3. In **Authentication → Users**, create the accounts your staff will sign in with (email + password), same as the Android app used.
4. In **Project Settings → API**, copy the **Project URL** and **anon public** key into `config.js`.
5. Update `ADMIN_EMAILS` in `config.js` with whichever accounts should be able to add/edit/delete products and delete transactions.

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

## Security model
- Admin status is decided **twice**: client-side in `app.js` (matching the signed-in email against `ADMIN_EMAILS`, for hiding/showing buttons) and server-side via a Postgres `is_admin()` function in `schema.sql` (for actually enforcing it). If you change who's an admin, update **both** — `ADMIN_EMAILS` in `config.js` and the email list inside `is_admin()` in `schema.sql`.
- Any logged-in user can read products/transactions and create a new transaction (i.e. make a sale). Only admins can add/edit/delete products, or edit/delete an existing transaction — enforced by RLS, not just by hiding the buttons.
- If you already applied the earlier version of `schema.sql` (before admin-only RLS), re-run the updated file — it drops the old "any authenticated user can write" policies before creating the admin-gated ones.

## Notes / assumptions carried over from the Android app
- The `SalesTransactions.quntity` column name keeps the original typo so this is a drop-in fit for an existing database — see the comment in `schema.sql` if you'd rather rename it.
- The original `TransactionsListScreen`/`AdminConfig` Kotlin files weren't included, so the transaction list and admin gating are rebuilt from what `MainActivity.kt` calls (`isAdmin` passed in) rather than copied line-for-line.
