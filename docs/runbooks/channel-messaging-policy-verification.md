# Channel messaging policy verification

Run this procedure quarterly and before changing a Meta Graph API version. Record the date, reviewer, Graph version, test account, exact request, response code and provider message id.

## Contract to verify

1. WhatsApp accepts free-form replies only while the 24-hour service window is open. Outside it, send an approved Marketing, Utility or Authentication template and confirm the current country/category charge from the rate source used by `whatsapp_message_charges`.
2. Messenger and Instagram accept a free-form `RESPONSE` within 24 hours of the customer's last message.
3. Between 24 hours and seven days, verify that `messaging_type=MESSAGE_TAG` and `tag=HUMAN_AGENT` works only for a human-authored reply after the app has the required App Review feature and business verification.
4. Confirm the same request is rejected after seven days and that an automated test identity can never cause the application to apply the tag.
5. Confirm the composer shows the charge before a WhatsApp template send and that the recorded charge equals the dated rate row.

## Live matrix

Use one consented test customer per channel. Exercise: no inbound message, open 24-hour window, just beyond 24 hours, just before seven days, and beyond seven days. For the HUMAN_AGENT rows, repeat with no support case, a non-human actor, a non-`HUMAN_ACTIVE` conversation, and a genuine human support reply. Every negative case must produce no provider request.

## Change watch

Meta's documentation tree and message-tag availability change independently of this repository. Re-check the official Business Messaging documentation and App Dashboard feature list; do not rely only on remembered error codes. Also re-check WhatsApp pricing before 1 October 2026 because Meta has announced service-message charging changes that may make an in-window reply billable even though its send eligibility is unchanged.
