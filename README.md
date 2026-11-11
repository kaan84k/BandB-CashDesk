# B&B CashDesk — cafe cashbook

A simple cashbook for a cafe that buys products from suppliers and sells them. Track daily cash, bank deposits, money in your personal safe, and cheques. Amounts are in LKR and dates use Sri Lanka time.

## Your daily routine

1. **Open day:** count the cash in your drawer and record the opening balance.
2. **Record income and expenses:** sales, supplier purchases, rent, bills, and other money paid or received.
3. **Move money:** record a deposit to the bank, money kept in your safe, or money brought back to the drawer.
4. **Track cheques:** record issued/received cheques and confirm their bank status. Upcoming, overdue, and returned cheques appear in Reminders.
5. **Close day:** count your closing cash. Any difference from the expected amount is recorded separately, with your note.
6. **Reports:** view and export opening/closing cash, cash flow, bank/safe transfers, and cheques as PDF or Excel. PDFs use landscape A4 grids, embedded Poppins, aligned decimal amounts, repeated column headings and page numbers.

There are no bakery production, stock, multi-branch, or supplier-credit screens.

## Owner and data-entry logins

Owners use the full cashbook, balances, reminders, reports, backups and team settings. Invite a teammate from **Team & access** using their own email. They accept the invitation to join the **same cafe** with data-entry access. New users set a password through Supabase Auth’s invitation email; existing users sign in to accept. Invitations expire after 7 days and can be revoked.

Data-entry staff can record income, expenses, transfers, issued/received cheques, and physical opening/closing cash counts. Their workspace has no dashboard, balances, transaction history, reminders, reports or exports. Cash counts start blank and require a note. Only owners/managers confirm cheque clearance. SQL policies and RPC checks enforce these restrictions even outside the interface; submissions retain the actor and time in the owner’s audit log. Existing manager memberships keep financial access; only owners manage invitations and roles.

## Important money rules

- Transfers move money between accounts. They do **not** count as sales or expenses, and do not change your total money.
- Opening and closing cash counts are separate from income/expenses. Count differences are visible adjustments, never hidden changes.
- A closed cash day cannot receive new cash entries. Record corrections on an open day.
- Registering a cheque does not move bank money. Clearing it records exactly one movement.
- Repeating a save after a lost network response does not record the same movement twice.

## Run locally

Use Node **24** and npm:

```sh
npm ci
npm run dev
```

With no public Supabase settings, local development opens a clearly labelled demo containing fictional cafe records. Demo changes stay in that browser. Existing demo storage and older JSON backups are preserved and supported. Settings provides backup, restore, and reset.

## Vercel + Supabase

The production frontend is intended for <https://band-b-cash-desk.vercel.app>.

Set these public variables in Vercel (or use the supported Supabase integration aliases):

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_ANON_KEY`, and `VITE_SUPABASE_ANON_KEY` are accepted. Only public settings are included in the browser bundle. Secret/service-role keys are rejected as frontend keys.

Vercel builds require a configured Supabase connection. An intentional hosted demo requires `VITE_CASHDESK_DEMO=true`; a production build no longer silently falls back to browser-only records.

Apply the migrations in `supabase/migrations` through the native Supabase GitHub integration or the supplied deployment workflow. **Schema version 5** includes the daily cashbook, bank/safe transfers, private data-entry access and staff invitations. The app checks this before opening a connected cashbook. Do not reapply scripts already recorded in migration history.

For a new cafe, sign up or create an Auth user, verify the email, sign in, and complete the short cafe setup. Enter starting bank/safe balances; count your cash drawer when opening the first day. Owners invite teammates from **Team & access**. No sample transactions are uploaded to a connected cafe.

See [deployment and reminder setup](docs/deployment.md) for the exact remaining service settings, migration automation, and optional daily emails.

## Checks

```sh
npm run build
npm test
npm run test:e2e
npm run smoke:deployment -- https://band-b-cash-desk.vercel.app
```

Build before browser tests. They use system Chromium when present, or `PLAYWRIGHT_CHROMIUM_PATH`. Otherwise install Playwright Chromium once. Tests cover the cafe cash routine, transfers, cash counts, cheque clearance, reports, permissions, first-owner setup, password recovery, connection failures, and duplicate-safe retries. Connected browser tests use an isolated mock; SQL tests execute the real migrations in embedded PostgreSQL.

GitHub runs checks on pushes and PRs. A deployment-health workflow checks Vercel assets, direct page routes, PWA files, and whether the deployment is connected rather than in demo mode. `/health.json` reports the build revision and required database version; it contains no keys and does not claim that the database is reachable.

PDFs embed the official Poppins Regular and SemiBold fonts under the [SIL Open Font License](public/licenses/Poppins-OFL.txt). PDF checks parse the generated documents to verify financial totals, pagination, complete records and printable bounds.
