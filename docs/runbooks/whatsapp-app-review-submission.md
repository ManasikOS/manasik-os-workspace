# WhatsApp App Review Submission — Manasik OS

Ready-to-paste content for Meta's App Review request on **Manasik OS** (App ID `2163697914178462`),
requesting **Advanced Access** on `whatsapp_business_management` and `whatsapp_business_messaging`.
See `docs/whatsapp-meta-connection-implementation-plan.md` §4 M2/M3 for how this fits the overall plan.

---

## 0. Before you submit — the checklist App Review actually checks

- [ ] **App icon** set (App Dashboard → Settings → Basic)
- [ ] **Category** set to Business
- [ ] **Privacy Policy URL**: `https://hajj-umrah-crm.vercel.app/legal/privacy`
- [ ] **Terms of Service URL**: `https://hajj-umrah-crm.vercel.app/legal/terms`
- [ ] **Data Deletion Instructions URL**: `https://hajj-umrah-crm.vercel.app/legal/data-deletion`
- [ ] Replace the placeholder email in all three `/legal/*` pages with a real inbox you monitor —
      Meta's reviewer may actually send a test request to it
- [ ] **Business Verification** completed on the Business Portfolio Manasik OS belongs to
- [ ] Two screen recordings ready (§2 below)
- [ ] A real WhatsApp number connected and working end-to-end (you already have this — Mode A / your
      own number, per the earlier work in this thread)

---

## 1. Use-case descriptions (paste into the App Review request form)

Meta asks for one written justification per permission. Use these as a starting point — they're
accurate to what this app actually does, which is what App Review is checking for; don't generalize
them into vague SaaS language.

### `whatsapp_business_management`

> Manasik OS is an operations CRM for Hajj & Umrah travel agencies. Each agency connects its own
> WhatsApp Business Account to the platform so it can view its account's phone number details,
> quality rating, and messaging limits, manage its own message templates (for booking confirmations,
> departure reminders, and payment updates), and subscribe our app to receive that account's webhook
> events. We use `whatsapp_business_management` to read and manage exactly one WhatsApp Business
> Account per connected agency — never another agency's, and never assets outside WhatsApp (no Pages,
> ad accounts, or Instagram access is requested). This is required for the one-click "Connect with
> Meta" flow (Embedded Signup) that lets an agency onboard its own number without manually generating
> or pasting API tokens.

### `whatsapp_business_messaging`

> Once an agency connects its WhatsApp Business number, our platform sends and receives messages on
> that agency's behalf: customer enquiries arrive in the agency's shared Inbox, staff reply directly
> from the CRM, and — where an agency enables it — an AI assistant drafts replies grounded in that
> agency's own trip and booking data. `whatsapp_business_messaging` is required to register the
> connected phone number on the Cloud API, send text/template/interactive messages, and receive
> inbound messages and delivery-status webhooks. Every message is scoped to the one agency that
> connected that number; the platform never sends unsolicited or bulk marketing messages without the
> agency's own initiation.

---

## 2. The two screen recordings

Meta explicitly accepts a recording of the actual product in place of a Postman/cURL demo — record
these against Manasik OS's own connected number, showing the **CRM's UI**, not a terminal. Keep each
under ~3 minutes; narrate in plain language as you click, since reviewers watch quickly.

### Video 1 — "message sent from your app, received on WhatsApp"

1. Open the CRM's **Inbox** (`/inbox`) — show it logged in as agency staff, with the connected
   WhatsApp number visible in Settings → Integrations (status: Connected) as a quick establishing
   shot.
2. Open (or start) a conversation with a real WhatsApp number you control (your own phone).
3. Type a plain reply in the Inbox and send it.
4. Cut to your phone's WhatsApp — show the message arriving in that chat, from the connected
   business number.
5. Optional but strengthens the review: send a message **from your phone** to the business number,
   cut back to the CRM Inbox, and show it appearing there in near-real-time (proves the webhook
   round-trip, not just outbound sending).

### Video 2 — "your app creating a message template"

1. Open **Settings → WhatsApp Templates** (the screen built in §5 E8 of the connection plan).
2. Click **New Template**. Fill in a realistic one your agency would actually use — e.g. name
   `departure_reminder`, category **Utility**, body: `Hi {{1}}, your departure to Makkah on {{2}} is
   confirmed. Reply to this message if you have any questions.`
3. Submit it — show the "Submitted to Meta for approval" confirmation in the CRM.
4. Cut to **Meta's WhatsApp Manager** (business.facebook.com → WhatsApp Manager → Message Templates)
   and show the same template listed there with status `PENDING` (or `APPROVED`, if it processed
   before you finished recording) — this is the part reviewers specifically look for: proof the
   template actually reached Meta's system, not just a local form.

---

## 3. Notes for the review itself

- Submit both permissions **together**, in one request — they're used together in the same flow and
  reviewing them separately just adds a round trip.
- If rejected, the two most common reasons per Meta's own stated rejection patterns are (a) the video
  shows tooling instead of the product, and (b) the privacy policy never mentions WhatsApp data by
  name — both are already addressed by using the CRM's own UI in the recordings and by the wording in
  `/legal/privacy` above. If rejected anyway, read the specific reason Meta gives (usually a written
  note attached to the rejected request) before resubmitting; don't just retry unchanged.
- Once approved: complete **Tech Provider enrolment** (App Dashboard → look for the Tech Provider
  program invitation/section, requires 2FA on the Business Portfolio) and **Access Verification** to
  raise the ~10/week onboarding cap to ~200/week — see §4 M4 of the connection plan. Then flip
  `WHATSAPP_CONNECT_MODE=embedded` or `both` (already done) and the one-click flow works for any
  agency, not just accounts you've manually added as testers.
