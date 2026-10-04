# TASK-023 Departure Group Brochure & Storage Vault

> **Superseded by [TASK-024](TASK-024-document-vault-redesign.md).** This
> task's "Storage Vault" (generalizing the Content & Templates page/
> `content_items` table in place) was replaced by a fuller redesign: a
> single Document Vault dialog backed by a new `vault_documents` table,
> with the Content & Templates page removed entirely. The brochure
> *generation* feature this task built (PDF from a departure group's live
> pricing/itinerary) survives unchanged in spirit — only where it saves
> to, and what the vault UI looks like, changed. Left below as a historical
> record of the decisions that led to TASK-024; do not build against this
> doc's schema/UI description, it no longer matches the code.

## What

1. A "Create Brochure" action on a departure group's detail page that
   generates a real PDF brochure from that group's live snapshot
   (itinerary, pricing, hotel standards, inclusions/exclusions, policy
   terms) and saves it into the existing Content & Templates table,
   generalized into a "Storage Vault" organized by category (Brochures
   being one category among the existing content types).
2. Inbox composer's "Attach brochure" control is extended so selecting a
   generated PDF brochure sends it to the customer as a real WhatsApp
   document attachment (not a pasted text link, which remains the
   behavior for plain URL-based brochure entries).

## Why

Staff currently have no way to generate a shareable, accurate brochure
for a specific departure group — pricing and itinerary details have to be
copied by hand into a chat message. The Inbox's existing "Attach
brochure" dropdown only supports pasting a manually-entered marketing
link; there is no generated, per-group document, and no real file-send
path wired to it.

## Design decisions (confirmed with requester)

- **Brochure format: a real generated PDF**, not an HTML/text document or
  a plain link entry. This is new infrastructure (no PDF library exists
  in this repo today) — see "New dependency" below.
- **Storage Vault = the existing `content_items` table, generalized**,
  not a new parallel table. "Category" in the vault UI is `content_type`
  (existing enum), with a new `BROCHURE_PDF` value added alongside the
  existing `BROCHURE_LINK`. No new `category` column.
- **Button placement**: inside the departure group detail page's
  existing "More group actions" dropdown
  (`app/(main)/departure-groups/[groupId]/components/departure-group-detail.tsx`),
  next to "Compare with Package Template" / "Edit Group Details" — not a
  new standalone header button.
- **Send mechanism: a real WhatsApp document attachment**, reusing the
  existing staff-attachment send pipeline (F1:
  `enqueue_inbox_media_message` → outbox drain →
  `lib/whatsapp/client.ts` `sendMedia()`, which sends a signed,
  short-lived Supabase Storage link as a WhatsApp `document` message).
  This repo has **no** WhatsApp Media-API pre-upload step anywhere
  (confirmed by reading `lib/whatsapp/client.ts`,
  `lib/inbox/outbox/drain.ts`) — attachments are always sent as a
  600-second signed link, not an uploaded WhatsApp media id. We reuse
  that mechanism unmodified; we do not build a second one.

### Defaults chosen (flag for review, easy to flip)

- Generated brochures are inserted with `status = 'PUBLISHED'`
  immediately — no manual "publish" step — since they're built from
  live, already-approved group data at the moment of generation, unlike
  freeform marketing copy. If QA review before customers can see a
  brochure is wanted, change this to `DRAFT` and require the existing
  "Publish" action in Content & Templates.
- Brochure creation capability is restricted to **ADMIN / CEO /
  MARKETING** roles only, matching `content_items`' existing RLS write
  policy — even though departure-groups' own `editGroupDetails`
  capability may be broader. This avoids granting a role write access to
  `content_items` that its RLS policy doesn't actually allow (that
  mismatch would surface as a runtime insert failure, not a clean
  permission-denied UI state). If ops roles should be able to generate
  brochures too, `content_items`' RLS policy needs to change first — that
  is out of scope for this task and must be a deliberate follow-up.
- Selecting a generated PDF brochure in the composer **sends
  immediately** (with a confirm step), rather than inserting into the
  draft for later editing — because it's a real message send through the
  attachment pipeline, not text the user can edit inline. Plain
  `BROCHURE_LINK` entries keep the current "insert into draft" behavior
  unchanged.

## Data model changes

### Migration 1 — extend `content_items` for generated files

- `ALTER TYPE content_type_enum ADD VALUE 'BROCHURE_PDF'` (own migration
  file; the new value is only used in application `INSERT`s in later
  transactions, never in DDL within this same migration, so the
  same-transaction-usage restriction on `ADD VALUE` does not apply here).
- New columns on `content_items`: `storage_path text`, `file_name text`,
  `mime_type text`, `file_size_bytes integer`,
  `source_departure_group_id uuid references public.departure_groups(id) on delete set null`.
- `CHECK` constraint: when `content_type = 'BROCHURE_PDF'`,
  `storage_path`, `file_name`, and `mime_type` must be non-null.
- Index on `source_departure_group_id` (lookups from the departure group
  detail page: "brochures generated for this group").
- No RLS policy changes needed — existing agency-scoped read/write
  policies on `content_items` already cover the new column set.

### Migration 2 — new Storage bucket for vault files

- New private bucket `content-vault`, agency-scoped path convention
  `<agency_id>/brochures/<content_item_id>/<uuid>.pdf`.
- `storage.objects` RLS mirrors the existing `content_items` policy
  exactly: read = any authenticated staff in the same agency; write =
  `ADMIN, CEO, MARKETING` roles — following the pattern in
  `supabase/migrations/20260827090000_tenant_storage_isolation.sql`.
- Kept separate from `agency-assets` (used today for logos etc.) so
  brochure file volume/lifecycle doesn't mix with branding assets.

## Access control changes

- New access file `lib/access/content-vault-access.ts`:
  `capabilitiesFor(role)` exposing `manageVault` (existing
  create/revise/publish/delete-content-item behavior, unchanged) and
  `createDepartureBrochure` (new) — both true only for `ADMIN`, `CEO`,
  `MARKETING`, matching `content_items` RLS.
- Departure group detail page checks `can.createDepartureBrochure` (from
  the new access file, not `departure-groups-access.ts`) before showing
  the "Create Brochure" menu item — so the UI-visible capability and the
  underlying RLS-enforced capability never disagree.

## New dependency

- `@react-pdf/renderer` — chosen over Puppeteer/Playwright-based
  HTML-to-PDF because it runs in a plain Node/serverless Server Action
  without a headless browser, keeping deployment simple. No PDF
  generation exists in this repo today; this introduces the pattern.

## Data-access / library changes

- `lib/content/brochure-pdf.ts` (new): a React-PDF document component and
  `renderDepartureGroupBrochurePdf(detail)` that lays out cover (group
  name/code, dates, duration), live pricing (from
  `DepartureGroupPricingRow`, not the frozen snapshot, so the brochure
  reflects current price), day-by-day itinerary, accommodation
  standards, inclusions/exclusions, and policy/cancellation terms from
  the group's package snapshot, plus agency branding.
- `lib/content/vault-storage.ts` (new): `uploadVaultFile(...)` (upload
  generated bytes to `content-vault`), `resolveVaultFileSignedUrl(...)`
  (short-lived signed URL for admin preview/download in the vault UI),
  and `stageVaultFileForConversation(agencyId, conversationId, vaultItem)`
  — downloads the vault file's bytes and re-uploads them into the
  existing `inbox-attachments` bucket at the conversation's outbound
  path (`<agencyId>/outbound/<conversationId>/<uuid>.pdf`), producing the
  exact reference shape `verifyStagedAttachment` /
  `enqueue_inbox_media_message` already expect. This is the bridge
  between "a file that lives in the vault" and "a file that can be sent
  in this specific conversation" — the existing send pipeline is never
  modified.
- `lib/data/content-repository.ts`: extend with
  `createDepartureGroupBrochureContentItem(...)` (inserts the
  `content_items` row + its `content_item_versions` row, following the
  existing `createContentItem` pattern) and a category-aware
  `listVaultItems({agencyId, category})` for the vault UI.

## Server Actions

- `app/(main)/departure-groups/[groupId]/brochure-actions.ts` (new):
  `createDepartureGroupBrochureAction(departureGroupId)` —
  `requireUser()` → resolve role/agency → check
  `createDepartureBrochure` → load group detail (existing DAL) →
  `renderDepartureGroupBrochurePdf` → `uploadVaultFile` →
  `createDepartureGroupBrochureContentItem` → `revalidatePath` on the
  group detail page and the vault page.
- `app/inbox/vault-actions.ts` (new): `sendVaultBrochureAction({
  conversationId, contentItemId, caption? })` — `requireUser()` →
  resolve actor (same shape as `resolveConversionActor` in
  `conversion-actions.ts`) → verify the `content_items` row belongs to
  this agency, is `content_type = 'BROCHURE_PDF'`, and
  `status = 'PUBLISHED'` → `stageVaultFileForConversation` → reuse the
  same internal send logic `sendStaffMessage` uses
  (`verifyStagedAttachment` + `enqueue_inbox_media_message`) rather than
  duplicating it — extract that shared step if it isn't already a
  standalone function.

## UI surfaces

- `app/(main)/departure-groups/[groupId]/components/departure-group-detail.tsx`:
  new "Create Brochure (PDF)" item in the "More group actions" dropdown,
  gated by `can.createDepartureBrochure`; confirm dialog before
  generating; success toast linking to the vault entry.
- `app/(main)/content-templates/components/content-templates-view.tsx`:
  relabel/extend as the "Storage Vault" — category filter over
  `content_type` (Brochures = `BROCHURE_LINK` + `BROCHURE_PDF`), render
  PDF items with a file icon, a signed-URL "Download" action, and
  "Generated for: <departure group name>" linking back to the group when
  `source_departure_group_id` is set.
- `app/inbox/components/message-composer.tsx`: "Attach brochure" dropdown
  lists both kinds; selecting a `BROCHURE_LINK` item keeps today's
  "insert into draft" behavior; selecting a `BROCHURE_PDF` item shows a
  brief "Send this brochure?" confirm and calls
  `sendVaultBrochureAction` directly (a real send, not a draft edit).
- `app/inbox/types.ts` / `lib/data/inbox-repository.ts`: extend
  `InboxBrochureLink` with `kind: 'LINK' | 'PDF'`, `contentItemId`,
  `fileName`; extend the brochures query to
  `content_type in ('BROCHURE_LINK','BROCHURE_PDF')` and select the new
  columns.

## Test plan

- Vitest: PDF generation from a fixed departure-group fixture produces
  the expected `content_items` + `content_item_versions` rows (storage
  calls mocked).
- Access: a role without `createDepartureBrochure` is rejected by the
  Server Action, not just hidden in the UI.
- Cross-agency: a `content_items` row from another agency cannot be
  loaded or sent via `sendVaultBrochureAction`.
- `stageVaultFileForConversation` produces a path that passes
  `isStagedPathFor` for the target conversation.
- `sendVaultBrochureAction` end-to-end with a mocked Supabase client:
  confirms `enqueue_inbox_media_message` is called with the staged
  path/filename/mimeType.
- Manual verification in the browser (no automated UI test convention in
  this repo beyond Vitest unit/integration tests): generate a brochure
  for a real seeded departure group, confirm it appears in the vault as
  Published, open the Inbox, select it from "Attach brochure," confirm
  the send-confirmation prompt, and confirm the WhatsApp message actually
  arrives as a document attachment in a real/sandbox conversation.

## Progress

- [x] Migration: `content_items` gets `BROCHURE_PDF` + file columns +
      `source_departure_group_id`, plus the new `content-vault` bucket and
      its RLS policies
      (`supabase/migrations/20261210090000_departure_group_brochures_vault.sql`).
- [x] `lib/types/content.ts` extended with the new type/columns.
- [x] `lib/validations/content.ts` (new file — this domain had none before):
      `contentTypeSchema`, `categoryForContentType` (the vault's
      category-grouping logic), `createDepartureGroupBrochureInputSchema`,
      `sendVaultBrochureInputSchema`. Tested in
      `lib/validations/content.test.ts`.
- [x] `lib/access/content-vault-access.ts` (new file, tested in
      `lib/access/content-vault-access.test.ts`). **Deviation from the
      original plan's assumption**: confirmed during implementation that
      `content-templates/actions.ts`'s existing `requireCanManage()` reuses
      Leads' `manageSourcesAndAutomation`, which is **ADMIN-only** — narrower
      than `content_items`' own RLS write policy (ADMIN, CEO, MARKETING).
      That's a pre-existing gap in this repo (not introduced here, not fixed
      here — out of scope), but it means this task's new capability gate
      could not reuse that shortcut without also under-granting CEO/MARKETING
      relative to what RLS actually allows. `content-vault-access.ts` is a
      small dedicated file so the capability check matches the RLS policy
      exactly.
- [x] `npm run typecheck` caught a real gap from adding `BROCHURE_PDF`:
      `content-templates-view.tsx`'s `CONTENT_TYPE_LABELS` record was
      exhaustively typed over `ContentType` and failed to compile until a
      label was added — confirms the exhaustiveness check is doing its job.
- [x] `npm run test` (335 files / 3543 tests) and `npm run typecheck` pass.
- [x] `npm run lint` — passes (pre-existing 1 error/277 warnings elsewhere on
      this branch, unrelated to this task's files; confirmed by linting this
      task's changed files directly with zero problems).
- [x] PDF generation: `lib/content/brochure-view-model.ts` (pure mapping,
      tested — live-price-wins-over-snapshot, snapshot fallback, omit a
      priceless occupancy, itinerary sort, duration label pluralization),
      `lib/content/brochure-pdf.tsx` (React-PDF layout, `@react-pdf/renderer`
      dependency added), `lib/content/brochure-source.ts` (loads group +
      snapshot + pricing rows directly rather than the much heavier
      `getDepartureGroupDetail()`), `lib/content/vault-storage.ts` (upload
      to `content-vault`, signed-URL resolution, and
      `stageVaultFileForConversation` — the bridge into the existing
      staff-attachment send pipeline). `content-repository.ts` gained
      `createDepartureGroupBrochureContentItem`.
- [x] `npm run test` (3550 tests), `npm run typecheck`, `npm run lint`
      (this slice's files), and `npm run build` all pass.
- [x] Server Actions: `createDepartureGroupBrochureAction`
      (`app/(main)/departure-groups/[groupId]/brochure-actions.ts`) and
      `sendVaultBrochureAction` (`app/inbox/vault-actions.ts`, which calls
      the existing `sendStaffMessage` directly rather than duplicating any
      of its protection-gate/service-window/takeover logic). Both tested
      with mocked Supabase/data layers (26 tests total) covering: role
      without the right capability refused before touching storage/DB,
      no-agency account refused, malformed id refused at the boundary,
      source/staging-layer errors propagated unchanged, a
      not-found/wrong-type/still-draft content item refused, and the
      happy path calling through with the right arguments.
- [x] UI:
      - Departure group detail page: "Create Brochure (PDF)" item in the
        "More group actions" dropdown, gated by `canCreateBrochure`
        (`lib/access/content-vault-access.ts`), with a toast on
        success/failure.
      - Content & Templates: relabelled as the Storage Vault's home — a
        category filter (`categoryForContentType`), a "Download" action
        for `BROCHURE_PDF` rows (fresh signed URL resolved on click via
        the new `getVaultFileDownloadUrlAction`, never stored), and
        `BROCHURE_PDF` excluded from the manual "New content item"
        dialog's type choices (it is generated only, never hand-authored;
        the DB `CHECK` constraint would reject a hand-authored one
        missing file columns anyway — this just gives a clean UI error
        instead of a raw DB one).
      - Inbox composer: `InboxBrochureLink` gained `kind`/`contentItemId`;
        `inbox-repository.ts`'s brochures query now includes
        `BROCHURE_PDF` alongside `BROCHURE_LINK`. Selecting a PDF no
        longer inserts text — it shows a one-line confirm bar ("Send
        \"<title>\" as a document attachment?") and, on confirm, calls
        `sendVaultBrochureAction` directly. **Deviation from the plan**:
        the plan's confirm dialog described a full `Sheet`/`Dialog`; built
        instead as an inline confirm bar (existing `Button`s only, no new
        dependency) since a full dialog was disproportionate to a
        one-line decision — functionally equivalent (nothing sends
        without an explicit second click).
- [x] Migration applied to the live Supabase project
      (`klognjpwmqwlgeibvanf`, "Manasik OS") via the Supabase MCP tool,
      with the user's explicit go-ahead first (schema change to shared
      infrastructure). `get_advisors` (security) run after: no new
      findings tied to `content_items` or the `content-vault` bucket —
      every existing finding predates this change.
- [x] `npm run test` (3576 tests across 338 files), `npm run typecheck`,
      `npm run lint` (this task's files), and `npm run build` all pass
      after the full UI wiring pass.
- [ ] **Manual browser click-through — not done.** This needs a signed-in
      staff session (ADMIN/CEO/MARKETING to generate, any
      `sendMessage`-capable role to send) that the agent doesn't have
      credentials for. Needs a human to: open a departure group → "Create
      Brochure (PDF)" → confirm it lands in Content & Templates under the
      Brochures category as Published with a working Download link → open
      Inbox on a conversation whose reply window is open → "Attach
      brochure" → select the generated one → confirm → verify the
      WhatsApp message actually arrives as a document attachment (not a
      text link).
- [x] Security checklist pass (`docs/security/security-guidelines.md`
      §10): RLS on the new bucket ✓, every new action calls
      `requireUser()` ✓, every new query is agency-scoped ✓, no new
      security-definer function or view ✓, every new action validates at
      the boundary with Zod ✓ (`getVaultFileDownloadUrlAction` was
      missing this — found and fixed during this pass), no secret
      reachable from client code ✓, `get_advisors` shows no new findings
      ✓.

## Status

Code-complete: data model, validation, access control, PDF generation,
server actions, UI, and the pre-PR security checklist are all done;
migration is applied to the live project; typecheck/lint/test/build all
pass. The one remaining item is a human manual click-through in the
browser — the agent has no login credentials for a signed-in staff
session.
