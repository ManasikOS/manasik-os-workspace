/**
 * A concise, human-readable fallback for the Inbox list when a message has
 * no typed content. Media messages intentionally arrive with empty content.
 */
const MESSAGE_TYPE_PREVIEW_LABELS: Record<string, string> = {
  AUDIO: "Voice message",
  DOCUMENT: "Document",
  IMAGE: "Photo",
  INTERACTIVE: "Interactive message",
  SYSTEM: "System message",
  TEMPLATE: "Template message",
  TEXT: "Message",
};

export function inboxListMessagePreview(input: {
  content: string | null;
  messageType: string | null;
}): string {
  const content = input.content?.trim();
  if (content) return content;

  return MESSAGE_TYPE_PREVIEW_LABELS[input.messageType ?? ""] ?? "Attachment";
}
