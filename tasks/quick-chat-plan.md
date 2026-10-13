# Implementation Plan: Quick Chat popup

Spec: [`docs/inbox/quick-chat-popup-spec.md`](../docs/inbox/quick-chat-popup-spec.md) (approved with recommended defaults, 2026-10-12).
Task list: [`tasks/quick-chat-todo.md`](./quick-chat-todo.md). Written 2026-10-12. Read-only planning; no code changed.
(`tasks/plan.md` / `todo.md` belong to the Supabase-scheduling initiative and are untouched.)

## Overview

A bottom-left popup, mounted once in `app/(main)/layout.tsx`, that lets staff send WhatsApp (later email) from Leads, Finance, Documents, Pilgrims and Visa through the existing Inbox send actions, replacing `wa.me` redirects. It is a thin client: no new send pipeline, no migration expected.

## Architecture decisions

- **Reuse the server actions as-is.** `sendStaffMessage`, `startWhatsAppChat`, `sendConversationTemplateAction` keep their signatures. New server code is limited to two read actions (resolve target, trimmed thread) in `app/inbox/quick-chat-actions.ts`.
- **Decision logic is pure and tested first.** `resolve-target` and `quick-chat-state` live in `lib/inbox/quick-chat/` and are the only place window/template/consent/ownership/role rules are combined for the UI. The server stays the real boundary.
- **Event bus, not imports.** Pages call `openQuickChat()`; only the provider knows the popup. Same pattern as `open-inbox-event.ts`.
- **Do not embed the full workspace.** No import of `conversation-panel.tsx` or `message-composer.tsx`.
- **One slice = one PR, each ends runnable.** Slices land behind a single feature flag (`quick_chat` env/setting, see T1) so call sites can be migrated and rolled back independently; the `wa.me` code stays until the soak ends.
- **Access change is isolated.** The FINANCE/VISA `sendFromRecord` capability gets its own task, tests and sign-off (it changes who can message customers).
- **Architecture before code** (AGENTS.md / feature-development-workflow): T1 records the decisions in `docs/inbox/architecture.md` first.

## Dependency graph

```
T0 templates audit (ops) ─────────────────────────────┐
T1 flag + docs ─► T2 event+provider+launcher ─► T3 resolve+send text (Leads quote)
                                                   │        │
                        T4 access: sendFromRecord ─┤        ├─► T5 realtime thread + unread
                                                   │        │
                                                   └────────┴─► T6 window/template step + consent/ownership copy ◄─ T0
                                                                 │
                                                                 ├─► T7 PDF attachment
                                                                 ├─► T8 migrate call sites (Finance, Documents, Pilgrims, Visa)
                                                                 └─► T9 email
                                                   T10 e2e + a11y + docs + soak ◄─ T7,T8
```

Parallelisable once T3 is merged: T4, T5, T6. T7, T8, T9 are independent of each other.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Few/no approved templates, so most proposal sends are blocked | T0 first; T6 shows an explicit "no template available" state; keep `wa.me` fallback behind the flag |
| Granting FINANCE/VISA send rights widens who can message customers | Own task T4, server-side check inside the popup path only, audit via existing message author fields, explicit sign-off |
| Popup overlaps the sidebar footer or page UI (sheets, toasts) | Anchor to content area via sidebar CSS var; manual check at several widths in T2; z-index below dialogs |
| Realtime load from every open tab | Subscribe only to the open conversation topic plus a count-only list signal; reuse hidden-tab pause and single-flight runner |
| "Mark as sent" semantics change breaks finance records | `onSent` callback only; failed send leaves record untouched; covered by tests per call site in T8 |
| Double send (double click, two tabs) | Reuse client idempotency key (`reply-key`) and template-send claims |
| Next.js breaking changes | Read `node_modules/next/dist/docs/` relevant pages before T2 |

## Verification checkpoints

- **Checkpoint A (after T3):** one real WhatsApp text sent from the Leads quote in the popup, visible in `/inbox`; lint, typecheck, test, build green. You review before more slices.
- **Checkpoint B (after T6):** window-closed, new-number, opted-out and owned-by-colleague each behave per spec; T0 answered.
- **Checkpoint C (after T8):** no `wa.me` opens for send-capable roles on migrated pages; e2e green.
- **Final (T10):** soak a week with flag on for one agency before removing the old links.

## Open items still needing you

- T0 outcome: which approved templates exist (proposal, receipt, document request).
- Sign-off on T4's capability name and role mapping before it is merged.
