# Runbook — Connecting and testing Instagram

Owner: whoever administers the Meta app · Last updated: 2026-09-19 · Branch `meta-messaging-unified-connect`

Each Meta channel has its **own onboarding**: WhatsApp (Embedded Signup, `META_CONFIG_ID`), Messenger
(`META_MESSENGER_CONFIG_ID`) and Instagram (`META_INSTAGRAM_CONFIG_ID`, this runbook). Messenger's setup is in
[messenger-meta-setup-and-test.md](messenger-meta-setup-and-test.md); migrations (§1 there), the tunnel (§2) and
app roles (§5) apply here too. Ads and marketing are a separate integration and untouched.

Facts are tagged **(docs)** when Meta's documentation says so, **(inferred)** when it follows from the docs, and
**(verify)** when only a real test can settle it.

---

## 1. How Instagram connects

Instagram messaging with Facebook Login for Business goes through the **Facebook Page** the Instagram account is
linked to: the Page's access token, `POST /me/messages`, recipient = the customer's Instagram-scoped id (IGSID),
webhook object `instagram` with `entry.id` = the Instagram professional account id **(docs)**. So the agency
signs in, shares the Page, and the CRM finds the linked Instagram account from it. No Instagram Business Login, no
60-day token refresh, and probably no second app secret **(verify: F9)**.

---

## 2. Meta App Dashboard

1. **Add Instagram messaging** (Use cases → "Engage with customers on Instagram"). **(docs)**
2. **Facebook Login for Business → Configurations → Create.** Name it e.g. `Manasik Instagram connect`.
   - **Token type:** system-user access token, as for WhatsApp **(docs: long-lived)**.
   - **Assets:** **Pages** and **Instagram accounts**.
   - **Permissions:** `instagram_basic`, `instagram_manage_messages`, `pages_show_list`, `pages_manage_metadata`,
     `pages_read_engagement`, `business_management` (a dependency of `instagram_manage_messages`) **(docs)**.
   - Save; put the **Configuration ID** in `META_INSTAGRAM_CONFIG_ID`.
   - `https://<domain>/` must already be in **Valid OAuth Redirect URIs** (WhatsApp and Messenger use it).
3. **Webhooks → object `Instagram`:**
   - **Callback URL:** `https://TUNNEL/api/webhooks/instagram`
   - **Verify token:** `INSTAGRAM_VERIFY_TOKEN` — or reuse the Messenger one; the handler accepts either.
   - **Subscribe the fields:** `messages`, `messaging_postbacks`, `messaging_seen`. **(docs)**
   - Prove the handshake first if it fails:
     ```powershell
     curl "https://TUNNEL/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=abc"
     # must print: abc      (a 403 means the token is wrong or not set)
     ```
4. **The Instagram account** must be **Professional** (Business or Creator) **(docs)**, **linked to the Facebook
   Page** (Meta Business Suite → Settings → Accounts → Instagram accounts), and have **Allow access to messages**
   on: Instagram → Settings → Messages and story replies → Message controls → Connected tools. **(docs)**
5. **The app must be Live**, or Instagram webhooks are not sent **(docs)**.
6. **App roles:** the test accounts need a role while the app is in Development (see the Messenger runbook §5).

`.env.local`, then **restart the dev server**:

```bash
META_INSTAGRAM_CONFIG_ID=          # the Configuration ID from step 2
INSTAGRAM_VERIFY_TOKEN=            # optional — falls back to MESSENGER_VERIFY_TOKEN
INSTAGRAM_APP_SECRET=              # optional — only if Meta signs Instagram webhooks with a different secret (F9)
```

---

## 3. Connect

1. `https://TUNNEL/management/settings/integrations`, as ADMIN. On the **Instagram** card press **Connect with
   Instagram**. ("not configured … META_INSTAGRAM_CONFIG_ID is missing" → §2 not applied / server not restarted.)
2. Choose the business portfolio, tick the **Facebook Page** and the **Instagram account**, approve.
3. **Expected:** the card says **Connected** with `@handle`; the assistant switch is **off**.
4. If it fails, the message says what to do:

   | Message | Fix |
   | --- | --- |
   | `Meta did not share any Facebook Page…` | Connect again and tick the Page linked to the Instagram account |
   | `No Instagram professional account is linked to <Page>` | Switch the account to Professional, link it to the Page, connect again |
   | `Meta accepted the connection but is not sending … messages` | See §6 "connected but silent" |
   | `already connected to another agency` | Disconnect it on the other agency first |
   | A picker: "Which Instagram account…" | Several accounts were shared; choose one |

5. Confirm in SQL:
   ```sql
   select provider, provider_account_id, display_name, status, ai_enabled,
          credential_ref is not null as has_token, provider_metadata
     from public.channel_connections where provider = 'INSTAGRAM';
   -- provider_account_id = the Instagram account id; metadata.page_id = its Page.
   -- status CONNECTED, ai_enabled false, has_token true.
   ```

Disconnecting Instagram does not unsubscribe the Page while Messenger still uses it, and each connection keeps its
own copy of the Page token.

---

## 4. Test script

Use a second Instagram account as the customer.

| # | Do this | Expected |
| --- | --- | --- |
| I1 | DM the business account "Salam, Umrah in March?" | A conversation appears in the Inbox, channel Instagram, named `@handle` (or "Instagram customer"), with a lead that has **no phone** |
| I2 | Switch the Instagram assistant **on**, DM again | An automated reply within ~30 s that says it is an assistant, in the same persona as WhatsApp |
| I3 | Ask something long in Sinhala or Tamil | The reply arrives split in order, each part under 1000 UTF-8 bytes, and **no part flips the conversation to "human active"** |
| I4 | Reply from the Instagram app as the business | Within ~10 s the conversation goes to staff and the assistant stops |
| I5 | Reply from the CRM Inbox | The customer receives it |
| I6 | After 24 h+, reply from the Inbox | A clear "outside the 24-hour window" message |
| I7 | Unsend a message in Instagram | Nothing happens in the CRM |
| I9 | Open the conversation in the Inbox with the last customer message over 24 hours old, and one where the customer never wrote | "Reply window closed" / "Customer must message first" above the box; Reply is disabled, Note works |
| I10 | AI Agent → Assistant performance → **Instagram** | One row for Instagram in "How each channel is doing", with reply time and the "over 30 s" share |
| I8 | With **voice notes** switched on under AI Agent, send a short voice note in English, then Sinhala or Tamil | The message shows the transcript (not "[Voice message …]"), and the assistant answers it in the same persona; with voice off it asks the customer to type |

---

## 5. What to record — settles the "Verify" items

- [ ] **Page subscription delivers Instagram events?** Does I1 arrive with no extra step? If not, the Instagram
  account needs its own subscription (a small change).
- [ ] **Granted scopes.** Access Token Debugger on the login token (redact it): `granular_scopes` for
  `instagram_manage_messages` and `pages_messaging`.
- [ ] **Echo `app_id`.** In `channel_webhook_events.payload` for I4 and I2: is `message.app_id` present?
- [ ] **Outside-window error.** The exact `error.code` / `error_subcode` for I6 (the code recognises `10 / 2534022`, unconfirmed).
- [ ] **Text limit.** Does a 1,000-character English reply go through? (Meta's page says characters; the code counts bytes, the stricter reading.)
- [ ] **Voice-note download.** Does `metadata.media_url` on the saved message download without the token, or only with it (a `[Voice message — couldn't be understood]` result with `SERVICE_FAILED` means it failed)? Does the note's MIME type come back as `audio/mp4`?
- [ ] **Typing indicator.** Do `mark_seen` / `typing_on` succeed? (Best effort; failures are ignored.)
- [ ] **Signature secret.** A 401 on a real delivery means Instagram signs with another secret: set `INSTAGRAM_APP_SECRET`.
- [ ] **Token lifetime.** Next day, press **Test Connection** (F15).

---

## 6. Troubleshooting

- **"Connected but silent".** Check in order: app Live; the Instagram webhook object subscribed with `messages`;
  account linked to the Page and **Allow access to messages** on; `channel_webhook_events` — `signature_valid =
  false` means the secret differs.
- **Nothing in `channel_webhook_events` at all:** Meta is not calling the URL — recheck the callback URL and that
  the object is `Instagram`, not `Page`.
- **401 on every delivery:** `INSTAGRAM_APP_SECRET`.

---

## 7. Before this is usable

- The three migrations (`20261129090000`–`…090200`) are **not applied to any database**; connecting fails until
  they are (Messenger runbook §1 — the live database needs the history repair first).
- Before App Review: privacy and data-deletion pages mention only WhatsApp, and Instagram's permissions need a
  screen recording of the working flow.
