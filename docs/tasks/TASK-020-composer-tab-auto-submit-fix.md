# TASK-020 Composer tab buttons were secretly submitting the form

## What
`TabsTrigger` — the shared "Reply"/"Internal note" tab primitive in
[`components/animate-ui/primitives/animate/tabs.tsx`](../../components/animate-ui/primitives/animate/tabs.tsx),
used across ~30 pages — now defaults to `type="button"` instead of no
`type` at all. The message composer's own "Reply"/"Internal note"
triggers, and its three `DropdownMenu` toolbar buttons ("Mention staff",
"Saved replies", "Attach brochure"), also now set `type="button"`
explicitly for defense in depth.

## Why
Reported directly by the user, and reproduced live: switching from
Internal note back to Reply after mentioning a staff member sent the
note's leftover text as a real customer-facing WhatsApp message.

Root cause: `TabsTrigger` renders a plain `motion.button` with no `type`
attribute. A `<button>` with no `type` defaults to `type="submit"` the
moment it sits inside a `<form>` — and the composer's whole toolbar
(`app/inbox/components/message-composer.tsx`) is one `<form
onSubmit={handleSubmit}>`. Clicking "Reply" or "Internal note" to switch
modes was therefore a genuine, un-prevented form submission: React's
`onValueChange`/`setMode` state update from the click lands before the
browser's native submit fires, so by the time `handleSubmit` runs, `mode`
already reads the *new* tab — meaning whatever was sitting in the shared
`value` state (the note draft, complete with a fresh `@name ` mention)
gets sent through `sendStaffMessage` as if it were a deliberate reply.

This same bug plausibly explains the "attachment thing not sending"
report too: `handleSubmit`'s send path calls `attachment.clear()`
unconditionally once it fires. If a stray tab click landed after a
staged file reached `"ready"`, that accidental submission would silently
send (and clear) the attachment on its own — so the message the person
went on to actually finish and send no longer had a file attached,
because it had already gone out, unnoticed, moments earlier.

Confirmed via the live browser (see verification below) that the fix
closes the exact reported repro: mention a staff member in Internal
note, switch to Reply — the mention text now stays in the box, editable,
and nothing is sent.

## What was checked and found to be fine (not part of this fix)
- `automatedInboxSendGate`/`canSubmitComposer` already correctly block a
  real Send while an attachment is still uploading — this bug bypassed
  that by triggering an entirely separate, unintended submission path
  the disabled-Send-button guard never covers, not a hole in that guard
  itself.
- Every other button in the composer form (`More actions`, `Draft with
  Copilot`, the attach-file button, `Send`) already had the correct
  `type` — verified attribute-by-attribute in the live DOM before and
  after this change.
- The "Draft with Copilot" button showing *"Inbox autonomy is at L0
  Observe. Move to L1 Assist before asking Copilot to draft replies."*
  is **not a bug** — `suggestConversationReplyAction`
  (`app/inbox/actions.ts:1438`) deliberately refuses to draft below L1,
  by the same autonomy-ceiling design this session's TASK-015/017 work
  hardened. It's a real, working gate reflecting this agency's current
  Inbox-reply autonomy setting (L0), changeable only in Manasik Copilot
  settings by an admin. Left as-is.

## Data model changes
None.

## Access control changes
None.

## UI surfaces
`components/animate-ui/primitives/animate/tabs.tsx` (shared primitive,
~30 consumers app-wide — all get this protection automatically),
`app/inbox/components/message-composer.tsx`.

## Test plan
- Automated: none added. This repo's Vitest config
  (`vitest.config.mts`) is explicitly scoped to pure-logic tests with no
  jsdom/React-render environment, so a rendered-attribute assertion
  (`type="button"` on the DOM node) isn't expressible in the existing
  suite without introducing new test infrastructure; that's out of scope
  for this fix. Full existing suite (332 files / 3517 tests) passes
  unaffected, and `npm run build` succeeds.
- Manual: reproduced the exact reported bug against the fixed code and
  confirmed it's gone — attribute-checked every button in the composer
  form before and after (`type` now correct on all of them), then
  live-repro'd "mention staff in Internal note → switch to Reply": the
  `@name` text now stays in the box uninterrupted, no message is sent,
  and no console errors appear.

## Status
Done.
