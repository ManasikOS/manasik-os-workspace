# Email Trust Guardian — Implementation Plan

Status: **Draft — planning only; no implementation checklist boxes are ticked.**

## Outcome

Let a non-technical agency connect its own SMTP + IMAP mailbox, understand
whether it is safe to send from, and use Email in the Inbox with guardrails
that reduce avoidable spam and bounce problems. This is an **agency-owned,
person-to-person Inbox email** feature, not a bulk-marketing product.

The product must be candid about its evidence:

| Signal | What it proves | What it must not claim |
|---|---|---|
| SMTP connection test | The provider accepted an authenticated submission. | That the recipient received it or that it reached Inbox. |
| IMAP connection test | The configured mailbox can be read. | That outbound email is deliverable. |
| SPF/DKIM/DMARC DNS check | The checked public DNS records are syntactically/policy-valid at that time. | That all providers will trust the sender. |
| Inbound delivery/bounce event | A recipient provider reported the observed event. | A universal sender-reputation score. |

The assistant may explain a failed check and draft customer-facing copy. Every
setup status, send decision, rate limit, DNS verdict, and suppression decision
is deterministic. This follows the Inbox architecture's deterministic-core
rule and does not change any of R1–R7 or claim to close G1–G15.

## Scope and boundaries

### Included

- Provider presets for Hostinger, Google Workspace, Microsoft 365, and a
  generic SMTP + IMAP provider; presets only fill public connection defaults.
- A guided setup flow that validates fields, securely saves credentials, tests
  SMTP and IMAP independently, and verifies the chosen sender identity.
- Public DNS checks for the sender domain's SPF, DKIM selector(s), and DMARC,
  with plain-language remediation and copyable DNS records where the provider
  profile knows the required selector.
- Deterministic Email Inbox send preflight, bounded sending-rate protection,
  permanent-bounce suppression, and clearly classified delivery events.
- IMAP processing of delivery-status notifications without turning mailer
  daemons into customer conversations.
- Per-agency health history and a settings/dashboard view of configuration,
  sends, failures, bounces, and actionable risk.

### Explicitly excluded

- Bulk campaigns, subscriber lists, unsubscribe management, promotional
  consent, tracking pixels, or artificial "warm-up"/engagement simulation.
- Writing DNS records, logging into a provider account, or changing a
  provider's reputation on the agency's behalf.
- Promising Inbox placement, circumventing spam filters, or exposing a fake
  universal reputation score.
- Autonomous Email sends. Copilot may draft or explain; a staff member always
  approves the send.

## Existing-code baseline and prerequisites

The current Email channel plan already owns generic SMTP/IMAP, the `GMAIL`
provider code, the channel connection bridge, outbound adapter, IMAP poller,
and the Email Inbox composer. Trust Guardian extends those seams; it must not
create a second connection model.

Before the first Trust Guardian PR:

1. Complete and verify the remaining Email channel slices EM3–EM5 in
   [`email-channel-implementation-plan.md`](./email-channel-implementation-plan.md), including
   actual subject/Cc/Bcc dispatch, email search/folder/read state, entitlements,
   and the existing end-to-end golden path.
2. Apply the current Email channel migrations and run exactly one durable
   outbox worker version. A stale worker produces adapter errors even when the
   source registry is correct.
3. Preserve the existing credential boundary: passwords remain only in Vault;
   UI/read models never return `password_ref`, raw credentials, SMTP transcripts,
   or raw DNS-provider error responses.

## Design decisions

1. **One agency, one active Email delivery profile initially.** It maps to the
   existing one-per-agency `GMAIL` connection and `agency_smtp_settings` row.
   Multiple sender domains are a later, separately designed extension.
2. **A sender is safe by evidence, not by provider name.** A preset is a
   convenience only. The profile becomes send-ready only after the connection,
   identity, and required Inbox mailbox checks pass.
3. **Exact identity is the safe default.** `from_email` initially must equal
   the authenticated SMTP username. A different same-domain alias can be used
   only after an explicit sender-identity verification flow succeeds. A
   cross-domain From address is blocked in v1.
4. **DNS is a graded warning, not a hidden guess.** Missing/misaligned SPF,
   DKIM, or DMARC is shown plainly. The product blocks only conditions that
   make a send technically unsafe; it warns and requires an explicit staff
   acknowledgement for reputation-risk conditions during the initial rollout.
   The exact block/warn policy is a tested policy table, not UI-only logic.
5. **No silent rate-limit bypass.** The system reserves quota atomically when
   a message is queued, so two browser tabs or workers cannot evade a rolling
   limit. Platform anti-abuse caps cannot be overridden; an agency can tune
   only bounded, lower-risk policy settings where entitlement permits it.
6. **Only permanent recipient failures suppress.** SMTP 5xx/DSN permanent
   bounces create a hashed, agency-scoped suppression. Transient 4xx failures,
   out-of-office replies, and unclear reports do not suppress a recipient.
7. **Health is operational, not cosmetic.** It reports observable counts and
   the last checks. It never labels a domain "reputable" based on one test.

## Data, privacy, and access design

The Trust Guardian migration is additive and includes RLS, indexes, grants,
and tests in the same slice. It must follow the current imperative migration
workflow and avoid new `SECURITY DEFINER` functions unless an atomic worker
operation cannot be implemented safely another way. Any unavoidable function
uses an empty search path, minimal grants, a caller/agency guard, and a
security review.

| Record | Purpose | Key privacy/security rule |
|---|---|---|
| `agency_email_delivery_profiles` | One agency's provider hint, sender domain/identity state, check timestamps, safe status codes and policy version. | No password, secret reference, raw SMTP response, or customer data. Agency-scoped RLS. |
| `agency_email_domain_check_runs` | Timestamped SPF/DKIM/DMARC observations and normalized remediation codes. | DNS values only; cache and retain bounded history. |
| `email_dispatch_reservations` or an equivalent atomic bucket projection | Enforce rolling per-agency send limits across concurrent requests/workers. | Reservation belongs to one outbox message; idempotent release/settlement is required. |
| `email_recipient_suppressions` | Permanent-bounce and manual-suppression state. | Store an HMAC of normalized address, not a duplicate plaintext address; agency-scoped RLS and audited restore. |
| Existing `message_delivery_events` | Add a precise bounce/temporary-failure classification or compatible typed detail. | Keep the message/agency FK and provider-event dedupe; never store raw DSN bodies. |

Existing `agency_smtp_settings` remains the credential/configuration source and
`channel_connections` remains the Email connection. Health metadata is not
placed into `provider_metadata` if that would broaden credential-adjacent reads;
use a safe projection/repository for staff UI instead.

All server actions and routes begin with `requireUser()`, check the existing
settings integration capability for setup/health mutations and Inbox send
capability for sends, validate inputs with Zod, and scope every read/write to
the caller's agency. Workers use the service role only for queued, agency-bound
work. A two-agency isolation test is mandatory for each new repository path.

## Delivery architecture

```text
Settings wizard
  -> preset + Zod validation
  -> Vault-backed SMTP/IMAP configuration
  -> deterministic connection and sender tests
  -> public DNS checker + cached health profile

Inbox compose/send
  -> deterministic email dispatch policy
  -> atomic quota reservation + suppression check
  -> existing outbox
  -> SMTP adapter
  -> message_delivery_events + health projection

IMAP poll
  -> DSN/bounce classifier first
  -> event + suppression/health update
  -> otherwise existing canonical inbound-message ingestion
```

The DNS resolver accepts only the normalized sender domain selected from the
stored delivery profile, has short timeouts and bounded caching, and never
becomes an arbitrary network-proxy API. For generic providers, the wizard asks
for the DKIM selector because DNS does not provide a reliable directory of all
selectors. Provider profiles supply known selectors where documented.

## Ordered implementation slices

Each slice is a separate PR, remains behind the existing Email entitlement,
and updates the Inbox checklist only with evidence from that PR.

### TG0 — Baseline proof and contract

**Depends on:** EM3–EM5 completion.

- Record the final Email channel assumptions and add a narrow
  `email-delivery-profile` validation contract/types module.
- Define provider-profile data as code (no credentials): label, SMTP/IMAP
  defaults, supported TLS modes, and known DKIM selector guidance.
- Define stable safe diagnostic codes and the send-policy input/output types.

**Likely files:** `lib/validations/agency-email-settings.ts`, new
`lib/inbox/email-trust/*`, Email settings components, focused Vitest files.

**Exit evidence:** generic configuration remains valid; every provider preset
is validated; unsupported port/security combinations and cross-domain sender
attempts fail before persistence.

### TG1 — Guided configuration and connection verification

**Depends on:** TG0.

- Add provider selection and prefill to the existing Email settings surface;
  users can always edit the resulting values or choose Generic.
- Add an explicit "Run checks" action: SMTP `verify`, IMAP authenticate/open
  INBOX, and a consented test submission. Record safe outcome codes and times
  in the delivery profile.
- Keep the present send-test action as a compatibility path until the new flow
  has browser proof; do not expose transport errors or secrets.

**Likely files:** Email settings actions/components, new connection-check
service/repository, migration, Zod schema, tests.

**Exit evidence:** Hostinger-style TLS/465 + IMAP/993 and a generic STARTTLS
configuration produce independently visible SMTP and IMAP outcomes; an invalid
password transitions to a recoverable configuration error without deleting the
last saved secret.

### TG2 — Sender identity verification

**Depends on:** TG1.

- Make SMTP username = From address the default verified identity.
- For a same-domain alias, use a time-bound, single-use verification token sent
  through the configured SMTP account and observed through the configured IMAP
  mailbox; persist only its outcome and expiry.
- Block cross-domain aliases in v1 and explain that such a configuration breaks
  alignment expectations.

**Likely files:** new sender-identity service/actions, delivery-profile
migration fields, Email settings UI, tests.

**Exit evidence:** the screenshot scenario (authenticated `support@…`, From
`no-reply@…`) is clearly marked unverified until the alias proof completes;
the verification token cannot be replayed or read by another agency.

### TG3 — Domain-authentication inspector

**Depends on:** TG0 and TG2.

- Resolve and assess SPF, DKIM, and DMARC for the stored sender domain; report
  missing, malformed, multiple-SPF, and alignment-risk states separately.
- Store a bounded check history and cache result; offer “recheck” rather than
  executing DNS work during every page load.
- Show provider-specific DNS instructions where known, otherwise concise
  generic instructions including the user-entered DKIM selector.

**Likely files:** domain-check repository/service, migration + RLS, settings
health card, safe DNS result schema, unit/integration tests.

**Exit evidence:** tests cover valid records, absent records, temporary lookup
failure, multiple SPF records, and selector mismatch. The UI says “DNS could
not be checked” rather than claiming failure when the resolver times out.

### TG4 — Central email dispatch policy and atomic quota

**Depends on:** TG1–TG3 and the completed EM3 send path.

- Introduce one deterministic `evaluateEmailDispatchPolicy` used both before
  enqueue and at worker dispatch. It checks connection state, verified sender,
  recipient format, suppression, and policy risk.
- Add atomic, idempotent quota reservation/settlement tied to outbox message
  IDs; establish conservative initial platform caps for new profiles and
  documented bounded agency policy settings.
- Hard-stop unsafe sends; require explicit staff acknowledgement for DNS/new
  sender warnings; write an auditable policy decision without message content.

**Likely files:** outbox enqueue/drain, dispatch-policy module, migration,
repository/RPC only if necessary, Inbox composer warning UI, tests.

**Exit evidence:** concurrent requests cannot exceed a cap; retrying an outbox
job does not consume quota twice; a permanent suppression blocks before SMTP;
the policy is enforced even if a caller bypasses the UI.

### TG5 — Bounce and delivery-status processing

**Depends on:** TG4 and the existing IMAP poller.

- Classify DSN and provider mailer notifications before canonical customer
  ingestion. Match original message identifiers where possible.
- Persist `SENT`, temporary failure, permanent bounce, and unknown states in
  the existing delivery-event model; create suppression only for confirmed
  permanent recipient bounces.
- Keep mailer bodies out of AI and do not create a Mailer-Daemon lead or
  conversation. Provide a staff restore action with audit data.

**Likely files:** `lib/channels/email/imap-poll.ts`, new DSN parser and
suppression repository, delivery-event migration, settings/inbox status UI,
tests.

**Exit evidence:** fixture-based tests prove RFC DSN 5xx suppresses once,
4xx does not, auto-reply does not, duplicate notices are idempotent, and an
ordinary inbound email still follows the current ingestion path unchanged.

### TG6 — Health workspace and supportable diagnostics

**Depends on:** TG1, TG3–TG5.

- Build a safe per-agency read model with current readiness, last checks,
  DNS state, recent sends/failures/bounces, quota state, and clear next action.
- Display it in Settings and as compact Email-compose status; use the existing
  design tokens and shadcn input pattern.
- Add a short operational runbook for admins: interpreting headers, rerunning
  checks, responding to a bounce spike, and when to contact the mail host.

**Likely files:** health repository/actions, Email settings and Inbox compose
components, `docs/runbooks/email-deliverability-verification.md`, tests.

**Exit evidence:** a user can distinguish “not configured,” “connection
failed,” “sender needs verification,” “DNS needs attention,” “temporarily
limited,” and “ready with warnings” without reading raw technical logs.

### TG7 — Rollout, observability, and production proof

**Depends on:** TG0–TG6.

- Add structured, redacted operational events for check completion, policy
  block/warn, SMTP failure class, DNS lookup failure, bounce class, suppression,
  and quota exhaustion. No credentials, addresses, subjects, or bodies appear
  in logs.
- Roll out behind the existing Email entitlement to an internal test agency,
  then a small opt-in cohort. Establish rollback behavior: fail closed for hard
  safety checks; preserve normal Inbox reads when health aggregation is down.
- Complete real-mailbox verification with Hostinger and one non-Hostinger
  provider, including header inspection and an intentional invalid-recipient
  bounce fixture where permitted.

**Exit evidence:** lint, typecheck, and tests are green; browser golden/error/
permission states are recorded; the Inbox checklist and TASK status reflect
only measured outcomes.

## Test matrix and completion criteria

| Area | Automated proof | Manual proof |
|---|---|---|
| Tenant security | Two-agency repository/action/RLS tests; no cross-agency profile, run, reservation, event, or suppression access. | Admin and non-admin UI access checks. |
| Setup | Zod/provider-preset/credential-preservation tests; SMTP/IMAP failure mapping. | Connect a test mailbox with each supported profile. |
| Sender and DNS | Alias-token expiry/replay tests; deterministic SPF/DKIM/DMARC fixtures. | Verify publicly propa111gated DNS and inspect one received header. |
| Dispatch | Policy branch, quota race, idempotency, retry, suppression, and worker-enforcement tests. | Attempt a warned send, a blocked send, and a normal staff reply. |
| Bounce handling | DSN/temporary/auto-reply/duplicate fixtures. | Controlled invalid-recipient test where provider policy permits. |
| UI | Component/action state tests. | Settings and Inbox golden, empty, error, and permission-denied states. |

No slice is complete until `npm run lint`, `npm run typecheck`, and
`npm run test` pass, the relevant browser proof is recorded, and its exact
Inbox checklist boxes are updated in the same PR.

## Risks and mitigations

- **Shared-host reputation:** a Hostinger shared IP may affect an agency even
  with perfect DNS. Show the observable evidence and escalation path; do not
  misrepresent this as an application bug.
- **DNS propagation:** cache results but show their timestamp and recheck path;
  never fail a user merely because DNS is temporarily unavailable.
- **False DSN detection:** classify conservatively and suppress only an RFC
  permanent failure tied to a recipient/message; retain a staff restore path.
- **Rate-limit disruption:** start with measurable, conservative policy values
  and a clear temporary-limit state; use staged rollout before making warnings
  into broader hard blocks.
- **Credential leakage:** use Vault only, redact all diagnostics, and include
  tests that server UI payloads cannot contain secret references or passwords.

