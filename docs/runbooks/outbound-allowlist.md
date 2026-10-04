# Outbound allow-list and environment banner

Two guards that keep a non-production deployment from being mistaken for production, or from messaging a real customer (TASK-032 S9).

## The allow-list

**What it does.** Outside production, the app sends only to the contacts named in `INBOX_OUTBOUND_ALLOWLIST`. Staging is connected to real
WhatsApp, Messenger, Instagram and mail accounts, so without this a test that "sends a reply" can message a real person.

**The rules**

| Environment (`SENTRY_ENVIRONMENT`) | Behaviour |
|---|---|
| `production` | No restriction. The variable is ignored. Setting it in production is reported as a problem by the go-live gate (G6). |
| anything else (`staging`, a preview, local development, or unset) | Sends only to the listed contacts. **Empty or unset means nobody.** `*` means everyone. |

**Setting it.** One value, separated by commas, semicolons or new lines:

```
INBOX_OUTBOUND_ALLOWLIST=+94 77 123 4567, tester@example.com
```

- Phone numbers are compared by digits only, so `+94 77 123 4567` and `94771234567` are the same number. A number that differs in any digit, including a different country prefix or a leading 0, is a different number, so write the number the way the customer's channel reports it (WhatsApp uses the full international form without the plus).
- E-mail addresses ignore case. Any other id (a Messenger or Instagram scoped id) is compared as written, ignoring case.
- `*` is the explicit opt-out for a deployment that has no real customers. Do not use it where real connections are live unless you mean it.
- The value contains phone numbers: keep it in the host's environment settings, never in git, a log or a chat. The configuration endpoint reports it
  only as a short fingerprint.

**Where it is enforced.** Everywhere the app contacts a customer: the Inbox outbox and the AI replies (through the send authorization), approved
template sends (staff start-chat and the follow-up sweep), announcements (a recipient who is not approved is marked failed, with the reason), the
unsupported-file notices (silently skipped), and the WhatsApp setup test message. A scan test fails if a new send path appears without it.

**What staff see.** A refused Inbox send shows the reason ("This is not the production environment and it only sends to approved test contacts; this
recipient is not one of them.") and the message is marked failed. The reason never names the recipient or the list.

**What it does not apply to.** A disposable test agency (`agencies.is_test`): its sends are answered by the in-memory simulator and never leave
the process, so they need no approval. See `provider-simulator.md`.

**After deploying this change.** Staging sends nothing until `INBOX_OUTBOUND_ALLOWLIST` is set (that is the point). Set it to your own test
number first, redeploy, and check one reply goes through. Refused sends are dead-lettered like any permanent refusal, so on staging they can show up in the
health alerts; that is expected while the list is being set up.

## The environment banner

Every page of a non-production deployment shows a small label fixed to the top edge, "Staging environment: test data only" (or the name the
environment gives itself). It takes no room in the layout and ignores the pointer. It is driven by the same `SENTRY_ENVIRONMENT` as everything else,
so it needs no setting of its own: production and an unset value (local development) show nothing.
