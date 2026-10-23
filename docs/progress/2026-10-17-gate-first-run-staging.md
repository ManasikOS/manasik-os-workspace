# First gate run against staging — 17 October 2026

Target `https://manasik-os-staging.vercel.app/` (Vercel project `manasik-os-staging`), database Manasik OS (`klognjpwmqwlgeibvanf`). Run by the owner with `npm run verify:production`; no secret is recorded here.

**Result: FAIL — 3 passed, 6 pending, 6 failed.** Every HTTP failure has one cause.

## The blocker: Vercel has disabled the deployments (HTTP 402)
Every request to the staging app answers `402 Payment Required` with header `X-Vercel-Error: DEPLOYMENT_DISABLED`. Checked directly on 17 Oct 17:23 UTC:
`manasik-os-staging.vercel.app`, `workspace.manasikos.com` (the production custom domain) and `manasik-os-workspace.vercel.app` all return it, so it applies to the whole Vercel team (`ManasikOS`), not one project. Builds exist and are READY (latest staging build is commit `2dd1b647`, 13 Oct), so this is not a failed deploy.
Consequence beyond the gate: the 13 scheduled jobs that call the web app have been failing for days (`inbox-lanes` has 10,077 consecutive failed calls, roughly seven days of one-minute runs), so on staging nothing has polled email, run SLA or reply-window sweeps, or drained agent jobs in that time. Production, if launched now, would be down.
**Cause found by the owner (Vercel dashboard, 17 Oct):** the team `ManasikOS` is on the **Hobby** plan and was paused on 17 Oct 2026 for exceeding **Fluid Active CPU** (4h 20m used of the 4h limit). The pause ends on 16 Nov 2026 unless the team upgrades to Pro. Every other meter is far below its limit (function invocations 309K of 1M, CDN requests 193K of 1M, storage 1.8 GB of 10 GB, data transfer 0.8 GB of 100 GB), so the CPU is the only problem. The one-minute database-scheduled calls into the app (`inbox-lanes`, `whatsapp-agent-jobs-drain`, email poll, SLA and others) are the likely main consumer. Hobby is also for non-commercial use only.
Only the account owner can fix it (Vercel dashboard, team ManasikOS, Settings, Billing: unpaid invoice, spend limit, or a plan limit).

## Checks
| Check | Result | Reading |
|---|---|---|
| G1 | FAIL | 402 on both health endpoints. "expected C" means `GATE_EXPECTED_COMMIT` holds the single letter `C`; set it to a real commit or leave it empty |
| G2 | **PASS** | all 256 migrations applied, nothing else |
| G3 | **PASS** | tenant isolation audit finds nothing |
| G4 | FAIL | 13 jobs failing because the web app answers 402 |
| G5 | **PASS** | 7 buckets, all private |
| G6 | FAIL | `/api/health/config` answered 402 |
| G7 | PENDING | no worker URL |
| G8 | FAIL | all three channels: 402 instead of 401/403/200 |
| G9 | FAIL | all 6 problems are the 402 (signed, duplicate and forged posts, and the three counts of 0). **The database half worked:** the test agency was created and removed, no "could not remove" or "still holds rows" problem was reported, and afterwards Manasik OS has 4 agencies, 0 `e2e-gate-%`, 0 `sim-gate-%` integrations |
| G10–G12, G14 | PENDING | not built yet |
| G13 | PENDING | no Vercel token supplied |
| G15 | FAIL | 94 differ, 0 missing, 32 not in the repository, of 1,421 objects (the first run on 3 Oct was 99 and 32); the two new G9 functions and `enqueue_record_text_message` match the baseline |

## Next
1. [Y] Clear the Vercel billing block; confirm `curl -i https://manasik-os-staging.vercel.app/api/health` answers 200.
2. [Y] Fix `GATE_EXPECTED_COMMIT` (a real commit sha, or empty).
3. Re-run the gate. Expected: G1, G4, G6, G8, G9 move to PASS or PENDING (G8 handshake stays PENDING without verify tokens); G15 stays FAIL until the drift migrations (checklist B5 to B8).
4. Afterwards confirm the scheduled jobs recover (G4) and look for backlog: unread email since the outage, SLA breaches that were not swept.
