/** Voice-note helpers that never download audio or call an AI model. */

/** Saved as message text so the assistant asks the customer to type instead. */
export const VOICE_DISABLED_TEXT = "[Voice message — the assistant can't listen to voice notes]";

/** Maximum retained voice-note size accepted from Meta. */
export const MAX_VOICE_NOTE_BYTES = 5 * 1024 * 1024;

export interface VoiceMediaRef {
  mediaId: string;
  mimeType: string | null;
}

/** What to remember from a WhatsApp webhook so the recording can be retained for staff playback. */
export function voiceMediaFromWebhook(message: { audio?: { id?: string; mime_type?: string } }): VoiceMediaRef | null {
  const mediaId = message.audio?.id;
  if (!mediaId) return null;
  return { mediaId, mimeType: message.audio?.mime_type ?? null };
}

/**
 * The text the model sees for a saved message. Model APIs reject empty text blocks, so media-only
 * messages must be represented without inventing a transcript.
 */
export function modelTextForMessage(row: { content: string; message_type: string }): string {
  if (row.content.trim().length > 0) return row.content;
  switch (row.message_type) {
    case "AUDIO":
      return VOICE_DISABLED_TEXT;
    case "IMAGE":
      return "[The customer sent an image.]";
    case "DOCUMENT":
      return "[The customer sent a document.]";
    default:
      return "[The customer sent a message with no text.]";
  }
}
