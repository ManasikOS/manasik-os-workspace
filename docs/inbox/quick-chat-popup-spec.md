# Spec: Quick Chat popup (send WhatsApp / Email from any page)

Status: **Approved with recommended defaults 2026-10-12; plan in `tasks/quick-chat-plan.md`.** No code written.

## Objective

Today, buttons such as "Send by WhatsApp" (Leads quote, Finance invoice, Documents request, Pilgrims, Visa, Suppliers, Team) open `wa.me` in a new tab. That sends from a staff member's *personal* WhatsApp, so nothing reaches the Inbox, nothing is on record, and "marked as sent" is recorded even if the person never pressed send.

Replace that with a small **support-style chat popup, bottom-left**, available on every `(main)` page. A page hands it a recipient and a pre-written draft; staff review, edit and send through the **same Inbox send path** (WhatsApp Cloud API / Gmail). Replies appear in the popup. The conversation is the same Inbox conversation, so it is also visible on `/inbox`.

**Users:** agency staff with Inbox send rights, working from Leads, Finance, Documents, Pilgrims, Visa.

**In scope (v1):** open from a page with a prefilled draft · send text · see the thread live (incoming + delivery ticks) · reply-window / template handling for WhatsApp · email subject + body · optional PDF attachment · unread badge · minimise / close · "Open in Inbox".

**Out of scope (stays in `/inbox`):** Copilot suggestions, intelligence rail, risk/triage review, assignment, bulk actions, saved views, notes, handoff, conversions, translation, voice playback tools, lead-linking UI, Instagram/Messenger *starting* a chat.

## Assumptions I'm making (correct me now)

1. The popup is a **thin client over existing server actions**; no new send pipeline and likely **no migration**. (Verified: `sendStaffMessage`, `startWhatsAppChat`, `sendConversationTemplateAction`, `startEmailConversation` already exist in `app/inbox/actions.ts` and carry the protection gate, idempotency, ownership and rate-limit rules.)
2. It mounts once in `app/(main)/layout.tsx`. `/inbox` has its own layout (`app/inbox/layout.tsx`), so it never shows there and never duplicates the full workspace.
3. WhatsApp rules are Meta's, not ours: free text only inside the 24 h reply window; outside it (or for a brand-new number) an **approved template** is required and is billable.
4. A page opens the popup with a **draft the staff member reviews**, never an auto-send (same principle as `announceComposerDraft`).
5. Messages sent here are Inbox messages. Staff will no longer send from their personal WhatsApp for these flows.
6. Desktop-first like the rest of the CRM; on narrow screens it becomes a full-width bottom sheet.
7. "Left-bottom" is honoured literally. Note: the app sidebar docks on the left (`--sidebar-width: 15rem`), so the popup anchors to the bottom-left of the *content area*, offset by the sidebar, instead of covering the sidebar footer.

## Behaviour changes you should know about

- **Window/templates.** A lead who has never messaged you has no open window. Free-text "proposal" cannot be sent; staff must pick an approved template (reusing `InboxConversationTemplatePicker`). The popup must make this clear, not fail silently.
- **Billing.** Template sends are charged by Meta; the existing `template-charge-label` copy is reused.
- **Opt-out.** `checkStartChatConsent` refuses leads marked do-not-contact / opted out. The popup shows that reason instead of opening wa.me for them (today the wa.me path bypasses this check).
- **Ownership.** Sending makes the sender the conversation owner; a chat owned by a colleague is refused (`decideReplyOnOwnedConversation`). The popup shows who owns it and links to `/inbox`.
- **"Mark as sent" order.** Today `sendQuoteAction` / `sendInvoiceAction` record "sent via WhatsApp" *before* opening wa.me. With the popup the record must happen **after the channel accepts the message** (callback on success).

## Tech Stack

Next.js (App Router; version has breaking changes, read `node_modules/next/dist/docs/` before writing), React, TypeScript, Supabase (Postgres + private Realtime channels), Zod, Vitest, Playwright, shadcn on Base UI (`render={<a />}` pattern), `reicon-react` icons.

## Commands

```
Dev:        npm run dev            (https)   |  npm run dev:http
Lint:       npm run lint
Typecheck:  npm run typecheck
Unit tests: npm run test           (vitest run)
Single:     npx vitest run lib/inbox/quick-chat
E2E:        npm run test:e2e -- e2e/quick-chat.spec.ts
Build:      npm run build
```

## Project Structure

```
components/quick-chat/            → popup UI (client): launcher, panel, thread, composer, template step
  quick-chat-provider.tsx         → listens for the open event, owns open/minimised state, mounted in (main)/layout
lib/inbox/quick-chat/             → pure, unit-tested logic
  open-quick-chat-event.ts        → OPEN_QUICK_CHAT_EVENT + openQuickChat() (modelled on open-inbox-event.ts)
  resolve-target.ts               → recipient → existing conversation | "needs template" | "blocked" decision
  quick-chat-state.ts             → window/template/consent/ownership → what the composer allows
app/inbox/quick-chat-actions.ts   → ONLY new server actions: resolve target, load a trimmed thread
docs/inbox/quick-chat-popup-spec.md  (this file)
e2e/quick-chat.spec.ts
```

Reuse, do not copy: `lib/inbox/composer-state`, `reply-window-notice`, `pending-send`, `reply-key` (idempotency), `template-charge-label`, `realtime/*` topics and merge, `message-preview`, `contact-avatar-color`, `open-inbox-event` (for "Open in Inbox"). Do **not** import `conversation-panel.tsx` / `message-composer.tsx` (≈1,600 lines of full-workspace behaviour).

## Code Style

Mirror `lib/inbox/open-inbox-event.ts`: a tiny typed `CustomEvent` bus, so call sites never import the popup.

```ts
export const OPEN_QUICK_CHAT_EVENT = "inbox:quick-chat";

export interface OpenQuickChatDetail {
  channel: "WHATSAPP" | "EMAIL";
  /** Digits (international) for WhatsApp, address for email. */
  to: string;
  contactName: string;
  /** Prefilled text. Staff review and send; it is never auto-sent. */
  draft?: string;
  subject?: string;
  /** Called only after the channel accepted the message (record "sent" here). */
  onSent?: (result: { conversationId: string; messageId: string }) => void;
}

export function openQuickChat(detail: OpenQuickChatDetail): void {
  window.dispatchEvent(new CustomEvent<OpenQuickChatDetail>(OPEN_QUICK_CHAT_EVENT, { detail }));
}
```

Call-site change (example, Leads quote): replace `window.open(whatsappLink(...))` with `openQuickChat({ channel: "WHATSAPP", to: "94" + lead.mobileRaw, contactName: lead.name, draft: text, onSent: markQuoteSent })`.

Conventions: server actions return `{ ok: true } | { ok: false, error }`; user-facing errors are plain sentences; toasts via the existing `toast.add`; no colour-only status (the inbox rule); shadcn components only, design tokens per `docs/standards/ui-standards.md`.

## Testing Strategy

| Level | What | Where |
|---|---|---|
| Unit (Vitest) | `resolve-target` and `quick-chat-state`: window open/closed, new number, opted-out, owned-by-colleague, closed conversation, email vs WhatsApp, role without send | `lib/inbox/quick-chat/*.test.ts` |
| Unit | open-event contract; `onSent` fires only on success | same |
| Action tests | new actions are agency-scoped, refuse roles without `sendMessage`, never return another agency's thread | `app/inbox/quick-chat-actions.test.ts` (style of `actions.protection.test.ts`) |
| E2E (Playwright) | open from Leads quote → draft prefilled → send → appears in thread; window-closed → template step; opted-out → refusal; popup absent on `/inbox`; keyboard + Esc + focus return | `e2e/quick-chat.spec.ts` |
| Manual | per `feature-development-workflow.md` §5: golden path, empty, denied, error; sidebar overlap; mobile width | browser |

Coverage expectation: every branch of `quick-chat-state` and `resolve-target` has a test; existing inbox suites stay green (`npm run test`).

## Boundaries

- **Always:** enforce permission, agency scope, protection gate, idempotency and rate limit **on the server** (hiding a button is not a boundary) · reuse existing send actions · show window/template/billing facts in words · trap and restore focus · run lint + typecheck + test before each commit · read the Next.js docs in `node_modules/next/dist/docs/` first.
- **Ask first:** any migration or RLS change · adding a dependency · changing `sendStaffMessage` / `startWhatsAppChat` signatures · granting new roles send rights · removing `wa.me` fallbacks · new per-user/per-agency rate limits.
- **Never:** auto-send without staff pressing send · bypass `checkStartChatConsent` or the ownership guard · log message text or phone numbers · fork the send pipeline for the popup · put full-Inbox features into it · remove failing tests.

## Success Criteria

1. From Leads, Finance, Documents, Pilgrims and Visa, the "Send by WhatsApp/Email" button opens the popup with the right recipient and draft; **no `wa.me` tab opens** for roles that can send.
2. A free-text message inside the reply window is delivered and shows sent → delivered → read ticks without a page reload.
3. With no open window, free text is blocked with an explanation and the template step offers approved templates with their cost label; a template send creates/opens the conversation.
4. An incoming reply appears in the popup within the existing Realtime latency; the launcher shows an unread count; the count clears on viewing.
5. Opted-out numbers, colleague-owned chats, closed chats and roles without send rights each get a specific plain-language message and no send occurs.
6. The same conversation, with the same messages, is visible in `/inbox`.
7. "Marked as sent" on the quote/invoice/request is recorded only after a successful send; a failed send leaves the record untouched.
8. Popup never renders on `/inbox`; does not cover the sidebar footer; usable by keyboard and screen reader; works at 375 px width.
9. No new migration unless an Open Question below forces one. `npm run lint && npm run typecheck && npm run test && npm run build` pass; new e2e passes.

## Decisions (2026-10-12, recommendations accepted)

1. **Roles:** add a narrow capability (working name `sendFromRecord`) letting FINANCE and VISA send through the popup only. It does not open the Inbox to them. Access change, so it ships with its own tests and sign-off task.
2. **Attachments:** v1 supports one PDF per message via `prepareStaffAttachmentUpload` + `StagedAttachmentRef`.
3. **Templates:** still **unknown**. Treated as an ops prerequisite (task T0): confirm approved templates for proposal, receipt and document request. Until then those sends show the template step with whatever exists, and fall back to a clear "no template available" message.
4. **Call sites v1:** Leads, Finance/invoice, Documents, Pilgrims, Visa. Suppliers, Team, Campaigns keep `wa.me`.
5. **Email:** WhatsApp first; email is a later slice behind mailbox readiness.
6. **Multi-chat:** one open chat plus a recent-chats list.
7. **Position:** bottom-left of the content area, right of the sidebar.

## Next phases (after you approve)

PLAN (`tasks/plan.md` is currently used by the Supabase-scheduling initiative, so this will go to `tasks/quick-chat-plan.md` / `tasks/quick-chat-todo.md`) → thin vertical slices:
1. `openQuickChat` event + provider + empty launcher (mounted, no behaviour).
2. Resolve target + send text for an existing conversation (one call site: Leads quote).
3. Realtime thread + unread badge.
4. Template step + new-number start + consent/ownership messages.
5. Attachment; email.
6. Migrate remaining call sites; e2e; docs.
