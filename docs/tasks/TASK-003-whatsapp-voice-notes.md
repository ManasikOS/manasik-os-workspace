# TASK-003 WhatsApp Voice Notes (G2)

## What
When a customer sends a WhatsApp voice note, the assistant listens to it (speech to text) and answers
in text through the **same** conversation engine as a typed message (decision D12 in
[whatsapp-ai-agent-implementation-plan.md](../modules/whatsapp-ai-agent-implementation-plan.md)). Item G2
of [whatsapp-go-live-plan.md](../modules/whatsapp-go-live-plan.md). Voice notes **in**, text replies
**out**: sending voice replies is deliberately not part of this task (see Out of scope).

## Why
Today a voice note is saved with empty text, a `TRANSCRIBE_AUDIO` job is queued, and that job throws
"not implemented", so after its retries the customer is never answered. Worse, the empty message is
sent to the model as part of the chat history, and the model API rejects empty text blocks, so one
voice note (or one image with no caption) can make every later reply in that conversation fail until
it scrolls out of the last 20 messages. Older pilgrims lean on voice notes, so this is a common case.

## Findings that shaped the design (tested 2026-09-18)
- Transcription through OpenRouter works with `google/gemini-3.5-flash-lite`: an 11-second English clip
  came back word-for-word in about 2.5 s for about **$0.0001**.
- **Ogg/Opus, the format WhatsApp uses for voice notes, is accepted directly** (format `ogg`). No audio
  conversion step (and no ffmpeg in production) is needed.
- Not tested: Sinhala and Tamil speech. No Sinhala voice is available on this machine to generate a
  sample, so accuracy in those languages must be checked with real recordings before relying on it.

## Data model changes
- **None.** `ai_settings.voice_enabled` already exists (default false). The audio's WhatsApp media id and
  MIME type are stored in the existing `conversation_messages.metadata`. The audio file itself is
  **not stored** — only the transcript — which is also the more private choice.

## Behaviour
1. Webhook: for an audio message, save `metadata.media_id`, `metadata.mime_type`.
   - Voice switched **on** (and a media id present): queue `TRANSCRIBE_AUDIO`.
   - Voice switched **off**, or no media id: save the message with a plain placeholder
     ("[Voice message — the assistant can't listen to voice notes]") and queue the normal job, so the
     assistant replies asking the customer to type instead of staying silent.
2. `TRANSCRIBE_AUDIO` job: download the audio from Meta, refuse anything over 5 MB, transcribe, save the
   transcript as the message text (`metadata.transcription` records model, cost and outcome), then queue the
   normal `PROCESS_INBOUND` job. A retry that finds the transcript already saved skips straight to the
   reply. If it cannot be transcribed, or nothing could be heard, save a placeholder
   ("[Voice message — couldn't be understood]") and still queue the reply so the customer is not ignored.
3. Model input: messages with no text (voice notes not yet transcribed, images without a caption) are
   sent as a short bracketed description, never as an empty block.
4. Prompt: transcripts can contain misheard words. The assistant must ask the customer to **type**
   names, passport or ID numbers, dates and phone numbers rather than record them from a voice note.
5. Setting: a "Voice notes" checkbox on the Manasik Copilot settings form (ADMIN only, like
   every other setting there).

## Configuration
`VOICE_TRANSCRIPTION_MODEL` (default `google/gemini-3.5-flash-lite`), uses the existing
`OPENROUTER_API_KEY`. No new secret.

## Access control
No new roles or policies. The job runs with the service role and an explicit agency filter, like every
other agent path. The setting is written through `saveAiSettings`, gated by `editSettings` and ADMIN-only RLS.

## Testing
- Pure: audio format from MIME type, request and response parsing, placeholder text, model-history
  mapping of empty messages (Vitest).
- Job logic with the download and transcription steps injected: transcript saved and reply queued; retry
  skips work; oversize, failure and silence produce a placeholder and still queue the reply.
- Live: real transcription of English speech in WAV and Ogg/Opus (done above).
- Not testable here: a real WhatsApp voice note end to end, Sinhala and Tamil accuracy.

## Out of scope
- Voice **replies** (text to speech). WhatsApp allows sending audio, but speech quality for Sinhala and
  Tamil is unproven, replies would need a stored audio file each, and typed replies are easier to reread
  and quote. Revisit only if customers ask for it.
- Voice notes sent by staff from the Inbox.
- Storing or playing back the original audio in the Inbox.

## Status
Built 2026-09-18 and tested as far as this machine allows.
- Unit tests: format mapping, response parsing, empty-message mapping, and every branch of the job logic
  (transcript saved, retry skips work, no media, silence, permanent failure, temporary failure, final attempt).
- Live, with real speech: an Ogg/Opus voice note went through the real job logic and the real model and came back
  word for word with its cost (about $0.00013) recorded; a silent clip produced the placeholder and still queued a reply.
- The settings switch renders and is **off by default**. It was not switched on: this is a live agency with a connected number.
- **Not verified:** a real WhatsApp voice note through Meta's media download, Sinhala and Tamil accuracy, and voice notes in a
  live booking conversation. To try it: turn on "Voice notes" on the Manasik Copilot screen, send a voice note from a
  phone in each language, and read the transcript in the Inbox.
- Also fixed: messages with no text (voice notes, images without a caption) are no longer sent to the model as empty
  text, which the model API rejects and which could have broken every later reply in that conversation.
