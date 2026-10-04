# TASK-024 Document Vault Redesign

## What

Replaces the Content & Templates screen and its marketing-shaped
`content_items` table with a single **Document Vault dialog**: one place
to browse, upload, and download every stored file, organized into
category tabs (Passport, Visa, Flight Ticket, Brochure, Receipt, and any
other category typed on upload). A file is uploaded once and referenced
everywhere it's needed — most concretely, the Inbox composer's attachment
control now offers "Choose from vault" alongside "Choose from device," and
picking a vault file never re-uploads it from the browser.

Supersedes TASK-023, whose "Storage Vault" was the Content & Templates
page generalized in place. This is a fuller redesign per follow-up
direction: no page, no marketing-content-type enum, no versioning — a
general document store instead.

## Why

Passports, visas, flight tickets, and receipts don't fit a marketing
content library, and staff needed a single place to store a file once and
reuse it — starting with sending the same document to multiple
conversations without re-uploading it from disk each time.

## Data model changes

- New table `vault_documents` (agency-scoped, free-text `category`,
  required `storage_path`/`file_name`/`mime_type`/`file_size_bytes`,
  optional `source_departure_group_id` for a generated brochure). RLS:
  read = any authenticated staff in the agency; write = ADMIN, CEO,
  OPERATIONS, VISA, FINANCE, MARKETING (broadened from the old
  ADMIN/CEO/MARKETING-only gate — these are the roles that actually
  handle these document types day to day).
- The `content-vault` storage bucket's `allowed_mime_types` broadened from
  PDF-only to every type the outbound WhatsApp send path already accepts
  (jpg, png, pdf, docx, xlsx, pptx) — a vault document is only worth
  storing if it can also be sent. New storage policies grant the broader
  role set write access **alongside** (not replacing) the prior
  ADMIN/CEO/MARKETING policies from TASK-023 — Postgres combines
  permissive policies with OR, so nothing needed dropping.
- **`content_items`/`content_item_versions` are left in place, unused —
  not dropped.** Writing the migration's DROP TABLE + DROP POLICY
  statements together got refused by this environment's own auto-mode
  classifier as a "Cloud Storage Mass Delete" pattern; the requester
  chose to leave the old tables as harmless dead weight rather than grant
  the permission to force it through. Dropping them later is a separate,
  explicit decision for whoever owns that call.
- The one real file worth keeping from the old shape — a brochure PDF
  already generated for a departure group — was copied into
  `vault_documents` as part of this migration
  (`supabase/migrations/20261211090000_vault_documents.sql`).

## Access control changes

- `lib/access/vault-access.ts` (replaces `content-vault-access.ts`):
  `capabilitiesForVault(role).manageVault` — true for ADMIN, CEO,
  OPERATIONS, VISA, FINANCE, MARKETING; false for GUIDE. Reading the vault
  (browse/download/attach-to-chat) has no capability gate — every
  signed-in role can pull up, say, a pilgrim's passport scan regardless of
  who uploaded it; RLS alone scopes reads to the agency.
- Sending an already-uploaded vault file through the Inbox composer needs
  only the existing `sendMessage` capability, same as any other reply —
  `manageVault` gates uploading/generating/deleting, not sending.

## UI surfaces

- **Removed entirely**: `app/(main)/content-templates/**` (page, detail
  page, actions, view components).
- **New**: `components/vault/vault-dialog.tsx` — one dialog, two modes:
  - `mode="manage"`: opened from the sidebar's "Document Vault" item
    (replaces the old "Content & Templates" link — same slot, now opens a
    dialog instead of navigating). Category tabs, a mini "Upload" button
    per tab (visible only to `manageVault` roles), Download and Delete per
    document.
  - `mode="picker"`: opened from the Inbox composer's attachment dropdown.
    Same tabs/browsing; clicking a document selects it and closes the
    dialog instead of offering delete.
- **Inbox composer** (`app/inbox/components/message-composer.tsx`,
  `composer-attachment.tsx`): the old "Attach brochure" dropdown (a
  separate control, text-insert-only) is gone. The paperclip is now a
  dropdown: "Choose from device" (the prior single-click behavior) and
  "Choose from vault" (opens the picker dialog). Either path lands in the
  exact same attachment "ready" state and goes out through the exact same
  `sendStaffMessage` call — a vault pick and a device upload are
  indistinguishable to the send path.
- `app/(main)/departure-groups/[groupId]/components/departure-group-detail.tsx`:
  "Create Brochure (PDF)" now saves into `vault_documents` under the
  "Brochure" category via `capabilitiesForVault(role).manageVault`,
  instead of the old content-vault-access gate.

## Server actions

- `app/vault/actions.ts` (new): `listVaultDocumentsAction`,
  `requestVaultUploadUrlAction` (signed upload URL, browser → bucket
  directly), `confirmVaultUploadAction` (re-verifies the uploaded bytes
  before inserting a row — never trusts the browser's claim),
  `deleteVaultDocumentAction`, `getVaultDocumentDownloadUrlAction` (a
  fresh signed URL, never stored).
- `app/inbox/vault-actions.ts`: `sendVaultBrochureAction` (which sent
  immediately on selection) is replaced by
  `stageVaultDocumentForComposerAction`, which only copies the vault
  file's bytes into the conversation's outbound path and returns a
  `StagedAttachmentRef` — the actual send goes through the composer's
  existing `sendStaffMessage` call, unchanged, so every protection
  gate/service-window check/takeover it already enforces applies for
  free.
- `app/(main)/departure-groups/[groupId]/brochure-actions.ts`: updated to
  insert into `vault_documents` (category "Brochure") via
  `lib/data/vault-repository.ts` instead of the retired
  `content-repository.ts`.

## Test plan

- `lib/validations/vault.test.ts`: `normalizeVaultCategoryLabel`'s real
  branching (snaps a suggested category regardless of casing/whitespace,
  title-cases a custom one) plus schema boundary tests.
- `lib/access/vault-access.test.ts`: the broadened role set matches
  `vault_documents`' RLS write policy exactly, role by role.
- `app/vault/actions.test.ts`: capability gates on every write action,
  read actions open to every role, upload-verification failure blocks the
  insert.
- `app/inbox/vault-actions.test.ts`: rewritten for
  `stageVaultDocumentForComposerAction` — capability check, cross-agency
  lookup failure, staging-failure propagation.
- `app/(main)/departure-groups/[groupId]/brochure-actions.test.ts`:
  updated for the broadened role set and `vault_documents` insert.
- Manual verification still needed (no login credentials available to the
  agent): open the vault dialog from the sidebar, upload a document into
  a category, confirm it appears; from the Inbox composer, choose that
  same document from the vault and send it, and confirm it arrives as a
  real attachment, not re-uploaded from the browser a second time.

## Status

Code-complete: migration applied to the live Supabase project (with
explicit sign-off, given the classifier block on the destructive version);
data model, access, server actions, and UI all implemented; 3592 tests
pass; typecheck/lint/build all pass. The one carried-forward brochure row
had its `category` corrected from `BROCHURE` (the migration's literal)
to `Brochure` (the app's canonical casing via `normalizeVaultCategoryLabel`)
so it joins the same tab new brochures use, rather than a stray duplicate.
Manual browser click-through is the one remaining item, same constraint
as TASK-023 — the agent has no staff login.
