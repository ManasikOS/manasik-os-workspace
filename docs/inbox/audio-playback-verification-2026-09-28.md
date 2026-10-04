# Inbox audio playback correction

The running Inbox response had `default-src 'self'` and no `media-src`.
Consequently, the browser blocked signed Supabase Storage audio even when the
same recording decoded on a page without the application's CSP. The earlier
isolated metadata check did not validate playback under the Inbox policy.

`next.config.ts` now permits media from the signed `inbox-attachments` Storage
path. Other external media origins remain blocked. Transcription remains removed.

Verification on 2026-09-28:

- The browser regression in `lib/security/inbox-media-csp.test.ts` failed before
  the change with native media error 4. After the change, playback advances and
  an unrelated media origin is still blocked.
- The running server returned the new `media-src` directive.
- A read-only Chromium check used that live response policy and freshly signed
  URLs for the five latest audio messages in the reported conversation.
- The message dated **Sep 28, 06:10** in the user's screenshot loaded a duration
  of **2.1265 seconds**; playback advanced to **0.213964 seconds**, with
  `paused=false` and no media error.
- All five recordings loaded nonzero durations without media errors.

The user's existing browser document must be reloaded to receive a changed CSP
response header; client-side Fast Refresh does not replace that document policy.
This verifies the live policy and recordings, not the user's authenticated tab,
which was not available to the browser tool.
