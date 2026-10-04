# WhatsApp Knowledge Base — Implementation Plan (G1)

**Plan only. Nothing here is built yet; this document is the contract for building it.**

Item G1 of [whatsapp-go-live-plan.md](whatsapp-go-live-plan.md). It replaces §5.3 (schema), §12
(pipeline) and Phase 8 of [whatsapp-ai-agent-implementation-plan.md](whatsapp-ai-agent-implementation-plan.md),
which were written before several facts below were known. Where they disagree, this document wins.

## 1. What this is, and the line it must not cross

Today the assistant can answer from live CRM data (departures, seats, prices) and nothing else.
Preamble rule 5 in `lib/agent/whatsapp/prompt.ts` already tells it to "search the knowledge base if
you have it", but no such tool exists, so any question about cancellation terms, visa requirements or
what to pack ends in a hand-off. G1 gives it the agency's own written policies to answer from.

The split the whole plan enforces:

```text
CRM tools        →  prices, seats, dates, booking status.   Live. The only source of numbers.
Knowledge base   →  policies, procedures, FAQs.             Static text the agency wrote.
```

A knowledge-base document must never become a second, stale source of prices. That is the main
risk of this feature and §4 exists to close it.

## 2. What exists today (verified 2026-09-18, not assumed)

| Fact | Consequence |
|---|---|
| `pgvector` 0.8.2 is **available but not installed** on the Supabase instance | The old open question 6 is settled: vectors are possible. Needs `create extension vector` in a migration |
| `agent_jobs.kind` already allows `EMBED_DOCUMENT`, and `lib/agent/whatsapp/drain.ts:80` has a case for it that throws "not yet implemented" | The queue and the hook point exist. No new job table |
| No `knowledge-base` storage bucket. Existing private buckets: `agency-assets`, `payment-proofs`, `pilgrim-documents`, `supplier-evidence`, `whatsapp-media` | New bucket, following `20260827090000_tenant_storage_isolation.sql` |
| `pdf-parse` 2.4.5 is a dependency. No DOCX, XLSX-for-text, or embedding library is | PDF, TXT, Markdown in v1. DOCX is a separate dependency decision (Q3) |
| **Anthropic has no embeddings API** ([docs](https://platform.claude.com/docs/en/build-with-claude/embeddings)). OpenRouter does, and `OPENROUTER_API_KEY` is already configured (Leads copilot) | Embeddings go through OpenRouter (D2). Document text leaves the platform, as pasted enquiries already do for the copilot |
| A table `public.knowledge_articles` **already exists** in production: agency-scoped `title`, `body`, `category`, `language`, `is_active`, a `search` tsvector, RLS (read ADMIN/CEO/MARKETING/OPERATIONS/VISA/FINANCE, write ADMIN/MARKETING). It has 0 rows, no code reads or writes it, and **no migration in this repo creates it** | Schema drift: production has a table the repo cannot recreate. Must be captured in a migration either way (D6) |
| The tool set is assembled in `lib/agent/whatsapp/tools/registry.ts` from `ai_settings` capability flags; tool calls are wrapped by `lib/agent/kernel/telemetry.ts` (recording, redaction) | The new tool is one more `createXTools(ctx)` behind a new flag |
| `lib/ai/trust/fence.ts` wraps untrusted text in `<untrusted_content>` tags; `claim-verifier.ts` checks numbers against known facts | Reuse both. Do not invent a parallel safety layer |
| `ai-agent-access.ts` already has `manageKnowledgeBase` (ADMIN only) | No new capability needed |
| Runtime passes `usedToolThisTurn: telemetry.calls.length > 0` to the guardrail (`runtime.ts:182`) | **This is the defect §4 fixes.** Any tool call, including a knowledge search, switches the number check off |

## 3. Decisions

**D1 — Retrieval: chunked full-text search first, vectors second, behind one function.**
Ship a working knowledge base on Postgres full-text search alone (no embeddings call), then add vector
search as a separate phase and merge the two rankings. Reasons: it delivers value before the
vendor question is answered; and full-text search alone is weak for Sinhala and Tamil (the
`simple` configuration does no stemming, and a question in Sinhala will not match an English
document), which is exactly what vectors fix and exactly what has to be *measured*, not assumed.
Rejected alternative: put whole documents in the system prompt with caching. It avoids a vendor and
handles all three languages natively, but token cost scales with every document added, and it
removes the property the original plan wants — that the knowledge base is reachable only through a
tool that can be switched off, logged, and rate-checked.

**D2 — Embeddings go through OpenRouter, behind a single `embedTexts()` function.** Decided by the
owner. OpenRouter exposes `POST https://openrouter.ai/api/v1/embeddings` (Bearer auth, `model`,
`input` string or array, float vectors back, no streaming) and lists several multilingual models.
Default: **`baai/bge-m3`** — multilingual, fixed **1024 dimensions** (matches `vector(1024)`),
8K context, $0.01 per million tokens. Alternatives on the same endpoint if it underperforms:
`qwen/qwen3-embedding-8b` (multilingual, 33K context, $0.01) and `google/gemini-embedding-001`
(multilingual, $0.15). The model id comes from `KNOWLEDGE_EMBEDDING_MODEL`, never hard-coded, and
each document records which model embedded it, so a model change is a re-index, not a mystery.
It reuses the **existing `OPENROUTER_API_KEY`** already used by the Leads copilot — no new vendor
account or secret. Requests set OpenRouter's `provider.data_collection: "deny"` so document text is
only routed to providers that do not retain it. **Changing the model changes the vector dimension
for some models; if that ever happens the column is rebuilt, and P3 asserts the returned length
equals the column width and fails loudly instead of storing a mismatched vector.** Sinhala and Tamil
quality for any of these models is unproven here, so D7's evaluation still gates those languages.

**D3 — `hnsw`, not `ivfflat`.** The original plan specified `ivfflat`, which needs data present to
build good lists. Knowledge bases here are small and grow gradually; `hnsw` works from the first row.

**D4 — Agency isolation is enforced twice.** Tables get the standard `agency_id = current_agency_id()`
RLS. The agent reads with the service-role client (no session in a webhook), so retrieval goes through
a SQL function `search_knowledge_chunks(p_agency_id, …)` that is **revoked from `anon` and
`authenticated`** and executable only by `service_role`. Without that revoke, any signed-in user could
call it with another agency's id and read their documents through PostgREST.

**D5 — Knowledge results never satisfy the number guardrail.** See §4.

**D6 — `knowledge_articles` is adopted, not left orphaned.** It becomes the "write an article
directly" source (`source_kind = ARTICLE`), useful for short policies like a cancellation clause
that nobody has a PDF of. First step is a migration that captures its real current definition with
`create table if not exists`, so the repo can rebuild the database. If Q5 says drop it, that
migration drops it instead. Either way the drift is closed.

**D7 — A language is switched on only after it passes a retrieval check.** A small set of real
questions per language, with the document passage that answers each, must retrieve that passage in
the top results (the `lib/agent/departure-ops/__evals__/` fixtures are the precedent). English can
ship on full-text alone; Sinhala and Tamil wait for the vector phase and a measured result.

**D8 — Scanned PDFs are rejected in v1, clearly.** A PDF with no extractable text ends `FAILED` with
"This PDF has no readable text (it may be a scan)". OCR is a later option (Claude can read PDFs
directly, as `documents-ai.ts` already does) and is out of scope here.

## 4. The number problem, and its fix

Guardrail today: a reply containing a run of 3+ digits is blocked unless the turn made a tool call.
The intent is "a number must come from a tool". But a knowledge-base search is a tool call, so:
a stale brochure says "Umrah package LKR 245,000", the assistant searches, quotes it, and the guardrail
lets it through. That is the exact failure the design exists to prevent, and it would be *caused* by
this feature.

Fix, in `guardrails.ts` and `runtime.ts`:
- `usedToolThisTurn` becomes `usedNumberBackingToolThisTurn`: true only if a tool **other than**
  `search_knowledge_base` was called. Knowledge results therefore never unlock a price-like number.
- Consequence, accepted deliberately: a policy that states an amount ("a LKR 15,000 fee") will be
  blocked and the conversation handed to a person. Percentages and short day counts ("25%", "30 days")
  are 1–2 digits, are not caught by the 3+-digit pattern, and pass. Money going to a human is the safe
  direction. Revisit only if real conversations show it hurting.
- The tool result itself carries a standing note: "Policy text. Never quote a price, seat count or
  date from it; those come from the departure tools." Results are fenced with a new
  `knowledge_document` kind in `fence.ts`, and the frozen preamble already states that fenced content
  is data, not instruction.
- Upload-time hygiene: extraction scans for currency amounts and, if found, marks the document with a
  visible warning ("contains prices — the assistant will not quote them"). It does not modify text.

## 5. Data model — one migration, RLS in the same file

```text
create extension if not exists vector;                       -- D1

knowledge_documents
  id, agency_id, title, source_kind ('UPLOAD'|'ARTICLE'),
  article_id → knowledge_articles (null for uploads),
  storage_path, mime_type, byte_size, content_hash,          -- hash de-duplicates re-uploads
  document_kind ('POLICY'|'FAQ'|'VISA_AND_HEALTH'|'GENERAL'),
  language ('en'|'si'|'ta'), is_active boolean default true, -- staff can pause a document
  status ('UPLOADED'|'EXTRACTING'|'CHUNKING'|'EMBEDDING'|'READY'|'FAILED'),
  status_detail, has_price_warning boolean, chunk_count,
  embedding_model, uploaded_by, uploaded_by_name, created_at, updated_at
  unique (agency_id, content_hash)

knowledge_chunks
  id, agency_id, document_id → knowledge_documents on delete cascade,
  chunk_index, content text, token_estimate,
  fts_config regconfig ('english' for English, 'simple' otherwise),   -- a per-chunk text-search config
  content_tsv tsvector generated always as (to_tsvector(fts_config, content)) stored,
  embedding extensions.vector(1024) null,                    -- null until phase 3, or if unavailable
  unique (document_id, chunk_index)
  gin index on content_tsv · hnsw index on embedding (vector_cosine_ops) · index (agency_id, document_id)

ai_settings  + knowledge_base_enabled boolean not null default false

function search_knowledge_chunks(p_agency_id, p_query, p_query_embedding, p_limit)   -- D4
  service_role only; active + READY docs only. Full-text is an OR of the query's content words
  (an all-words match returns nothing for a natural question), English stemmed, everything else
  'simple'. Returns fts_rank and vector_similarity as raw signals plus a fused sort score; the
  relevance floor is applied by the tool in P2, once it can be tuned on real documents.

storage bucket 'knowledge-base'  private, 10 MB, application/pdf · text/plain · text/markdown
  policies follow 20260827090000_tenant_storage_isolation.sql (path prefix = agency_id)
```

RLS: **documents** — read ADMIN/CEO/MARKETING, write ADMIN, agency-scoped. **Chunks have no client
policy at all**: RLS is on and nothing is granted, so no browser or PostgREST call can read chunk text;
only the service role does, through `search_knowledge_chunks()` and the ingestion job, with explicit
`agency_id` filters like every other agent path. The screen only ever needs document metadata and a
chunk count.

## 6. Pipeline

```text
Upload (Server Action, ADMIN)
  requireUser → capability manageKnowledgeBase → Zod (title, kind, language, file type/size)
  → hash → reject duplicate → storage.upload → knowledge_documents (UPLOADED)
  → agent_jobs('EMBED_DOCUMENT', { documentId })

drain.ts  case "EMBED_DOCUMENT"  (replaces the throw)
  EXTRACTING  download → pdf-parse / decode text → "no readable text" → FAILED (D8) · price scan
  CHUNKING    ~800-token chunks, ~100 overlap, on paragraph boundaries; token count estimated
              (characters ÷ 4 — no tokenizer dependency)
  EMBEDDING   phase 3 only: batch through embedTexts(); on failure keep chunks, leave embedding null,
              document still READY on full-text (retrieval degrades, it does not fail)
  READY       chunk_count set; idempotent: a re-run deletes and rebuilds that document's chunks
```

Retry follows the existing `agent_jobs` contract (`attempts`, `DEAD` after `max_attempts`); a `DEAD`
job sets the document `FAILED` with the reason so a person sees it on the screen, not in a log.

## 7. The tool and its wiring

`lib/agent/whatsapp/tools/knowledge.ts` → `search_knowledge_base({ query })`
- Available only when `ai_settings.knowledge_base_enabled` **and** the agency has at least one
  active `READY` document. If there is nothing to search, the tool is absent, so the assistant never
  offers an answer it cannot give.
- Returns at most 4 chunks: document title, document kind, fenced text. Returns **nothing** when no
  chunk clears the relevance floor, so the assistant says it will check with a colleague instead of
  paraphrasing a weak match.
- Description states when to call it (policy, procedure, "what happens if…") and what it is not for
  (prices, seats, dates, availability). Trigger conditions live in the description, behaviour in the
  prompt, per the existing convention.
- Prompt: one added capability line; preamble rule 5 already covers the behaviour. Reply asks the
  assistant to name the document it drew from, briefly, because it is a phone chat.
- Telemetry, redaction and `agent_tool_calls` recording come for free from the existing wrapper; the
  Copilot analytics table (TASK-002) gains a plain-language label for the tool.

## 8. UI

`app/(main)/management/ai-agent/knowledge/` (the route the original plan named), gated by
`capabilitiesForAiAgent(role).manageKnowledgeBase`; read-only for CEO/MARKETING.
- List of documents through the shared `DataTable`: title, kind, language, status as a labelled badge
  (never colour alone), chunk count, last updated, active toggle.
- Upload sheet using the `InputGroup` pattern: file, title, kind (`Select`), language (`Select`).
- Per-document: re-index, pause/resume, delete (removes chunks and the stored file; confirmation
  dialog states this cannot be undone).
- Designed empty state ("Add your cancellation policy, visa guide or FAQs so the assistant can answer
  without a colleague"), skeleton loading, specific failure messages ("This PDF has no readable text").
- A master switch for `knowledge_base_enabled` on the existing Copilot settings form.
- Plain-language copy throughout; no "chunk", "embedding" or "vector" shown to staff.

## 9. Testing

Vitest, per `docs/standards/testing-standards.md`:
- Chunker: paragraph boundaries, overlap, empty and whitespace-only input, a single oversized paragraph.
- Number guardrail: knowledge-only turn containing `245,000` is **blocked**; the same turn plus a
  departure-tool call is allowed; a knowledge-only turn saying "25%" or "30 days" passes.
- Price scan flags currency amounts and does not flag "25%".
- Tool availability: absent when the flag is off, and absent when no `READY` document exists.
- Isolation: with two agencies' chunks present, retrieval for agency A returns none of B's, and
  `search_knowledge_chunks` is not executable by `authenticated` (checked against the live catalog).
- Retrieval check fixtures per language (D7), run manually with real documents before a language is
  enabled; the automated part asserts the fixtures parse and the ranking function is deterministic.
- Browser: upload → status progression → READY, failure state with a scanned PDF, permission-denied,
  mobile width.

## 10. Phasing

| Phase | Scope | Done when |
|---|---|---|
| **P0 Foundations** — ✅ **applied to production 2026-09-18** | Migrations `20261125090000_knowledge_base_foundations.sql` (extension, both tables, function, bucket + policies, `ai_settings` flag, `knowledge_articles` drift, D6) and `20261125090001_knowledge_chunks_text_fts_config.sql` (see note). `lib/validations/knowledge-base.ts`, `fence.ts` kind | Each migration was first run with assertions inside a rolled-back transaction: RLS on, chunks have no client policy, function executable by `service_role` only, two-agency isolation both directions, English question retrieval, vector path, inactive/FAILED documents excluded, data preserved across the follow-up rebuild. `get_advisors` after applying: no new findings except the intended "RLS enabled, no policy" note on `knowledge_chunks` |

P0 note — the advisor flagged `fts_config regconfig` (a `reg*` column blocks major-version database
upgrades), so the second migration stores it as `text` (`'english'|'simple'`) and the generated
tsvector picks the configuration with a `CASE` over constant regconfig literals.

**Carry into P2 (found in P0 validation):** chunks using the `'simple'` configuration (Sinhala, Tamil)
keep stop words, so a query of only common words such as "the and of is" still matches any `simple`
chunk containing "and". The tool's relevance floor must therefore not accept a `simple`-config
full-text hit on its own; require a minimum `fts_rank` and/or a vector similarity for those chunks.
| **P1 Ingest + screen** — ✅ **built 2026-09-18, not yet exercised against a real upload** | Upload action, `EMBED_DOCUMENT` handler, extraction, chunker, KB screen | A real PDF goes UPLOADED → READY and its chunks are visible by count; a scanned PDF fails with a clear reason |
| **P2 Retrieval + safety** — ✅ **built 2026-09-18; live retrieval checked, no real conversation yet** | Tool, guardrail change (§4), prompt line, registry wiring, analytics label | "What is your cancellation policy?" is answered from the uploaded document, naming it; a brochure price is **not** quoted; another agency's document is never returned |
| **P3 Vectors** — ✅ **built 2026-09-18; similarity floor is a starting value, not yet tuned on real documents** | `embedTexts()`, hybrid ranking, backfill, per-language retrieval check | Sinhala and Tamil questions retrieve their passages, or those languages stay off and the screen says so |
| **P4 Articles + gaps** — ✅ **built 2026-09-18; the screen itself not yet opened with real data** | Write-an-article path on `knowledge_articles`; a "questions we couldn't answer" view from tool calls that returned nothing | Staff can add a short policy without a file; unanswered questions are visible |

P0–P2 need no embeddings call at all and deliver an English-capable knowledge base. P3 needs no new
secret either, only `KNOWLEDGE_EMBEDDING_MODEL` (default `baai/bge-m3`) alongside the existing
`OPENROUTER_API_KEY`.

## 11. Risks

1. **Stale content.** Documents age; the assistant will confidently repeat an outdated policy. Mitigation:
   each document shows its last-updated date, staff can pause it, and `is_active` is honoured
   immediately by retrieval. A "review these documents" nudge is a later option, not v1.
2. **Prompt injection through documents.** Anything pasted from a supplier email can carry
   instructions. Fenced as untrusted, hidden control characters stripped, and the agent's tools remain
   the only way it can act.
3. **Sensitive material uploaded by mistake** (a passport scan, a price list marked confidential).
   Mitigation is copy and the price warning; there is no automated classification in v1. Documents are
   agency-private in a private bucket and are never used outside that agency's assistant.
4. **Retrieval quality is unproven for Sinhala and Tamil.** That is why D7 gates them. OpenRouter
   routes to upstream providers, so an embedding model can be withdrawn or repriced; the per-document
   `embedding_model` column and a single `embedTexts()` seam keep that a re-index rather than a rewrite.
5. **Hybrid ranking complexity.** Two rankings merged badly is worse than one ranking done well.
   P3 starts with the simplest merge that passes the language check and stops there.

## 12. Open questions (need an answer from you)

1. ~~**Voyage AI for embeddings?**~~ **Answered: use OpenRouter** (D2). Same existing key; document
   text is sent to OpenRouter with data collection denied.
2. **What will actually be uploaded, and in what form?** Mostly typed PDFs and Word files, or scans
   and photos? Scans need OCR, which this plan defers.
3. **Do you need Word (`.docx`) uploads in v1?** It needs a new dependency; PDF, text and Markdown do not.
4. **Who may manage the knowledge base?** Plan says ADMIN only (matches `manageKnowledgeBase`). The
   existing `knowledge_articles` table also lets MARKETING write. Pick one.
5. **`knowledge_articles`: adopt (D6) or drop?** It is empty and unused. Adopting costs little and
   gives you a paste-a-policy option; dropping is cleaner if nobody wants it.
6. **What counts as "good enough" in Sinhala and Tamil?** e.g. the right passage in the top 3 for 8 of
   10 real questions. You know the customers; I will not guess the bar.

## P1 build notes

- The browser uploads straight to the private bucket (Server Action bodies are capped near 1 MB);
  `registerKnowledgeDocumentAction` then re-reads the stored file, hashes it server-side, rejects a
  duplicate, inserts the row and queues `EMBED_DOCUMENT`. The path must sit under the caller's agency folder.
- `lib/agent/whatsapp/knowledge/`: `chunker.ts`, `extract.ts` (scan / damaged PDF = permanent failure with a
  plain message), `price-scan.ts`, `ingest.ts` (idempotent rebuild; 400-piece cap). `drain.ts` runs it, and marks
  the document FAILED when the job runs out of retries.
- Screen: `/management/ai-agent/knowledge` (list with status badges, pause/resume, read again, delete with
  confirmation, master switch, upload sheet). Polls every 4 s while any document is still processing.
- Not yet done: an end-to-end run with a real PDF and a scanned PDF (needs a signed-in ADMIN session; the only
  database is production, so this should be done with a throwaway document that is then deleted).

## P2 build notes

- `tools/knowledge.ts` → `search_knowledge_base`, registered only when `ai_settings.knowledge_base_enabled` and an
  active READY document exists (`knowledge/availability.ts`). Results are fenced (`knowledge_document`) with a standing
  "never quote a price, seat count or date" note; no match returns `found:false` so the assistant defers to a colleague.
- Guardrail: `usedToolThisTurn` became `usedNumberBackingToolThisTurn`; `search_knowledge_base` never counts
  (`guardrails.ts`, tested: a knowledge-only turn with `245,000` is blocked, the same turn plus a departure tool passes,
  "25%" / "30 days" pass).
- The P0 "simple-config noise" carry-over is handled at the source: `prepareKnowledgeQuery` drops English stop words
  before the query reaches Postgres, so a match must come from a content word. It splits on letters, combining marks and
  digits (Sinhala/Tamil vowel signs are combining marks; a first version split them and a test caught it).
- Verified live in a rolled-back transaction: a matching query returns the document, an unrelated query returns nothing,
  "refund" matches "refunded".
- Not yet done: a real WhatsApp conversation end to end, and the model's behaviour with the tool (does it name the
  document, does it defer on no match). That needs a connected number and an uploaded document.

## P3 build notes

- `lib/ai/embeddings.ts`: `embedTexts()` through OpenRouter's embeddings endpoint (batches of 32, 30 s timeout),
  model from `KNOWLEDGE_EMBEDDING_MODEL` (default `baai/bge-m3`, in `.env.example`), response validated to exactly
  1024 dimensions. Same `OPENROUTER_API_KEY`; no new secret.
- Ingest embeds all pieces before inserting them; on any failure the document is still READY on keyword search
  (`embedding_model` stays null). Search embeds the query the same way and falls back to keyword-only if that fails.
- Relevance: a passage is kept on a content-word match or a cosine similarity of at least 0.5.
- Checked against the live model: 1024 dimensions; an English policy sentence scored 0.61 against a paraphrase, 0.66
  against a question sharing no keywords, 0.72 against the same question in Sinhala, and 0.38 against an unrelated
  hotel sentence. So 0.5 separates these cases, but it is one probe, not the D7 evaluation.
- The database accepted the embedding over the real REST path (`search_knowledge_chunks` returned `[]` on an empty
  knowledge base, no argument error).
- **Backfill:** documents added before an embedding key was configured have no embeddings; "Read again" on the screen
  rebuilds them. There is no bulk backfill; add one only if an agency has many documents.
- **Still to do before relying on Sinhala or Tamil:** run the D7 retrieval check with real documents in each language
  and tune `KNOWLEDGE_MIN_VECTOR_SIMILARITY`. The upload screen already warns that those languages match less flexibly;
  update that warning once the check passes.

## P4 build notes

- **Written policies:** "Write a policy" on the knowledge screen creates a `knowledge_articles` row plus a
  `knowledge_documents` row (`source_kind = 'ARTICLE'`), then runs through the same job as an uploaded file
  (`ingest.ts` loads the article text instead of a file). Editing saves and re-reads it; deleting removes the article,
  and its document and pieces cascade. If saving the document fails after the article was created, the article is
  removed so nothing half-saved remains. This settles Q5: `knowledge_articles` is adopted, not dropped.
- **Topics the assistant couldn't answer:** read from `agent_tool_calls` for `search_knowledge_base` results starting
  `{"found":false` in the last 30 days, grouped by the assistant's cleaned key words (never the customer's own message),
  most-asked first, top 20. Visible only to roles that can view analytics (ADMIN, CEO), because that is who RLS lets
  read the table.
- Verified in a rolled-back transaction: an article-backed document row is accepted, its text is searchable, deleting
  the article leaves no document or pieces behind.
- The PostgREST `like` filter with braces and quotes was accepted by the live API, but `agent_tool_calls` is empty
  today, so real matching is untested until the assistant has answered some conversations.
- Knowledge base status: P0–P4 are built. Open items before relying on it: a real end-to-end upload and WhatsApp
  conversation, and the Sinhala and Tamil retrieval check (P3 notes).

## Test pass — 2026-09-18 (P0–P4, run against production with throwaway documents, all since deleted)

Done through the real screen, real database and real embedding model. The production database had no test data left
afterwards (0 documents, pieces, articles, stored files or open jobs); the master switch was never turned on.

| Area | Result |
|---|---|
| Write a policy → Ready | Passed. Ready in seconds, price note shown, embedded with `baai/bge-m3`, screen refreshed on its own |
| Pause / resume | Passed. Pausing removed it from search immediately |
| Read again | Passed. Rebuilt to exactly one piece, no duplicates, re-embedded |
| Upload a file, delete with confirmation | Passed. Delete removed the row, pieces and the stored file |
| Duplicate upload | Passed. Refused with a plain message, no orphan file |
| Scanned PDF | **Found a bug, fixed.** pdf-parse writes "-- 1 of 1 --" for a page with no text, so a scan was accepted as Ready with junk. Markers are now stripped and a minimum of readable text is required; tested with real digital and blank PDFs |
| Assistant answers (real prompt and tools, model reached through OpenRouter because there is no local Anthropic key) | Passed. Used the lookup on policy questions, named the document, never quoted the LKR 15,000 fee, deferred on "how much is the fee", deferred on an uncovered hotel question |
| Tool robustness | **Found a bug, fixed.** The model once called the lookup without a query and the tool crashed (a crashed tool call leaves the customer unanswered). It now returns not-found; tested |
| Sinhala and English retrieval (one short document each) | Related questions scored 0.68–0.75 in both directions and across languages; unrelated hotel questions scored 0.29–0.35, below the 0.5 floor |
| Unanswered-topics query | Passed against real rows (2 of 3 matched, rows cleaned up) |
| Layout | **Found a problem, fixed.** The Actions column was pushed off-screen at laptop width; no overflow at 375 px now. Dropdowns showed raw codes ("POLICY", "en"); now labelled |

Not covered: a real WhatsApp conversation (the production assistant is enabled with a live number, so the master
switch was left off), the permission-denied view for a non-ADMIN role (only an ADMIN session was available), and
more than one short document per language. The model used for the answer check was reached through OpenRouter, not
the production Anthropic call, so wording may differ slightly in production.
