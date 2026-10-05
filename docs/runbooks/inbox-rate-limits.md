# Inbox rate limits

SEC-6 of [`docs/progress/2026-10-05-inbox-security-and-bug-audit.md`](../progress/2026-10-05-inbox-security-and-bug-audit.md). This is how the
limits work, how to change one agency's limits, and what to do when staff report they are blocked.

## What is limited

Every action below is counted against **two** counters at once, and it goes ahead only if **both** have room:

- the **person's hour** (one staff member, one hour, on the Sri Lanka clock: the hour resets on the local hour);
- the **agency's day** (all of an agency's staff together, one Sri Lanka day: it resets at local midnight).

| Action | What it is | Per person per hour | Per agency per day | If the counter cannot be read |
|---|---|---|---|---|
| `START_WHATSAPP_CHAT` | Starting a WhatsApp chat with a template | 15 | 60 | refused |
| `START_EMAIL_CONVERSATION` | Starting an email conversation | 20 | 100 | refused |
| `SEND_TEMPLATE` | Sending an approved template into an existing chat | 60 | 400 | refused |
| `SUGGEST_REPLY` | Copilot reply suggestion (a model call) | 40 | 600 | allowed, logged |
| `TRANSLATE` | Translating a message (a model call) | 60 | 600 | allowed, logged |
| `PREPARE_OFFER` | Preparing an offer message (no model call) | 120 | 1000 | allowed, logged |

These are the **defaults**, in `lib/inbox/rate-limit/policy.ts`. They are sized for agencies that start fewer than 30 brand-new chats a day but
send many more messages inside existing chats. Changing a default is a code change; changing it for **one agency** is a row in the database (below).

Two things are deliberately **not** counted: a repeat of a send that already went out (the same attempt key never uses a second slot), and a send
that Meta refused (the use is given back).

Starting a WhatsApp chat also refuses a number that belongs to a lead who has **opted out** or is marked **do not contact**. A number nobody has any
record of is allowed.

## Changing the limits for one agency

Overrides live in `public.inbox_rate_limit_overrides`. Only the platform can write to it (it is server-only: the agency's own admins cannot, so an
agency cannot raise its own ceiling). Use the Supabase SQL editor, or `execute_sql`, on the right project.

- `per_user_hourly` and `per_agency_daily` are independent. **`null` keeps the default.** `0` **switches the action off** for that scope.
- One row per agency and action. Setting it again replaces the row.
- Changes apply on the next click. There is no cache.

Raise one agency's daily new-chat cap to 150 and leave everything else as it is:

```sql
insert into public.inbox_rate_limit_overrides (agency_id, action, per_agency_daily, note)
values ('<agency uuid>', 'START_WHATSAPP_CHAT', 150, 'Umrah season, approved by <name> on <date>')
on conflict (agency_id, action) do update
  set per_agency_daily = excluded.per_agency_daily, note = excluded.note, updated_at = now();
```

Switch Copilot suggestions off for one agency:

```sql
insert into public.inbox_rate_limit_overrides (agency_id, action, per_user_hourly, per_agency_daily, note)
values ('<agency uuid>', 'SUGGEST_REPLY', 0, 0, 'Paused while the AI budget is reviewed')
on conflict (agency_id, action) do update
  set per_user_hourly = excluded.per_user_hourly, per_agency_daily = excluded.per_agency_daily, note = excluded.note, updated_at = now();
```

Go back to the defaults:

```sql
delete from public.inbox_rate_limit_overrides where agency_id = '<agency uuid>' and action = 'START_WHATSAPP_CHAT';
```

See every override that is in force:

```sql
select a.name, o.action, o.per_user_hourly, o.per_agency_daily, o.note, o.updated_at
from public.inbox_rate_limit_overrides o join public.agencies a on a.id = o.agency_id
order by a.name, o.action;
```

**Before raising a new-chat limit, check the agency's Meta messaging limit** (WhatsApp Manager → the phone number → messaging limits). A limit
here above what Meta allows only moves the refusal from our message to Meta's, and a number that hits Meta's limit repeatedly can lose quality
rating. Keep ours below it.

## When someone says they are blocked

The message names the limit and says when they can go on. To see how much has been used right now:

```sql
select scope, action, window_start, used
from public.inbox_rate_limit_counters
where agency_id = '<agency uuid>'
  and window_start > now() - interval '1 day'
order by window_start desc, scope, action;
```

`scope = 'USER'` rows are one staff member's hour (`subject_id` is their user id); `scope = 'AGENCY'` rows are the agency's day.

To give one agency room **today** without changing its limits, lower the counter (for example after a mistaken bulk attempt):

```sql
update public.inbox_rate_limit_counters set used = 0
where agency_id = '<agency uuid>' and scope = 'AGENCY' and action = 'START_WHATSAPP_CHAT'
  and window_start = (date_trunc('day', now() at time zone 'Asia/Colombo') at time zone 'Asia/Colombo');
```

Counter rows older than three days are removed by the nightly Inbox housekeeping (`/api/cron/inbox-retention`).

## If the counter itself fails

Starting a chat, starting an email and sending a template are **refused** with "Could not check the usage limit just now, so nothing was done" and
the failure is logged. Copilot suggestions, translations and offer messages are **allowed** and the failure is logged. A burst of
`Could not check the ... limit` errors in the logs means `consume_inbox_rate_limit` is failing: check that migration
`20270114090000_inbox_rate_limits.sql` is applied on that project.

## Rollback

The code can be reverted on its own. To remove the database side as well: drop the functions `consume_inbox_rate_limit` and
`refund_inbox_rate_limit`, then the tables `inbox_rate_limit_counters` and `inbox_rate_limit_overrides`.
