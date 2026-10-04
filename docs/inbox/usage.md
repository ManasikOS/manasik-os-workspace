# Manasik Inbox + Copilot — Usage Guide

This guide explains how staff use the complete Inbox, how administrators configure it, and which real-world scenarios must be validated before enabling autonomy. The Inbox is a shared, agency-scoped workspace: channel delivery, risk rules, permissions and human review remain deterministic even when Copilot is unavailable.

## 1. Before first use

An administrator should complete these items before inviting staff to use the Inbox:

1. Connect the required WhatsApp, Messenger and Instagram channels and confirm each connection reports healthy.
2. Synchronise approved WhatsApp templates. Staff cannot initiate or resume an out-of-window WhatsApp conversation with free-form text.
3. In **Management → AI agent**, keep `INBOX_REPLY` and `INBOX_INTAKE` in `SHADOW`/L0 while Phases 2–4 collect evidence. Do not promote an agency that has not completed at least one week of shadow observation.
4. Publish current knowledge, package inclusions, prices and departure availability. Copilot only uses facts present in the reply pack and refuses stale or blocked facts.
5. In **Management → Settings → Data**, review the Inbox retention windows. These bounds are identical on every subscription plan.
6. Confirm team roles, routing rules, SLA targets and the `approveInboxAnswer` capability. It defaults to ADMIN and CEO but may be granted through role permissions.
7. Confirm the agency subscription and allowances. Existing agencies begin grandfathered so deployment does not unexpectedly reduce service.

## 2. Open and navigate the Inbox

Select the Inbox icon in the application header. The workspace opens as a dialog with three working areas:

- **Conversation list:** choose All, Mine or a business queue. Queue counts and priority come from deterministic projections.
- **Conversation:** read the canonical message history, attachments, internal notes and delivery state; compose replies at the bottom.
- **Context and intelligence rail:** review the contact/lead, travel intent, matched offer, risk interventions, next action, identity suggestions and workflow actions.

Dashboard Inbox metrics open the same workspace already filtered to the underlying queue. A metric is an entry point to its records, not an unexplained model-generated total.

## 3. Handle a normal enquiry

1. Open the conversation and check its channel-policy banner before typing.
2. Review travel dates, departure city, room arrangement, passport readiness and the matched departure offer in the intelligence rail.
3. Assign yourself or the appropriate owner if routing has not already done so.
4. Use **Draft reply** to place a grounded, editable suggestion inside the composer. Verify the cited inclusions, availability timestamp and price snapshot.
5. Edit as needed. A substantial correction is recorded as rejection evidence and can retire an unsafe cached answer.
6. Add an approved brochure link or create a guarded quote draft where appropriate.
7. Send. The server rechecks channel policy, entitlement, ownership, interventions, stale facts and the autonomy gate immediately before provider contact.
8. Add an internal note or mention a colleague when coordination is needed. Internal notes are never sent to the customer.

Copilot cannot confirm inventory, payment, visa outcomes, refunds, medical guidance or religious rulings. Those topics always remain human-reviewed.

## 4. Start or resume a conversation

For a new WhatsApp chat, use **New chat**, select the contact and choose an approved template. Complete every template variable and review the category, country and latest observed projected charge before sending.

Channel rules are enforced as follows:

- **WhatsApp inside the customer-service window:** eligible free-form staff replies are allowed.
- **WhatsApp outside the window:** use an approved template; free-form delivery is refused.
- **Messenger/Instagram inside 24 hours:** eligible staff replies are allowed.
- **Messenger/Instagram after 24 hours but inside the HUMAN_AGENT period:** only a human-authored active-support reply with an open support case may use the tag. Automation can never use it.
- **After the HUMAN_AGENT period:** delivery is refused and the UI recommends a valid re-engagement path.

The banner is advisory for the operator; the final server-side policy check is authoritative.

## 5. Work with media

Media processing runs in the BULK lane and never delays receipt of the original message.

- **Voice note:** play the retained original, then review the non-authoritative transcript and summary. Uncertain transcription must be confirmed with the customer.
- **Passport:** compare candidate fields with the pilgrim record. Expiry, mismatch or low confidence opens a review; extracted values are never silently applied.
- **Payment receipt:** treat it only as payment proof. It opens a Finance-owned `PAYMENT_CLAIM` intervention and never creates, allocates or confirms a payment.
- **Brochure or other file:** view the original and classify it only when the evidence is sufficient.

Inbox originals are private and accessed with short-lived signed links. For a passport or payment proof that must remain with the traveller record, choose **Save to Documents**. The action copies it into an existing single-traveller document requirement and exempts the Inbox copy from short attachment expiry. Multi-traveller bookings must be handled in Documents so staff explicitly choose the traveller.

## 6. Resolve reviews and protection gates

An intervention is a compact demand for human review. Read its evidence and guidance, perform the required action, then resolve or dismiss it with a meaningful note. Examples include an unverified payment claim, stale price, full group, passport expiry, complaint, distressed customer, fraud concern and sensitive document.

While a blocking intervention is open, Copilot withholds unsafe drafts and automated delivery is refused. A receipt alone must never be interpreted as settled payment. A matched offer alone must never be interpreted as held inventory.

## 7. Identity, commercial and workflow actions

When the same person contacts the agency through another channel, the rail may propose an identity link. Review the evidence and accept or reject it; do not merge contacts solely because names are similar.

As the conversation progresses, staff can create guarded workflow records from the Inbox, including a lead/follow-up, quote, booking-related proposal, support case, document request or other supported conversion. Every conversion remains a deliberate staff action and uses the normal module validations.

After a booking is confirmed, use the handoff action to send Operations a point-in-time summary containing facts, open items, customer expectations and sentiment. Operations acknowledges that artifact; later edits do not rewrite what was originally handed over.

## 8. Approved answer cache

Repeated, stable FAQ answers may become candidates after the third consistent occurrence. An authorised reviewer approves or rejects candidates in **Management → AI agent → Knowledge → Approved answers**.

Only approved, unexpired answers with the current agency knowledge version and sufficient similarity can be served. Price, availability, visa, payment, refund, medical, religious and traveller-specific answers are never cacheable. Knowledge/package/pricing changes invalidate older answers. Two substantial corrections retire an approved answer with a recorded reason.

## 9. Autonomy levels

Configure Inbox autonomy in **Management → AI agent**:

- **L0 — Shadow:** observe and measure; nothing is proposed or sent to the customer.
- **L1 — Assist:** staff receive proposals and remain responsible for every send.
- **L2 — Safe replies:** only approved safe answers/templates may be sent within the measured scope; blockers prevent promotion.
- **L3 — Bounded intake:** the system may collect dates, departure city, room arrangement and passport readiness, create/update a provisional lead, then hand over.

The effective level is the lowest of the plan ceiling, surface setting and current conversation safety state. Promotion requires the measured evidence shown in the UI; demotion is automatic when safety degrades. Every level change is audited. Price negotiation, booking confirmation, payment, refunds, visa outcomes, medical/religious guidance and every deny-list topic always hand over to a person.

## 10. Owner view, plans and graceful degradation

The dashboard owner panel shows queue-backed operational metrics and estimated pipeline value bucketed by currency. It never converts or combines currencies. Select any number to inspect its exact queue.

Usage is metered once per conversation per billing period. As an allowance is consumed, expensive AI stages degrade before deterministic safety rules. Human replies remain available even above 200% usage, and rule-based risk detection never stops. A plan downgrade can only clamp an autonomy level downward and records the reason.

## 11. Retention and deletion

The nightly retention sweep handles booking-linked messages, enquiries, Inbox attachments, voice audio, intelligence, AI runs and webhook payloads in bounded batches. A dry run counts candidates without mutation; a live run deletes Storage objects before database rows and records its cursor, counts and errors.

Promoted Documents follow the Documents module policy. Meta deauthorisation revokes the connection; a signed Meta deletion callback uses the shared deletion path for connection-owned conversations. Subscription tier never changes retention.

## 12. Operating scenarios

| Scenario | Staff action | Expected result |
|---|---|---|
| New WhatsApp enquiry | Open the inbound chat, review intent/offer, draft and send | Grounded editable draft; valid free-form send inside the window |
| New outbound WhatsApp chat | Choose contact and approved template; fill variables | Preview, category/rate and variables shown; template sent, free-form unavailable |
| Customer returns outside the window | Open the policy banner and template picker | Free-form refused; valid re-engagement template offered |
| Messenger support on day 3 | Keep an active human-owned support case and reply manually | `HUMAN_AGENT` eligible only for that human reply; automation refused |
| Payment receipt | Open the receipt card and route the review to Finance | Proof retained; `PAYMENT_CLAIM` intervention created; no payment mutation |
| Passport image | Review candidate fields and expiry; save to Documents if required | Mismatch/expiry/uncertainty highlighted; no silent pilgrim update |
| Voice note | Play original and compare it with transcript/summary | Original remains playable; transcript clearly non-authoritative |
| Same customer on two channels | Review the identity proposal | Explicit accept/reject; no automatic merge from weak evidence |
| Quote-ready enquiry | Confirm live offer and use Create quote | Guarded quote draft; no inventory or booking confirmation |
| Complaint or distress | Acknowledge the intervention and assign a person | Automated send blocked; human escalation remains visible and auditable |
| Overnight L3 intake | Let the flow collect four approved facts | Provisional lead and handover summary; price/booking question stops automation |
| Allowance exhausted | Continue handling the conversation as staff | AI degrades by rung; human send and deterministic risk rules still work |
| Attachment nearing expiry | Promote a required original to Documents | Copy follows Documents retention; Inbox attachment is marked promoted |

## 13. Manual acceptance tests before rollout

Run these with test contacts and non-production payment/document data:

1. Complete a WhatsApp inbound reply inside the 24-hour window and confirm provider delivery plus the stored delivery state.
2. Attempt WhatsApp free-form delivery one second beyond the boundary; confirm refusal, then send an approved template with variables and compare the displayed projected charge with the provider bill/rate source.
3. Test Messenger or Instagram at 24 hours, during the HUMAN_AGENT period and just after seven days. Confirm only a human-authored active-support reply can carry the tag.
4. Send a voice note, passport image and receipt through the real provider. Confirm the original remains playable/viewable, low-confidence fields are marked, and the receipt creates no payment.
5. Ask the same eligible FAQ twice after approving its candidate. Confirm the second response is a cache hit and no second model call is recorded; then make two substantial corrections and confirm retirement.
6. Use two signed-in browsers on one conversation. Confirm presence/collision warnings and that edits do not silently overwrite each other.
7. Use two agencies with identical contacts/questions. Confirm neither conversation, answer-cache entry, media object, KPI nor queue row is visible across tenants.
8. Exercise L0, L1 and an evidence-eligible L2 setting. Confirm observable behaviour changes, a complete audit row and immediate one-step demotion when a blocker is introduced.
9. Run the multilingual L3 flow in English, Sinhala and Tamil. Ask a price question mid-flow and confirm immediate human handover, a provisional lead and no booking/payment write.
10. Compare every owner metric with its drill-through queue and reconcile a two-currency fixture without an FX-converted total.
11. Put a test agency at 100%, 125%, 150% and 200% allowance usage. Confirm the documented degradation rung, visible reason, uninterrupted human send and continuous rule-risk detection.
12. Run retention in dry-run mode, record counts, then run the live sweep on the same controlled fixture. Reconcile counts, confirm Storage-before-row deletion and verify promoted Documents survive.
13. Run the 50-agency × 200-conversation harness only in staging. Record p50/p95/p99, S0 skip rate, cost per enriched conversation and cross-agency fairness in a progress snapshot.
14. Observe one week of live channel traffic and confirm there are no delivery failures attributable to window or tag selection before declaring MI5.3 complete.

Do not mark a slice exit complete from unit tests alone. Provider delivery, browser concurrency, live storage, measured autonomy evidence, scale SLOs and dry-run/live retention reconciliation require the manual checks above.
