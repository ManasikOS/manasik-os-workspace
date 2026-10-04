# Inbox admin and manager guide

For Admins, the CEO and team leads. Setup is in the [Inbox usage guide](../usages/inbox/usage-guide.md) §3 and §17; this page
covers what is new for measuring and controlling the Inbox.

## Reading the Outcomes panel

Open **Outcomes** in the Inbox rail. What you see depends on your role, and it is decided on the server.

| You are | You see |
| --- | --- |
| Admin or CEO | Everything, including AI cost and quality |
| Finance | Daily work, sales and safety figures, plus payment-review figures; no AI cost |
| Marketing, Operations, Visa | Daily work, sales and safety figures; no payment-review or AI figures |
| Guide | Nothing (no Inbox access) |

Each card shows its basis (**Right now** or **Last 30 days**) and one of these states:

| State | Meaning |
| --- | --- |
| A number | Computed from your agency's stored rows. Zero is a real zero. |
| **No data yet** | Nothing to measure in the period. Not zero. |
| **Not measurable yet** | The system does not store the fact needed. The card says why. |
| **Could not be read** | A source failed to load just now. Try again. It is not zero. |

**Open these conversations** opens exactly the queue the count was made from, so you can check it.

### What is not measurable yet

First-response time, within-target rate, the three sales conversion rates, draft acceptance and triage corrections are
**not measurable**: the data they need is not stored. Never-autonomous violations and autonomy demotions wait on the
autonomy-policy slice (AUT-05). Do not estimate these by hand and report them as system figures.

### Known gaps

- **AI cost excludes media and voice runs.** The daily cost view only sums surfaces named in capitals, so image/media
  analysis and voice transcription spend is missing from the per-conversation cost. Treat it as a floor.
- Open blocking reviews and payment-review times show a number but have no list to open yet.
- A figure marked partial covers only part of the period because there was too much to read at once.

## Controls worth knowing

- **Bulk spam** needs permission to close conversations. It is reversible, fail-closed, and audited (one event per chat).
  See [spam-state-contract.md](spam-state-contract.md).
- **Voice transcripts** are off until an AI surface setting for `inbox_voice_transcript` is switched on for your agency.
  Staff-only, never sent to customers, and deleted with their source voice note.
- **Documents:** passports and receipts are blocked from the shared vault by design.
- **Autonomy:** leave Observe only or Draft replies until the release evidence below is reviewed.

## Recovery

| Situation | Action |
| --- | --- |
| Wrongly marked spam | Restore from the Spam queue. Nothing else was changed. |
| Voice transcripts misbehaving | Switch the `inbox_voice_transcript` surface off. Voice notes still play; staff lose the transcript only. |
| A number looks wrong | Open its conversations and count them. If they differ, record it as a defect with the card name and time. |
| Cross-agency data, a duplicate send, or a misleading payment confirmation | Stop and follow the rollback in the [launch-readiness acceptance runbook](../runbooks/inbox-launch-readiness-acceptance.md). |

## Before raising autonomy

Do not raise autonomy on the strength of this guide. Use the [release evidence record](release-evidence-assisted-operation.md):
a week of reconciled figures, reviewed risk samples, stable channel delivery, a rollback drill, and zero never-autonomous
violations. Approve assisted operation and any bounded-autonomy pilot **separately**.
