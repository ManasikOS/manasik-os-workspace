# TASK-006 Instagram Login Connection (no Facebook Page)

## What

A second way to connect an agency's Instagram account, using Meta's **Instagram API with Instagram Login**
("Instagram business login"). The agency signs in with Instagram itself. No Facebook Page, no Business Suite
linking. The existing Facebook-Page connection stays as the fallback.

Everything downstream of the connection (webhook endpoint, ingest, Inbox, AI drain, outbox) is reused. What is
new is: the OAuth flow, an Instagram-host client, a 60-day token refresh, and a small branch in the send adapter.

## Why

- Onboarding today needs a Facebook Page linked to the Instagram account. That is the step where most agencies
  get stuck, and it is a poor fit for a multi-tenant product.
- On 2026-09-24 the Page-based connection could not be made to deliver any Instagram DM in the Live app (webhook
  verified, `messages` subscribed, Page and account linked, message access on, yet zero events and an empty
  `/{page}/conversations?platform=instagram`). The Meta app also has `instagram_manage_messages` **not
  submitted** for App Review. See "Evidence" below.
- Instagram Login supports **Instagram Testers** as app roles, which the Messenger use case does not. That makes
  a Development-mode test, and the App Review screen recording, possible.

**This reverses a recorded decision.** `docs/runbooks/instagram-meta-setup-and-test.md` §1 chose Facebook Login
"with no Instagram Business Login, no 60-day token refresh". That runbook and
`docs/modules/messenger-instagram-ai-agent-implementation-plan.md` must be updated when this ships (see
Documentation).

**This plan is not a guaranteed fix for the missing delivery.** Whether it delivers on the Live app is
unproven. Phase 0 exists to prove it before any product code is written.

## Evidence (why the current path is stuck)

- Vercel: `GET /api/webhooks/instagram` → 200 (handshake works); no `POST` ever; Messenger's `POST`s arrive.
- Meta Webhook Debugger for Page 1286483891218738: `messages` subscribed, Instagram account linked,
  Manage Messaging **On**. Dashboard "Test → Send to server" reports success; nothing reaches Vercel.
- `GET /{page}/conversations?platform=instagram` returns `{"data": []}`.
- App Review (2026-09-18) approved only WhatsApp permissions and `public_profile`. `instagram_manage_messages`
  sits under "New requests → Not submitted", with 2 API test calls and not "Completed".
- App went **Live on 2026-09-18**.

## Meta facts this design relies on

Tag: **[docs]** Meta documentation says so (fetched 2026-09-24); **[verify]** must be proven in Phase 0.

| Fact | Tag |
|---|---|
| Authorize: `GET https://www.instagram.com/oauth/authorize` with `client_id` (the **Instagram app ID**), `redirect_uri`, `response_type=code`, `scope`, `state` | docs |
| Scopes: `instagram_business_basic`, `instagram_business_manage_messages` | docs |
| Code → token: `POST https://api.instagram.com/oauth/access_token` (form: `client_id`, `client_secret` = **Instagram app secret**, `grant_type=authorization_code`, `redirect_uri`, `code`); the code is single-use | docs |
| Long-lived token: `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=…&access_token=<short>` → 60 days | docs |
| Refresh: `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=<long>`; token must be **≥ 24 h old and unexpired**; a token unused for 60 days expires permanently | docs |
| Send: `POST https://graph.instagram.com/v25.0/<IG_ID>/messages` body `{recipient:{id:<IGSID>}, message:{text}}` | docs |
| Subscribe the account: `POST https://graph.instagram.com/v25.0/me/subscribed_apps?subscribed_fields=messages,messaging_seen,messaging_postbacks…` with the Instagram user token | docs |
| Webhook `object` is `instagram`, `entry[].id` = the receiving Instagram professional account | docs |
| The Instagram app ID/secret **differ** from the Meta app ID/secret | docs |
| The id returned by the token exchange (`user_id`) equals the `entry.id` used in webhooks and the id we store as `provider_account_id` | **verify (Q1)** |
| Which secret signs the webhook (`META_APP_SECRET` or the Instagram app secret) | **verify (Q2)**: the code already accepts both |
| Where the callback URL + verify token are configured (Webhooks product vs the Instagram product) | **verify (Q3)** |
| Error codes/subcodes (token dead, outside 24 h window) match `classifyMessengerError` | **verify (Q4)** |
| `HUMAN_AGENT` tag behaviour on `graph.instagram.com` | **verify (Q5)** |
| Voice-note / attachment URLs download with the Instagram token | **verify (Q6)** |
| Delivery works on this app at all, in Development mode and in Live mode | **verify (Q7), the gate** |

## Phase 0: prove delivery before writing product code (the gate)

Nothing below is built until this passes. It needs no code change.

1. Create a **Development-mode** Meta app (or use the current one only if the owner accepts WhatsApp being
   role-only while testing). Add the **Instagram** product ("API setup with Instagram login"). Record the
   Instagram app ID/secret.
2. Add the test Instagram accounts as **Instagram Testers** (App roles) and accept each invite in Instagram
   (Settings → Apps and websites → Tester invites).
3. Configure the webhook (Q3) with the existing URL `https://<dev-domain>/api/webhooks/instagram`.
4. By hand (browser + curl, tokens never pasted into chat): authorize → exchange the code → exchange for a
   long-lived token → `POST /me/subscribed_apps?subscribed_fields=messages`.
5. DM the account from another tester. **Pass** = a `POST /api/webhooks/instagram` in Vercel logs and a row in
   `channel_webhook_events` with `object: "instagram"`. Record answers to Q1–Q7 in the runbook.
6. **Fail** = stop and raise a Meta support case; this design would not help.

## Design

### Approach

Same provider, new connect method. `channel_connections.provider` stays `INSTAGRAM`. The method is recorded in
`provider_metadata`:

```json
{ "connect_method": "INSTAGRAM_LOGIN", "instagram_account_id": "…", "username": "…",
  "token_issued_at": "…", "meta_user_id": "<ig user id>" }
```

A row with no `connect_method` is the existing Facebook-Page connection (`FACEBOOK_PAGE`). No enum change, so
nothing that filters on `provider = 'INSTAGRAM'` (webhook tenant gate, drains, Inbox) needs to change.

Rules kept: one live Instagram connection per agency; an account connected to another agency is refused; a
reconnect of the same account by the same agency updates the row in place (keeps conversations and
`ai_enabled`). If Q1 holds, an agency can convert a Page-based connection to Instagram Login by reconnecting
with no data loss.

### New / changed code (layer order, per the workflow)

**Config (no migration required):** `channel_connections` already has `credential_ref`, `credential_expires_at`
and `provider_metadata`. If the refresh sweep is slow at scale, add a partial index in a follow-up migration
(with the RLS review it requires). No new table.

| Layer | File | Change |
|---|---|---|
| Pure helpers | `lib/channels/instagram/login/oauth.ts` (new) | `buildInstagramBusinessLoginUrl({ appId, redirectUri, state, scopes })`; `parseCodeExchange`; `parseLongLivedExchange`; `needsRefresh(issuedAt, expiresAt, now)` (≥ 24 h old and ≤ 14 days left) |
| Graph client | `lib/channels/instagram/login/client.ts` (new) | `exchangeInstagramCode`, `exchangeForLongLived`, `refreshLongLived`, `getInstagramProfile` (`/me?fields=user_id,username,name`), `subscribeAccount`, `listAccountSubscriptions` on `graph.instagram.com` via the shared `metaGraphFetch` (host `instagram` already exists); `sendInstagramLoginText / QuickReplies / Action` |
| Connect logic | `lib/channels/instagram/login/connect.ts` (new) | Injected-deps module in the style of `instagram/connect.ts`: (1) owned by another agency → refuse before calling Meta; (2) a different live account → refuse; (3) subscribe then **read the subscription back**; (4) only then store the token in Vault, delete it if saving fails; (5) delete the previous token after the new one is saved |
| Deps wiring | `lib/meta/connect-deps.ts` | `buildInstagramLoginConnectDeps` |
| Zod | `lib/validations/instagram-login.ts` (new) | Callback query (`code`, `state`, `error`), refresh-cron params |
| Routes | `app/api/oauth/instagram-login/start/route.ts`, `…/callback/route.ts` (new) | Same shape as the existing `oauth/instagram` routes: `requireUser()`, `editIntegrations` check, sealed state cookie, agency-scoped. State prefix `igl_`. Explicit redirect URI (not the site-root rule; `ig_` rule in `next.config.ts` is untouched and does not match `igl_`) |
| Server action | `app/(main)/management/settings/integrations/instagram-actions.ts` | `connectInstagramWithLogin({ code, redirectUri })` |
| Adapter | `lib/channels/instagram/adapter.ts`, `lib/channels/adapter.ts`, `page-channel-adapter.ts` | `ResolvedChannelConnection` gains `connectMethod`. For `INSTAGRAM_LOGIN`: sends go to `/{ig-id}/messages` on `graph.instagram.com` (needs the account id), typing/seen the same, `reconnectNotice` updated. The Page path is untouched |
| Disconnect / test | `messenger-actions.ts` | For the login method: **no Page unsubscribe** (`otherChannelStillUsesPage` is skipped); best-effort `DELETE /me/subscribed_apps`; Test calls `getInstagramProfile`, not the Page label |
| Refresh | `app/api/cron/instagram-token-refresh/route.ts` (new) + scheduling | Daily. Bearer `CRON_SECRET` like the other crons; reachable via `MACHINE_ROUTES`. For each `INSTAGRAM_LOGIN` connection with `needsRefresh`: refresh → store new secret in Vault → update `credential_ref` / `credential_expires_at` / `token_issued_at` → delete the old secret. A dead-token failure sets `status = 'ERROR'` and the reconnect notice. Scheduling follows however the other crons are registered (they are set up in the Inbox migrations; **verify** the exact mechanism when building) |
| Webhook | `lib/channels/messenger/webhook-handler.ts` | **No change** expected: same object, same shape, tenant gate already resolves by `provider_account_id`. Only `INSTAGRAM_APP_SECRET` becomes meaningful (Q2) |
| Deauthorize / data deletion | `lib/channels/meta-user-revocation.ts`, `app/api/webhooks/meta/deauthorize/route.ts` | Instagram Login has its own deauthorize and data-deletion callback settings. Confirm the payload (Q-later) and reuse the same revocation; `meta_user_id` = the Instagram user id |
| UI | `app/(main)/management/settings/integrations/meta-page-channel-card.tsx` | Instagram card: primary **Connect with Instagram** (login method), secondary link **Connect through a Facebook Page instead** (existing flow). Show the connect method and the token expiry date. Copy stays plain-language. shadcn components only; existing `InputGroup` pattern where an input is needed |

### Environment variables

| Variable | Purpose |
|---|---|
| `INSTAGRAM_APP_ID` (new) | The **Instagram** app ID for `client_id` (not `META_APP_ID`) |
| `INSTAGRAM_APP_SECRET` (existing, now required for this flow) | Code and long-lived exchange; also a webhook signing candidate (already supported) |
| `INSTAGRAM_VERIFY_TOKEN` (existing) | Webhook handshake |
| `META_GRAPH_VERSION` (existing) | `v25.0` |

Add to `.env.example` and the runbook. Never `NEXT_PUBLIC_`.

## Data model changes

None required. `provider_metadata` gains documented keys (`connect_method`, `token_issued_at`). Optional
partial index for the refresh sweep; if added, it ships in its own migration with the RLS review the workflow
requires (`channel_connections` already has RLS from the foundation migration).

## Access control changes

None. Every action and route reuses `requireUser()` + `capabilitiesForSettings(role).editIntegrations`. All reads
and writes are agency-scoped (service-role client, hand-scoped as in `channel-connection-repository.ts`). Cron
routes use the existing bearer secret.

## Security notes

- `client_secret` and tokens stay server-side; tokens go to Vault only, never a column or a log.
- OAuth `state` is random, cookie-bound (`httpOnly`, `secure`, `sameSite=lax`, 10 min) and checked before the
  single-use `code` is exchanged.
- A refreshed token replaces the old Vault secret; the old one is deleted after the new one is saved (no orphan).
- Zod-validate the callback query at the boundary; unknown `state` → refuse without calling Meta.
- Disconnect deletes the secret and unsubscribes best-effort; conversations are kept.
- Run the security checklist in `docs/security/security-guidelines.md` §10 before the PR.

## UI surfaces

Integrations page, Instagram card only. States to cover: not connected, connecting (redirect), connected (login
method, with expiry), connected (Page method, legacy), token expiring soon, needs reconnect (ERROR), Meta error
(callback message), not configured (`INSTAGRAM_APP_ID` missing).

## Test plan

Automated (Vitest, per `docs/standards/testing-standards.md`):

- `oauth.ts`: URL building (scopes, state, redirect), `needsRefresh` boundaries (23 h, 24 h, 14 d, expired).
- `client.ts`: parsing of code exchange (including the `data: [...]` wrapper), long-lived exchange, refresh,
  Meta error mapping, with a mocked `fetch`.
- `connect.ts`: the five ordering rules with injected deps: another agency refuses before any Meta call; a
  different live account refuses; subscription read-back failure stores nothing; save failure deletes the new
  secret; the previous secret is deleted only after the new one is saved.
- Adapter: `INSTAGRAM_LOGIN` sends to `graph.instagram.com/{id}/messages`; `FACEBOOK_PAGE` unchanged (regression).
- Refresh cron: refreshes only connections due; a failed refresh flags `ERROR` without touching others; a
  second agency's connection is never touched.
- Webhook handler: an Instagram-Login-shaped payload resolves the tenant and ingests (fixture from Phase 0).

Manual, in the browser (Development-mode app, Instagram Testers): connect, DM in, reply out, Disconnect, Test
Connection, reconnect, expiry display, both error paths. `npm run lint`, `npm run typecheck`, `npm run test` all
pass before the PR.

## Delivery slices

1. **Phase 0** (no code): the gate above. Output: answers to Q1–Q7 in the runbook.
2. **S1**: helpers, client, connect module + tests (no UI, no routes).
3. **S2**: routes, server action, env, card, adapter branch, disconnect/test branch.
4. **S3**: refresh cron + scheduling, deauthorize wiring, docs and runbook updates.

## Risks and open questions

- **It may not fix delivery.** Live-mode Instagram messaging may still require Advanced Access for the new
  scopes. Phase 0 answers this first. Regardless, App Review for `instagram_business_manage_messages` (with a
  screen recording made in the Development-mode app) is required to serve any agency outside the app's roles.
- Token lifecycle is new operational load: a missed refresh window disconnects an agency. Mitigation: refresh at
  T-14 days, daily sweep, "expiring soon" banner, ERROR + reconnect notice.
- Two connect methods mean two code paths to support. Mitigation: shared adapter and webhook; one column
  (`connect_method`) decides the difference; the Page path is left untouched.
- The doc set conflicts on where the webhook is configured and which secret signs it (Q2, Q3). The code
  already accepts both secrets, so this costs configuration, not code.

## Documentation to update when built

- `docs/runbooks/instagram-meta-setup-and-test.md`: §1 (reverse the "no Instagram Business Login" decision),
  §2 (Instagram product setup), §5 (record Q1–Q7 answers), §6 (troubleshooting from this incident).
- `docs/modules/messenger-instagram-ai-agent-implementation-plan.md`: connect method and refresh.
- `docs/runbooks/messenger-instagram-hardening.md`: token expiry.
- `.env.example`.

## Phase 0 log

- **2026-09-24, dashboard audit (read-only).** The current app (ManasikOS, id 2163697914178462, Live) has **no
  Instagram Login use case**. Its use cases are Marketing API (x3), app ads, WhatsApp, oEmbed, ads MCP, Catalog
  and Messenger from Meta. **"Manage messaging & content on Instagram"** is offered under Add use cases, so it can
  be added, but that changes a Live app that also serves WhatsApp. Nothing was added.
- **Decision (owner, 2026-09-24): add the use case to the Live app.** Done: "Manage messaging & content on
  Instagram" (use case enum `INSTAGRAM_BUSINESS`) is now on the app. Nothing else was changed.
- The product page ("API setup with Instagram login") shows the **Instagram app name `ManasikOS-IG` and Instagram
  app ID `1057637823763593`** (public id, safe to record; the secret is not recorded anywhere). Its steps:
  1. Add required permissions: `instagram_business_basic`, `instagram_business_manage_comments`,
     `instagram_business_manage_messages`.
  2. Generate access tokens (Add account).
  3. **Configure webhooks** (callback URL, verify token, client-certificate toggle, "Verify and save"), which
     answers **Q3**: the Instagram Login webhook is configured **inside this product page**, separately from the
     app-level Webhooks screen used by the Page flow. It also states the app must be in the published state.
  4. Set up Instagram business login (OAuth redirect URIs).
  5. Complete App Review for Advanced Access.
- **Changes made in the Meta app (owner-approved, 2026-09-24):**
  1. "Add all required permissions": `instagram_business_basic`, `instagram_business_manage_comments`,
     `instagram_business_manage_messages` added to the app (Standard Access; not yet reviewed).
  2. "Set up Instagram business login": redirect URL registered as
     `https://workspace.manasikos.com/api/oauth/instagram-login/callback`. Meta then displayed the launch URL
     `https://www.instagram.com/oauth/authorize?client_id=1057637823763593&redirect_uri=<above>&response_type=code&scope=…`,
     which matches the documented authorize endpoint. Meta's sample includes extra scopes (content publish,
     insights, comments); **our flow requests only `instagram_business_basic` and
     `instagram_business_manage_messages`** (least privilege, and a smaller App Review).
  Not yet done: webhook configuration (product step 3, needs the verify token, entered by the owner), Instagram
  Testers, Vercel env vars (`INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`).
- **Q1 answered (2026-09-24, manual test as `@manasikos`).** Code exchange, long-lived exchange and
  `GET /v25.0/me?fields=user_id,username` all succeeded. `user_id` = `17841429904911692`, identical to the
  `provider_account_id` the Page-based flow stored for the same account. `/me` also returns a different
  app-scoped `id` (`28847206491542882`), which must **not** be used as the account id. The connect module stores
  `user_id`. Consequence: an agency can convert a Page-based connection by reconnecting; the row is reused.
- Instagram Testers added to the app (all **Pending** at the time of writing): `manasikos`, `royalalfathima`,
  `studinityofficial`.
- Q2, Q4–Q7 are still unanswered (Q7, delivery, is the gate).

## Build log

**2026-09-24, S1 and S2 built at the owner's direction** (the Integrations "Connect with Instagram" button
started the Facebook-Page flow; it now starts this one). Delivery (Q7) is still **unproven**: no DM from a tester
has been seen arriving yet, so this ships behind that open risk.

Built:

- `lib/channels/instagram/login/oauth.ts`, `client.ts`, `connect.ts` (+ tests): authorize URL, code and long-lived
  token exchange, `/me` profile (uses `user_id`, never the app-scoped `id`), account subscription with read-back,
  sends on `graph.instagram.com`. Token in the Authorization header, never a URL or an error message.
- `lib/meta/connect-deps.ts`: `buildInstagramLoginConnectDeps`.
- `lib/validations/instagram-login.ts` (+ test): callback query and code, length-capped.
- `app/api/oauth/instagram-login/{start,callback}/route.ts`: `requireUser()`, `editIntegrations`, sealed state
  cookie (`igl_`), state compared in constant time and consumed before use.
- `instagram-actions.ts`: `connectInstagramWithLogin({ code })`, redirect URI derived on the server.
- Adapter: `ResolvedChannelConnection.connectMethod`; `page-channel-adapter.ts` reads `provider_metadata`;
  the Instagram adapter sends a Login connection through `graph.instagram.com/<account id>/messages`. The Page
  connection path is unchanged (regression test).
- `messenger-actions.ts`: Disconnect (no Page unsubscribe for Login; best-effort account unsubscribe) and Test
  Connection (profile check for Login).
- Integrations card: primary **Connect with Instagram** (Login), secondary **Connect through a Facebook Page
  instead** when `META_INSTAGRAM_CONFIG_ID` is set. `.env.example` updated.

Verification: `npm run typecheck` clean; `eslint` on touched files has no new findings; channel tests 267 pass
(42 new). The full suite has **2 failures in `lib/inbox/realtime/sc5-migration.test.ts`**, which asserts text in
`supabase/migrations/20261202094300_sc5_scoped_inbox_broadcasts.sql`; neither file is part of this change.
**Not yet done:** browser walk-through of the card and the real connect (needs a signed-in session and an
Instagram Tester that has accepted its invite); Q2 and Q4 to Q7.

**2026-09-24, first real DMs arrived after the Login connect; fix: customer names.** Conversations showed the
"Instagram customer" placeholder because the name lookups in `lib/channels/messenger/profile.ts` call
`graph.facebook.com` with a Page token, which is refused for an Instagram Login token. The webhook handler now
uses `fetchInstagramLoginCustomerName` (`graph.instagram.com/<IGSID>?fields=name,username`, the account's own token)
when `provider_metadata.connect_method` is `INSTAGRAM_LOGIN`; `ChannelConnectionRecord` gained an optional
`provider_metadata`. Existing placeholder conversations are renamed on the customer's next message (the lookup
already runs whenever the stored name is a placeholder). Delivery (Q7) is now **confirmed** on the Login route.

**Not built (S3, next):** the daily 60-day token refresh cron, an "expires soon" badge, the deauthorize /
data-deletion wiring, and the runbook rewrite. **Until the refresh exists, a Login connection stops working when
its token expires (about 60 days after connecting) and must be reconnected by hand.**

## Status

In progress. S1 and S2 are built and tested; delivery (Q7) and S3 (token refresh) are open.
