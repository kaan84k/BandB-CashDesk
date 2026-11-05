# Cafe cashbook architecture

```text
React / TypeScript
  ├─ local demo: validated commands + browser storage
  └─ connected cafe: Supabase Auth + authenticated RPC
       ├─ cashdesk_health / workspace_state / create_workspace
       ├─ cashdesk_snapshot (RLS-filtered reads)
       └─ cashdesk_mutate (request receipt + atomic command + audit)
            ├─ cash_days: opening/expected/closing cash counts
            ├─ bank_transfers: money moved between cash, bank and safe
            ├─ transactions: actual movements and explicit count differences
            └─ cheques: commitments, with one movement at clearance

Supabase Cron → protected reminder function → Resend
Vercel Static Assets → application + health.json + versioned service worker
```

The UI has Today, Cashbook, Bank & safe, Cheques, Reminders, Reports, and Settings. There are no bakery production, supplier-credit, inventory, or multi-branch screens. Legacy database entities remain to preserve prior records and foreign keys.

Frontend amounts are integer minor units; PostgreSQL uses `NUMERIC(15,2)`. Account balances always come from their opening balance plus actual movements. A transfer records one expense leg and one income leg but is excluded from operating income/expenses. Daily reports distinguish opening cash, receipts, payments, bank/safe transfers, expected closing, actual closing, and variance.

Opening the first cash day can establish an unused, zero-balance drawer's starting cash without inventing a sale. Later count differences require a note and create a separately tagged adjustment. Closed days reject later cash entries. Only one cash day may be open per drawer. Accounts are locked in a consistent order for cash-day and transfer operations.

The request receipt is committed with the command. Retries with the same key and payload return success without another write; reusing a key with different details is rejected. A confirmed write followed by a failed refresh is reported as saved, with stale balances marked read-only until reconnecting. Auth changes clear old snapshots, and late responses cannot repopulate a signed-out session.

Build configuration explicitly allowlists public Supabase settings and rejects secret/service-role keys. Vercel requires a real connection unless demo mode is explicitly requested. `health.json` contains build metadata, not credentials or a database-readiness claim.

The PWA caches only same-origin shell/static resources. Each build has its own cache; updates prompt for a reload after the current entry is finished. Supabase responses are never cached and connected financial writes are not queued offline.
