/**
 * A signed attachment URL can expire while a conversation remains open. Renew a failed audio source once,
 * but do not put the UI in an infinite refresh loop when the recording itself cannot be decoded.
 */
export function shouldRenewInboxAudioSource(input: {
  attachmentId: string;
  mimeType: string;
  sourceHref: string | null;
  renewedAttachmentIds: ReadonlySet<string>;
}): boolean {
  return input.mimeType.toLowerCase().startsWith("audio/")
    && Boolean(input.sourceHref)
    && !input.renewedAttachmentIds.has(input.attachmentId);
}
