# Hosted setup

The local demo runs without credentials. These steps connect actual shared storage and email. They have not been applied to a hosted project by this task.

## Supabase database and owner

1. Create a Supabase project and keep its database/admin credentials in secure configuration.
2. Apply `supabase/migrations/202611050001_cashdesk.sql` and then `202611050002_reminders.sql` through the SQL editor, or link the Supabase CLI and run `supabase db push`.
3. Create the owner's user in Supabase Authentication. Use the user's actual UUID below. Provision the business with an administrator database connection, not the public browser key:

```sql
begin;
insert into public.companies (id,name)
values ('20000000-0000-4000-8000-000000000001','Books & Buns');
insert into public.members (id,company_id,name,email,role)
values ('REPLACE_WITH_AUTH_USER_UUID','20000000-0000-4000-8000-000000000001',
        'Workspace Owner','REPLACE_WITH_OWNER_EMAIL','owner');
insert into public.branches (id,company_id,name,location)
values ('20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',
        'Colombo cafe','Colombo');
commit;
```

The example fails until the placeholder UUID/email are replaced. No real credentials or business records are included. The owner has access to all company branches. Create accounts and suppliers in CashDesk after signing in.

4. For another teammate, create their Supabase Auth user, insert their `members` row in the same company with `manager` or `staff`, and add their permitted branches:

```sql
insert into public.user_branch_access (company_id,user_id,branch_id)
values ('20000000-0000-4000-8000-000000000001','REPLACE_WITH_AUTH_USER_UUID',
        '20000000-0000-4000-8000-000000000002');
```

An owner demoted to manager/staff retains explicit access to branches they previously owned; adjust grants administratively if narrower access is desired. To revoke access entirely, remove their branch grants and membership and revoke their Auth sessions. Never put owner role assignments in user-editable Auth metadata.

5. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in your hosting build settings. For local development use an ignored `.env`, starting from `.env.example`. Do not add secrets to Git.
6. Configure Auth site/redirect URLs for your HTTPS deployment and your password policy. This app uses password sign-in, with no public sign-up route. Invite/password reset delivery is administered through Supabase Auth.

## Database access model

All public financial tables enable RLS. Authenticated clients have read privileges only; RLS filters by company and branch. All application writes go through `cashdesk_mutate`, which checks `auth.uid()`, membership, role, branch, foreign keys, status transitions, and amount precision before writing audit events in the same transaction. The snapshot function is security-invoker and retains RLS. All definer functions have an empty search path and explicit execution grants.

Cheque settlement locks its row, rejects terminal states, and inserts a uniquely linked movement. Direct table writes and audit editing are not granted to app users. The service-role key bypasses RLS and must remain exclusively server-side. Database administrators can still change data; restrict that access operationally.

## Resend and daily Cron

1. Verify a sender domain in Resend. Put `RESEND_API_KEY` and a strong random `REMINDER_CRON_SECRET` in Supabase Edge Function secrets. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the function. None belongs in frontend build settings.
2. Deploy the function, e.g. `supabase functions deploy cheque-reminders`. `supabase/config.toml` disables JWT verification for this function because it uses a dedicated constant-time-checked `x-cron-secret` instead. Requests without the correct secret are rejected.
3. Configure recipients with an administrator connection:

```sql
insert into public.reminder_settings (company_id,enabled,recipients,sender)
values ('20000000-0000-4000-8000-000000000001',true,
        array['REPLACE_WITH_RECIPIENT_EMAIL'],
        'Books & Buns <REPLACE_WITH_VERIFIED_SENDER_EMAIL>')
on conflict (company_id) do update
set enabled=excluded.enabled,recipients=excluded.recipients,sender=excluded.sender;
```

4. Enable Supabase Cron (`pg_cron`), `pg_net`, and Vault. Save the function URL and Cron secret in Vault via the secure dashboard as `cashdesk_reminder_url` and `cashdesk_reminder_cron_secret`. The URL is `https://YOUR_PROJECT.supabase.co/functions/v1/cheque-reminders`. The secret must match the function's secure variable. Schedule at **02:30 UTC = 08:00 Asia/Colombo**:

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

5. Invoke the function once using a securely supplied secret and confirm the Cron response, Resend receipt, and a `sent` delivery row. Never paste secrets into source, chat, or committed shell history. The local task does not send any email.

The scheduler claims up to 50 deliveries per invocation and is tuned to a small business. Schedule additional invocations if this is insufficient. It sends at 7/3/1 days, on the due date, and daily for unresolved overdue/returned cheques. Issued and received cheques are both covered. The two retry jobs run at 08:20 and 08:40 Sri Lanka time; already sent messages are skipped. Failed or stale claims are eligible after 15 minutes, at most three attempts per date/stage. Resend requests retain the same idempotency key on retry. The daily date key and 15-minute retry window keep retries within Resend's 24-hour idempotency retention. Requests are paced below two per second and the worker stops sending after its 100-second budget so remaining claims can be retried.

Check Cron HTTP outcomes and `notification_deliveries` for failures/stale `sending` rows. The owner can inspect recent delivery outcomes in CashDesk's reminder centre. A provider delivery ID confirms API acceptance, not inbox delivery; monitor Resend for later bounces. In-app cheque warnings remain active independently of email. Reminder processing never changes cheque status or bank balances.

## Vercel hosting

The frontend can run on Vercel with Supabase providing Auth, PostgreSQL, and Edge Functions. The included `vercel.json` configures Vite, frozen dependency installation (`npm ci`), the production build (`npm run build`), `dist` output, SPA rewrites, and response headers. Cloudflare's `_headers` file alone does not configure Vercel; the matching headers are declared in `vercel.json`.

1. Import the repository into Vercel, with the application directory as the root directory.
2. In Vercel Project Settings → Environment Variables, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for Production and any Preview environment that should access a database. Use a separate development project for previews when appropriate. These are public client settings; never use a Supabase service-role key here.
3. Redeploy after setting or changing either value. Vite embeds them at build time; changing a dashboard value does not update an existing bundle. If the site still says “Demo workspace”, the deployed bundle does not have both public settings.
4. In Supabase Authentication → URL Configuration, set the Site URL to the actual HTTPS production app URL. Add only the explicit redirect URLs needed for your production and preview workflows. Redirect settings do not grant database membership: create the Auth user, `members` row, and branch grants as described above.
5. Verify the root and direct requests to `/cheques`, `/transactions`, and `/reports`; refresh each page. Check that the served application script and `/sw.js` are JavaScript, rather than an HTML fallback. The manifest and PNG app icons must also be served correctly.
6. Sign in with a provisioned user, verify the intended branch access, and confirm a recorded movement survives signing out and back in. Test financial writes in a designated test workspace rather than adding sample movements to live books.

The Supabase migrations, Auth membership, reminder function, secure email settings, and Cron jobs remain separate from the Vercel frontend deployment. Existing database migrations should not be reapplied manually; use the Supabase CLI migration history or check which scripts have already run.

## Alternative Cloudflare hosting

Build with the public Supabase variables present and deploy `dist/` using the supplied Cloudflare Workers assets configuration. Run browser checks against the actual HTTPS host before using real records. No Cloudflare account or deployment is created by the development setup.

## Backups

Make scheduled full database backups through a secure administrator process (e.g. encrypted `pg_dump` exports and retention), monitor success, and regularly restore into an isolated project. CashDesk's JSON download includes only the signed-in user's visible records; it is not a substitute for a full database backup including Auth, grants, and delivery history. Browser restore intentionally operates only in demo mode. Production restores require an administrator and a rehearsed procedure.

The browser needs the frontend deployment host and the configured Supabase project. Edge Functions require `api.resend.com`. CLI deployment additionally needs the corresponding Supabase and Vercel or Cloudflare API access; request only specific destinations from your environment administrator when access is restricted.
