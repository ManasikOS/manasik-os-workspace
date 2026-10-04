# Release evidence: assisted operation (Checkpoint P6)

This is the record the [P6 checkpoint](spec-implementation-plan.md) is decided from. **Nothing below has been collected.**
Every row starts as not done. A row is only filled in with a link to protected evidence (never customer message text or
raw screenshots containing personal data) after it has really been observed. A skipped step is not a pass.

Approve **assisted operation** and a **bounded-autonomy pilot** separately.

## Evidence required

| # | Evidence | Where it comes from | Status | Link / note |
| --- | --- | --- | --- | --- |
| 1 | One full week of Outcomes figures reconciled to source rows (every count card opened and counted) | Outcomes panel, a named staging or live agency | Not collected | |
| 2 | Reviewed risk samples (payment, passport, complaint, bank-detail cases) with reviewer and outcome | Inbox risk reviews | Not collected | |
| 3 | Channel proof: inbound and outbound on each connected channel, delivery states stable for the week | [Launch-readiness acceptance](../runbooks/inbox-launch-readiness-acceptance.md), channel runbooks | Not collected | |
| 4 | Rollback drill: voice transcripts off, spam restore, and autonomy back to Observe only, each shown to work | Admin controls | Not collected | |
| 5 | Never-autonomous violations is zero | Needs AUT-05; not measurable today | **Blocked** | Waits on AUT-05 |
| 6 | Browser acceptance of: Outcomes drill-down, keyboard shortcuts, voice transcript panel, media routing, bulk spam | Staffed run against a signed-in non-production environment | Not collected | |
| 7 | Live checks still open from earlier slices: voice-transcript RLS test, real audio transcription call, live spam mark and restore | See checklist items under MED-01, MED-02, PRD-03 | Not collected | |

## Known measurement limits (state these when presenting the week)

- First-response time, within-target rate, sales conversion rates, draft acceptance and triage corrections are not
  measurable yet; the data is not stored.
- AI cost excludes image/media and voice-transcript runs.
- Open blocking reviews and payment-review times have no list to open.

## Decision

| Decision | Result | By | Date |
| --- | --- | --- | --- |
| Approve measured assisted operation | Pending | | |
| Approve bounded-autonomy pilot | Pending (blocked on AUT-05 and row 5) | | |
