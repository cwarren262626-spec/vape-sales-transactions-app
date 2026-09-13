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

## Notes / assumptions carried over from the Android app
- The `SalesTransactions.quntity` column name keeps the original typo so this is a drop-in fit for an existing database — see the comment in `schema.sql` if you'd rather rename it.
- Admin status is decided client-side by matching the signed-in email against `ADMIN_EMAILS`, exactly like the Kotlin `AdminConfig.ADMIN_EMAILS` check. The included RLS policies only require "logged in," not "is admin" — if you want the database itself to block non-admins from writing products, say so and I can add a Postgres function that checks the JWT email server-side.
- The original `TransactionsListScreen`/`AdminConfig` Kotlin files weren't included, so the transaction list and admin gating are rebuilt from what `MainActivity.kt` calls (`isAdmin` passed in, delete affordance included for admins) rather than copied line-for-line.
