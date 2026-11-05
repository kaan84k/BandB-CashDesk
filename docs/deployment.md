# Vercel + Supabase setup

GitHub deploys the code. Supabase must also have the database migrations, and Vercel must have the public connection settings. The local tests do not establish that these external settings have been applied.

## 1. Connect the frontend

In Vercel Project Settings → Environment Variables, configure the Production environment:

| Setting | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | Your Supabase HTTPS project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The public publishable key, or legacy anon key |

The public variable names supplied by the Supabase/Vercel integration are also accepted; see `.env.example`. Do not copy service-role keys, database passwords, Resend keys, or Cron secrets into frontend variables. Vercel runs Node 24, `npm ci`, and `npm run build`, serving `dist/` with the supplied SPA routing and headers.

Redeploy after changing environment variables: they are compiled into the build. A missing or invalid connection fails a Vercel build with a clear message. For an intentional demonstration only, set `VITE_CASHDESK_DEMO=true`. Local development without settings still opens a labelled demo.

## 2. Apply database migrations

Use the existing Supabase GitHub integration if it manages your production migrations. Migrations live in `supabase/migrations` and must run in filename order. The new cafe workflow requires all four, through `202611050004_cafe_cashbook.sql`.

If the original two migrations are already applied, apply only the pending migrations. If they were run manually, verify and repair their migration-history entries before using CLI automation. Do not rerun existing setup scripts or mark an unapplied migration as applied.

A **Deploy Supabase** GitHub Actions workflow is included as a fallback. It uses the verified Supabase CLI 3.0.0, runs tests first, applies pending remote migrations, and deploys the reminder function without Docker. Configure these repository secrets securely:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- `SUPABASE_PROJECT_REF` (the project reference from its URL)

Run the workflow manually from GitHub Actions. To use it automatically on `main`, set repository variable `SUPABASE_DEPLOY_WITH_ACTIONS=true`. Leave that off when the native Supabase integration already owns production migrations, so two systems do not compete. The workflow never adds demo transactions or seeds live financial records.

CLI 3 commands used by the workflow:

```sh
supabase link --project-ref "$SUPABASE_PROJECT_REF" --yes
supabase db push --remote --yes
supabase functions deploy cheque-reminders --remote="$SUPABASE_PROJECT_REF" --use-api --yes
```

The app's anonymous `cashdesk_health` probe discloses only `app` and `schemaVersion`. Version 4 is required. A missing/stale schema produces a setup message before login, rather than creating a local demo.

## 3. Set up the cafe owner

In Supabase Authentication → URL Configuration:

- Site URL: `https://band-b-cash-desk.vercel.app`
- Allow the same production URL for confirmation/password-reset redirects.
- Add only the separate preview/development URLs you intend to use.

Create the owner through the app's **New business? Get started** flow or the Supabase Auth dashboard. Email signups must be enabled for app signup; dashboard-created users can sign in without enabling public signup. Verify the email, sign in, and create the cafe. Enter starting bank/safe balances; opening the first cash day records the starting drawer cash.

This creates a new private company and its cash drawer, bank account, and personal safe. It never attaches a user to someone else's existing company. A new login intended to join an existing cafe must receive membership and access from its administrator. Creating another cafe does not grant access to the original.

Existing memberships and financial records remain intact. Legacy supplier/branch tables remain in the database for historical integrity, but the cafe UI does not expose production, supplier-credit, or multi-branch workflows.

## 4. Optional email reminders

In-app reminders work without an email provider. To send daily emails:

1. Verify a sender domain in Resend.
2. Put `RESEND_API_KEY` and a strong random `REMINDER_CRON_SECRET` in Supabase Edge Function secrets. Supabase supplies the service-role key server-side. None belongs in Vercel frontend settings.
3. Deploy `cheque-reminders`. Its configuration disables JWT verification because it requires a constant-time-checked `x-cron-secret`. Requests without the correct secret are rejected.
4. In CashDesk → Reminders → **Email preferences**, set recipients and the verified sender and enable daily reminders. This saves preferences; it does not send an email or install a scheduler.
5. Enable Supabase Cron (`pg_cron`), `pg_net`, and Vault. In the secure Vault UI, create `cashdesk_reminder_url` (your function URL) and `cashdesk_reminder_cron_secret` (matching the function secret).

Schedule the main run at **08:00 Asia/Colombo**, with retries at 08:20 and 08:40:

```sql
do $setup$
declare job_sql text := $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='cashdesk_reminder_url'),
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cashdesk_reminder_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$job$;
begin
  perform cron.schedule('cashdesk-cheque-reminders','30 2 * * *',job_sql);
  perform cron.schedule('cashdesk-cheque-reminders-retry-1','50 2 * * *',job_sql);
  perform cron.schedule('cashdesk-cheque-reminders-retry-2','10 3 * * *',job_sql);
end $setup$;
```

Reminders run at 7/3/1 days before due, on the due date, and daily for unresolved overdue/returned cheques. They claim at most 50 per invocation, pace provider requests, and retry stale/failed claims after 15 minutes, at most three attempts per day/stage. Retry requests retain the same provider idempotency key. Reminder processing never moves money or changes cheque status.

Check recent delivery results in Reminders and Cron HTTP outcomes in Supabase. A sent delivery means the provider accepted it; later bounces are monitored in Resend. Configure Supabase Auth's email delivery separately for account confirmations and password resets.

## 5. Verify the deployment

```sh
npm run smoke:deployment -- https://band-b-cash-desk.vercel.app
```

The **Deployment health** GitHub workflow runs after successful deployment-status events and can also be dispatched manually. `CASHDESK_APP_URL` can override the default production URL. It checks page routes, application scripts, the manifest/icons, matching service-worker build, and connected mode. A protected Vercel preview will fail with its HTTP status; use the accessible production URL or the deployment protection settings intended for that preview.

Then sign in and verify the public database health check, owner setup, opening cash, an income/expense, a bank/safe transfer, closing cash, and report download in a designated test cafe. Do not add sample movements to real books. These hosted checks require access to your actual deployment and project.

## Records and backups

Closed cash days are protected. Transfers have two matching movements in one database transaction; sales/expense reports exclude them. Cash count differences are separately recorded and explained. Retrying a confirmed request does not write it again. Financial records remain append-only to app users.

Export backups from Settings, keep them securely, and test restoration. The JSON export covers records visible to your account. Full PostgreSQL/Auth/grant/delivery backups and production restores remain administrator operations; browser restore is deliberately demo-only.
