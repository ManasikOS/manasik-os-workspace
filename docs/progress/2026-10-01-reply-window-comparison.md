# Reply-window reminder: old path vs sweep (task T10) — 2026-10-01

Both reminder paths have been live together since **2026-10-01 11:14 UTC** (the `reply-window-sweep` job, T9) alongside the original Inngest
`reply-window-reminder` function. This note records the starting point, why the two cannot double-notify, and the query to run for the
comparison. Read-only queries on Manasik OS; no customer content is recorded here (chat ids are shortened).

## Why an overlap cannot send two notifications

Both paths finish by calling the same `checkAndRemind`, which claims the follow-up ledger row `(conversation, WINDOW_REMINDER, sequence 1,
anchor message)` before notifying. That row has a database unique key (`conversation_followups`, `unique (conversation_id, kind, sequence,
anchor_message_id)`), and there is no column saying which path wrote it. Whichever path claims first notifies; the other sees the row,
reports "already sent", and does nothing. This was tested for the sweep (16 tests in `lib/inbox/window-sweep.test.ts`) and for five
simultaneous claims (`lib/inbox/cron-dedupe-guarantees.test.ts`). So the overlap costs nothing and a duplicate is not possible.

## Baseline (before the sweep had a chance to act)

| Measure | Value |
|---|---|
| Reminders sent by the old path (ledger, `WINDOW_REMINDER`) | 3, all `SENT` |
| In-app notifications of kind `REPLY_WINDOW_CLOSING` | 3 (one per reminder) |
| Outbox events `inbox/conversation.window_opened` | 5 (2026-09-25 to 2026-10-01) |
| Person-owned chats | 5 of 5 conversations |
| Person-owned chats with a window still open | 1 (closes 2026-10-02 05:46 UTC, already answered, so nothing is due) |
| Sweep runs so far | 11:15 UTC: HTTP 200, 3 agencies, 0 examined |

The three old-path reminders were each written exactly two hours before their window closed (08:28:03 for a window closing 10:28:03; 02:24:03
for one closing 04:24:03), and each is for a chat whose last customer message had no later reply, which is the sweep's rule too. Replaying
the sweep's rule on those two finished windows gives the same answer (remind); the only difference is timing: the sweep runs every five
minutes, so its reminder would land up to five minutes after the two-hour mark rather than on it.

Limit of that replay: it uses each chat's current columns, not their state at the time.

## Comparison query (run when a real chat approaches its window)

```sql
-- Chats that the sweep's rule says should be reminded right now, against what the ledger recorded.
select left(c.id::text, 8) as chat,
       c.service_window_expires_at,
       round(extract(epoch from (c.service_window_expires_at - now())) / 60) as minutes_to_close,
       (c.last_outbound_at is null or c.last_outbound_at < c.last_inbound_at) as unanswered,
       (select count(*) from public.conversation_followups f
         where f.conversation_id = c.id and f.kind = 'WINDOW_REMINDER' and f.created_at >= c.last_inbound_at) as reminders_after_last_customer_message,
       (select count(*) from public.staff_notifications n
         where n.conversation_id = c.id and n.kind = 'REPLY_WINDOW_CLOSING' and n.created_at >= c.last_inbound_at) as notifications_after_last_customer_message
  from public.conversations c
 where c.state in ('HUMAN_REQUESTED', 'HUMAN_ACTIVE')
   and c.service_window_expires_at > now() - interval '1 day'
 order by c.service_window_expires_at;
```

**Pass** for a chat: if it was unanswered when its window entered the last two hours, `reminders_after_last_customer_message` is exactly 1 and
`notifications_after_last_customer_message` equals the number of recipients (one for an owned chat). It is never greater than that.

## Exit rule for T10

T10 is done when **either**: (a) at least one real chat has gone through its last two hours with the sweep running and passes the check
above, **or** (b) seven days have passed with no failure in `cron_job_health()` for `reply-window-sweep` and you accept that traffic was
too low to exercise it. Without live traffic, a throwaway chat can prove the path end to end; that writes to the live database and needs
your explicit go-ahead.

Nothing else consumes the old path's events except the Inngest `reply-window-reminder` function, which T13 to T15 remove together with the
three window triggers and `inngest_outbox`.
