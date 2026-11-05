# B&B CashDesk

A mobile-friendly cash-flow and cheque manager for Books & Buns. Built with React, TypeScript, Vite, Tailwind, Radix UI primitives, Recharts, and Supabase. Amounts and reports use LKR; business dates use `Asia/Colombo`.

## Run locally

Use Node 24 LTS (Node >=22.12 also works with Vite) and npm.

```sh
npm ci
npm run dev
```

With no environment variables, CashDesk opens a **clearly labelled local demo**. All sample people, balances, transactions, and contact information are fictional. The demo persists changes in this browser's local storage. It is suitable for evaluation, not shared financial operations. Settings offers JSON backup, validated restore, and reset.

## What works

- Responsive overview with account balances, daily cash flow, upcoming payments, and alerts.
- Income and expense entry, exact minor-unit arithmetic, branch filtering, search, dates, and pagination.
- Bank, cash till, and petty-cash accounts with opening balances and calculated ledger balances.
- Issued and received cheques; presented, cleared, returned, and cancelled states. A row-locked database operation creates exactly one movement at clearance. Cheque identity and settlement have unique constraints.
- Supplier profiles, credit purchases, outstanding balances, and payment statements.
- In-app reminders for the next seven days, overdue cheques, and returned cheques.
- Daily, weekly, and monthly actual cash-flow reports, genuine PDF/XLSX downloads, and a cheque-based 30-day outlook.
- Owner, manager, and staff permissions, branch access policies, and append-only financial records with audit events.
- Supabase password login and password change when connected; local demo opens without pretending to authenticate.
- PWA manifest, application icons, and static-shell caching. The service worker does **not** cache Supabase API responses or queue offline financial writes.
- Server-side scheduled email delivery implementation with bounded retry, claim tokens, and provider idempotency keys. **Requires external configuration; email is not sent in the demo.**

## Financial rules

`Actual balance = opening balance + recorded income − recorded expenses`.

Registering, presenting, returning, or cancelling a cheque does not change cash. Clearing adds one expense for an issued cheque or one income movement for a received cheque, with the actual clearing date. Cleared/cancelled records cannot be reopened. Returned cheques must be re-presented before clearance. Received cheques cannot settle supplier purchases. Staff cannot clear cheques or create accounts. Only owners can change team roles, and the last owner cannot be removed.

Supplier balances are total recorded invoices minus actual supplier expense payments, including cleared supplier-linked cheques. A credit balance is shown separately. Payments are on-account; individual invoice allocation is not part of this MVP.

The forecast uses registered outstanding cheques, counts overdue commitments on day one, and excludes returned/cleared/cancelled cheques. It does not invent future sales or planned expenses.

## Connect Supabase and email

Follow [the deployment guide](docs/deployment.md). Create a project, apply the SQL migrations, create an Auth owner, and provision their company/branches. Then configure **both** public client variables from `.env.example` in a local `.env` or the hosting build settings:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Use only the public/publishable client key. Never put a service-role key, Resend key, or Cron secret in a `VITE_` variable. A connected workspace starts empty; demo records are never uploaded into it. Client environment variables are compiled into the bundle, so rebuild after changing them.

Company/team provisioning and branch grants are administrator tasks described in the deployment guide; the application manages roles for existing members. A user belongs to one company in this MVP. New branches are provisioned by the administrator.

## Checks

```sh
npm run build       # TypeScript + production bundle
npm test            # Domain rules and actual PostgreSQL migrations/RLS/RPCs in PGlite
npm run test:e2e    # Desktop + mobile Chromium workflows against the built dist/
```

Build before E2E. The tests use system Chromium at `/usr/bin/chromium` when available. Else set `PLAYWRIGHT_CHROMIUM_PATH` or run `npx playwright install chromium` once. Tests exercise persistence, cheque issue/clearance, supplier invoices/payments, filtering, actual export downloads, backup/restore, branch selection, and phone navigation. PostgreSQL tests emulate Supabase's `auth.uid()`/roles; they do not substitute for a hosted Auth/Resend integration test.

## Deploy to Vercel + Supabase

Import this repository into Vercel with the Vite preset. The supplied `vercel.json` sets `npm ci`, `npm run build`, the `dist` output directory, SPA routing, and response headers.

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in Vercel's project environment variables for the intended Production/Preview environments, then redeploy. These are the public client settings; server secrets stay in Supabase. Without both settings the app opens the labelled local demo instead of your hosted database.

Set the production Vercel URL as the Supabase Auth Site URL and configure only the redirect URLs you intend to use. Verify sign-in with a provisioned member and directly open `/cheques` and `/reports` after deployment. See [the deployment guide](docs/deployment.md) for migrations, owner/branch setup, and email reminders.

## Alternative: Cloudflare Workers

```sh
npm run build
npx wrangler deploy
```

`wrangler.jsonc` serves `dist/` with SPA fallback. No deployment is performed automatically. Security headers for Workers Static Assets and Pages are in `public/_headers`. Supabase and Resend have separate deployment/configuration requirements. Do not rely on quoted free-tier limits without checking current provider documentation.

## Scope and operations

The app implements the Phase 1 workflow plus supplier records, exports, branch-aware reports, and the reminder backend. POS integration, SMS/WhatsApp, bank statement import/reconciliation, automatic daily database backup scheduling, receipt/image uploads, and invoice-by-invoice payment allocation remain future work. The current forecast covers cheques, not a full accounting budget.

Before live use, validate hosted Auth, RLS with your provisioned users, the Cron invocation and verified email sender, delivery monitoring, and database backup restoration in your own project. The local development workflow is tested independently of those external services.

See [architecture](docs/architecture.md) for the source layout and storage boundaries.
