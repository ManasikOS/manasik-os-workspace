# AI provider and model selection

System-wide design for how every AI feature reaches a model, and which model each kind of work uses.
Decided and measured on **2026-09-19**. This supersedes D14 in
[whatsapp-ai-agent-implementation-plan.md](../modules/whatsapp-ai-agent-implementation-plan.md) (which named
`claude-opus-5`) and the "Anthropic API" line in [README.md](README.md).

## 1. One provider: OpenRouter

All AI runs through **OpenRouter** with one key, `OPENROUTER_API_KEY`. There is **no Anthropic key**.

| Concern | How it works |
|---|---|
| Client | `lib/ai/provider.ts` builds the Anthropic SDK against OpenRouter's Anthropic-compatible endpoint (`https://openrouter.ai/api`, bearer token = `OPENROUTER_API_KEY`). The SDK is kept only for its tool runner, so tool calling, adaptive thinking, `effort`, prompt-cache markers and JSON-schema output work unchanged, for **any** model OpenRouter serves, not only Claude. |
| Gate | `isAiConfigured()` = `OPENROUTER_API_KEY` is set. Without it WhatsApp messages still arrive and the Inbox works as a plain shared inbox; they are just not answered automatically. |
| Other calls | Embeddings (`lib/ai/embeddings.ts`), voice transcription (`lib/ai/transcription.ts`) and Leads "Manasik Decision" (`lib/copilot/sales/llm/openrouter.ts`) call OpenRouter directly with the same key. |
| Cost record | Each agent run stores the model slug and token counts (`agent_runs`); `ai_model_rates` prices them by exact slug. **A new default model needs a rates row**, or the AI-cost figure reads $0. |

## 2. Model per tier

Every model is an OpenRouter slug, overridable per environment. Defaults are in `lib/ai/provider.ts`.

| Tier | Used for | Default | Override | $/M in / out |
|---|---|---|---|---|
| `agent` | WhatsApp assistant, Departure Ops, Finance agent (tool-calling loops) | `openai/gpt-5.6-luna` | `AI_AGENT_MODEL` | 0.10 / 0.60 |
| `classify` | triage, intent, field extraction | `openai/gpt-5.6-luna` | `AI_CLASSIFY_MODEL` | 0.10 / 0.60 |
| `reason` | explanations touching money or eligibility; passport/document reading | `google/gemini-3.8-flash` | `AI_REASON_MODEL` | 0.375 / 1.875 |
| `draft` | customer-facing copy, summaries | `google/gemini-3.8-flash` | `AI_DRAFT_MODEL` | 0.375 / 1.875 |
| Leads decision / ticket-visa | `OPENROUTER_MODEL` | `google/gemini-3.8-flash` | `OPENROUTER_MODEL` | 0.375 / 1.875 |
| Embeddings | knowledge-base search | `baai/bge-m3` | `KNOWLEDGE_EMBEDDING_MODEL` | (embeddings) |
| Voice notes | speech to text | `google/gemini-3.5-flash-lite` | `VOICE_TRANSCRIPTION_MODEL` | ~$0.0001 / 11 s clip |

The previous default, `claude-opus-5` ($5 / $25), was used for everything, including "Hi".

## 3. How the default was chosen

The same tool-calling turns (a greeting, an English price question, the same question in Sinhala and in
Tamil, each with a `get_price` tool and a system prompt) were run through OpenRouter, exactly as the
runtime calls it (adaptive thinking, `effort: low`, cache marker). Cost is the `usage.cost` OpenRouter reports.

| Model | "Hi" | Price (EN) | Sinhala | Tamil | Cost per turn | Speed |
|---|---|---|---|---|---|---|
| `anthropic/claude-opus-5` (old default) | ok | ok | ok (3 tool calls) | ok | $0.003 - $0.018 | 4 - 18 s |
| **`openai/gpt-5.6-luna`** | ok | ok | ok | ok | **$0.00004 - $0.00018** | **1 - 4 s** |
| `z-ai/glm-5.3-flash` | ok | ok | ok | ok | $0.00007 - $0.0003 | 10 - 19 s |
| `google/gemini-3.8-flash` | ok | ok | ok | ok | $0.0004 - $0.0016 | 4 - 12 s |
| `deepseek/deepseek-v4-flash-0731` | ok | ok | ok | ok | $0.00003 - $0.00012 | 4 - 7 s |
| `x-ai/grok-4.3` | ok | ok | ok (terse) | ok (terse) | $0.0005 - $0.0016 | 2 - 6 s |

Why **gpt-5.6-luna**: every turn correct with the tool used, the fastest in the set, about 30-100 times
cheaper than opus, 1M context, cache reads at $0.01/M, and reasoning effort can be turned down. GLM 5.3 Flash
scores highest on the agentic index at a similar price but was 3-5 times slower. DeepSeek V4 Flash is the
cheapest, and the fallback if cost ever matters more than polish. Gemini 3.8 Flash has the best general score
(intelligence index 41) of the cheap models, so it takes the `reason` and `draft` tiers. Free models
(`qwen3.8-27b:free`, `deepseek-v4-flash-0731:free`, and others) exist but are rate-limited and may log prompts, so
they are **not** used for customer conversations.

Catalogue facts used (OpenRouter, Artificial Analysis indices; intelligence / agentic): GPT-5.6 Luna 37.5 / 42.7,
GLM 5.3 Flash 41.9 / 51.2, Gemini 3.8 Flash 41.2 / 41.1, DeepSeek V4 Flash 34.5 / 41.7, Claude Haiku 4.5 17.6 / 10.3
at $1 / $5 (worse and 10x dearer, so not used).

## 3a. Free model for chats no person has touched (2026-09-19; opt-in since 2026-09-25)

**Since 2026-09-25 the free model is opt-in.** With `AI_FREE_CHAT_MODEL` unset or `off`, every turn uses the paid
model and the first row of the table below does not apply. Free endpoints may log prompts, and a customer's first
messages carry names, phone numbers and passport questions. To use one, set `AI_FREE_CHAT_MODEL` to its slug (for
example `inclusionai/ling-3.0-flash-vl:free`). `OPENROUTER_DATA_POLICY=deny|zdr` restricts which providers may serve any
AI request; see `lib/ai/openrouter-privacy.ts`.

`lib/agent/whatsapp/model-routing.ts` decides per WhatsApp turn:

| Conversation | Model |
|---|---|
| State `AI_ACTIVE` and no staff message in the recent history (customer and assistant only) | **Free model first, only when `AI_FREE_CHAT_MODEL` is set** (e.g. `inclusionai/ling-3.0-flash-vl:free`), no thinking step, 7 s limit; otherwise the paid model |
| Staff wrote to the customer, the customer asked for a person (`HUMAN_REQUESTED`), or staff handed the chat back (`AI_RESUMED`) | **Paid model**, `AI_AGENT_MODEL` (default `gpt-5.6-luna`), adaptive thinking |
| Free attempt fails (rate limit, timeout, empty reply, error) and no write tool has run yet | Same turn is **retried on the paid model** |
| Free attempt fails after a write tool ran (lead, note, booking) | No retry, so nothing is created twice; the job's normal retry applies |

The run record stores the model that actually answered. Free runs are unpriced (cost 0). Set
`AI_FREE_CHAT_MODEL` empty or `off` to always use the paid model (the default).

Measured on the same four turns (no thinking, tools attached): `ling-3.0-flash-vl:free` 1.7-4.6 s and used the tool
correctly; `deepseek-v4-flash-0731:free` 3.6-10.6 s and returned an **empty** reply to "Hi"; `qwen3.8-27b:free`
was rate-limited (429) on one turn and empty on another; `gemma-4-31b-it:free` returned 429 on every turn;
`nemotron-3.5-lightning:free` took 18-125 s. The paid `gpt-5.6-luna` took 1.4-3.9 s. **A free model is not faster
than the paid cheap one**, and no model, free or paid, answers a tool-using turn in under a second; expect
about 2-4 s from message to reply. Free models are also limited (about 20 requests a minute; 50 a day until the
OpenRouter account holds $10 of credit, 1000 after), and the provider may log prompts, so customer text goes to a
third party. That is why the paid fallback exists.

## 4. Limits of this evidence

- The test was four short turns, not a full booking conversation. Watch the first real conversations in the Inbox
  and the Copilot analytics screen (tool errors, guardrail blocks, unanswered topics).
- Sinhala and Tamil replies were judged for sense and tool use, not native-speaker quality. Have a speaker read a few.
- Reading passports and other documents now uses the `reason` tier; it was not re-tested on real scans.
- If quality is not good enough, change one variable, for example
  `AI_AGENT_MODEL=google/gemini-3.8-flash` (about 4x the cost) or `anthropic/claude-sonnet-5`, and redeploy.
  No code change, but add an `ai_model_rates` row for the new slug.

## 5. Changing a model

1. Pick the slug on openrouter.ai/models (it must support `tools`).
2. Add a dated row to `ai_model_rates` (new migration, data only) with its list prices.
3. Set the environment variable in Vercel and redeploy.
4. Send a test message and read the run in Copilot analytics.
