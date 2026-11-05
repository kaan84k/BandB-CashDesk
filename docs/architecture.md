# Architecture

```text
React / TypeScript PWA
  ├─ Demo repository: localStorage + validated pure command reducer
  └─ Connected repository: Supabase Auth + authenticated RPC
       ├─ cashdesk_snapshot (security invoker, reads under RLS)
       └─ cashdesk_mutate (role/branch checks, atomic writes + audit)
            └─ PostgreSQL relational tables, NUMERIC(15,2)

Supabase Cron (02:30 UTC / 08:00 Asia/Colombo)
  └─ cheque-reminders Edge Function (dedicated Cron secret)
       ├─ claim_due_reminders (service role only)
       ├─ Resend API (idempotency key per cheque/date/stage)
       └─ finish_reminder (claim token guards stale completions)

Cloudflare Workers Static Assets → dist/ + SPA fallback
```

- `src/lib/domain.ts`: Zod schemas, money/date helpers, ledger math, transitions, forecast, backup validation, and pure demo commands.
- `src/lib/seed.ts`: fictional fixtures anchored to the current Sri Lankan date.
- `src/lib/store.tsx`: demo persistence or Supabase session/snapshot/RPC adapter. Connected data refreshes after mutations and every 30 seconds while visible.
- `src/components`: accessible Radix dialogs and shared entry/display components.
- `src/pages`: dashboard, ledger, cheques, suppliers, accounts, reminders, reports, team, and settings.
- `src/lib/exports.ts`: on-demand PDF/XLSX generators, keeping export libraries out of the startup path.
- `supabase/migrations`: relationships, constraints, RLS, roles, audited atomic writes, and reminder claims.
- `supabase/functions`: email worker; no credentials in frontend code.
- `tests`: pure financial invariants, embedded PostgreSQL/RLS tests, and desktop/mobile end-to-end tests.

All frontend amounts use integer minor units, and conversion to rupees occurs only at display/export boundaries. PostgreSQL stores decimal amounts. The RPC rejects fractional minor units. Bank balance is always opening balance plus actual movements; it is never incremented alongside a separate transaction insertion. Transaction/audit records are append-only for app users.

The demo repository intentionally offers no real security, multi-device syncing, or concurrent-tab transaction guarantees. It must not be used as the production ledger. The connected PostgreSQL repository enforces authorisation and row-locked clearance independently of client code.

Report dates are inclusive; weekly grouping starts Monday. The cheque outlook spans today plus 30 days and applies overdue commitments at day zero. Unresolved returned cheques are highlighted for action, but are excluded from outstanding bank commitments until re-presented. Supplier invoices and cheque obligations are distinct; paying a supplier changes its on-account balance only when an actual expense is recorded.

The shell service worker caches only same-origin static assets and the application document. It never intercepts cross-origin Supabase/Resend traffic. Update its cache version when changing shell caching behaviour. Connected mode does not save financial snapshots into local storage; only Supabase's normal Auth session is persisted by its SDK.
