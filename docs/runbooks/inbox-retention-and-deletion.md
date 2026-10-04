# Inbox retention and deletion

The nightly `/api/cron/inbox-retention` route applies the same uniform policy to every plan tier. Use a dry run before the first live sweep and after any retention-setting change.

1. Confirm the agency settings remain inside database-enforced bounds: booking-linked messages 3–10 years, Inbox attachments no more than 365 days, raw webhook payloads no more than 90 days.
2. Run `runRetentionSweepForAgency(..., { dryRun: true })` with the service client and compare every scope count with direct tenant-scoped queries.
3. Confirm booking-linked conversations younger than the configured booking window are absent from the deletion set. Confirm promoted attachments have `promoted_document_id` and are absent from the attachment set.
4. Run the live sweep, then compare its `inbox_retention_sweeps` rows with the dry run. A partial batch is safe to retry; selection is timestamp-based and deletion is idempotent.
5. Check private storage for deleted attachment/audio objects. Any object-delete failure must be recorded and retried before the sweep is considered complete.

Meta deletion callbacks and manual privacy requests must identify the same conversation/customer scope before using this deletion path. Business records independently promoted into Leads, Bookings or Documents follow those modules' policies and are not silently removed with an Inbox message.
