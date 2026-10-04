# Lead follow-ups — operations

Plan: [`docs/modules/lead-retention-followups-implementation-plan.md`](../modules/lead-retention-followups-implementation-plan.md).

## What runs

`public.invoke_cron_route('/api/cron/lead-followups')` fires every 10 minutes (pg_cron job `lead-followups-sweep`).
For each agency it (1) notifies staff about customers waiting on a person and (2) nudges quiet customers when the
agency has switched that on. It needs `public.set_cron_http_config()` to have been run once per environment, like the
other cron jobs.

## Pause it

- **Customer follow-ups:** Manasik Copilot page → "Keep customers from slipping away" → turn the follow-up switch off.
  Nothing more is sent from the next sweep on. (Turning on **Test mode** instead records what would be sent, without sending.)
- **Staff alerts:** cannot be switched off separately (they only write bell notifications). To stop everything:
  `select cron.unschedule('lead-followups-sweep');` and re-run the migration's schedule block to bring it back.

## Rollout

1. Ship with follow-ups off and Test mode on (the defaults).
2. Turn follow-ups on with Test mode still on. Read `conversation_followups` for a few days:
   ```sql
   select created_at, channel, kind, sequence, status, skip_reason
   from conversation_followups
   where agency_id = '<agency id>'
   order by created_at desc limit 100;
   ```
   `DRY_RUN` rows show what would have been sent (`skip_reason` = `WOULD_SEND_TEXT` or `WOULD_SEND_TEMPLATE`).
3. Turn Test mode off for the test agency, using a Meta **tester** account (non-testers fail with Graph error 10 while the
   Meta app is in Development mode).

## Reading the ledger

| status | meaning |
|---|---|
| `CLAIMED` | The sweep took the step and is sending; a row stuck here means the run died mid-send (nothing is retried). |
| `SENT` | Sent (or, for alerts, notified). |
| `DRY_RUN` | Test mode: recorded, nothing sent. |
| `SKIPPED` | Not sent; `skip_reason` says why (`WINDOW_CLOSED`, `NO_TEMPLATE`, `CONSENT`, `CONVERSATION_CHANGED`). Ends the sequence for that customer message. |
| `FAILED` | The send failed; not retried, and the sequence stops for that customer message. |

A new customer message creates a new anchor and restarts the sequence.

## Testing without waiting

Delays are at least 1 hour. On a scratch tester conversation, backdate `last_inbound_at` and `last_outbound_at`
(outbound must stay later than inbound) and `service_window_expires_at`, and keep the latest customer message's
`created_at` consistent, then wait for the next 10-minute sweep. Alerts: put a conversation in `HUMAN_REQUESTED` with an
old unanswered customer message.

## Adding another cron path

`invoke_cron_route` has a hard-coded allow-list. A new route needs a migration that `create or replace`s the function
with the new path added and schedules it (copy the block at the end of
`supabase/migrations/20261201090000_lead_retention_followups.sql`).
