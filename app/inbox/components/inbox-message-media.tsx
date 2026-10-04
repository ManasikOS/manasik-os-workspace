"use client";

import { useEffect, useRef, useState } from "react";

import type { InboxAttachment } from "../types";
import { shouldRenewInboxAudioSource } from "@/lib/inbox/media/playback";
import { useInboxRefresh } from "./inbox-refresh-context";
import { InboxVoiceMessagePlayer } from "./inbox-voice-message-player";
import { FilePdf } from "reicon-react";

const LOADING_POLL_MS = 4000;
const LOADING_POLL_LIMIT = 15;

/**
 * A customer's photo, voice note or file shown inside its own chat bubble, like a WhatsApp chat. The original is fetched
 * from the channel in the background, so until it is stored the bubble says it is loading rather than looking broken.
 */
export function InboxMessageMedia({ attachments }: { attachments: InboxAttachment[] }) {
  const refreshInbox = useInboxRefresh();
  const renewedAudioAttachmentIds = useRef<Set<string>>(new Set());
  const [failedAudioSources, setFailedAudioSources] = useState<Record<string, string>>({});
  const [renewedAudioSources, setRenewedAudioSources] = useState<Record<string, string>>({});
  const stillLoading = attachments.some(
    (attachment) => !attachment.original_href,
  );
  // The file is downloaded in the background and nothing announces it, so while a file is missing, look again every few
  // seconds (for about a minute) instead of leaving "Loading…" until the person reloads.
  useEffect(() => {
    if (!stillLoading) return;
    let ticks = 0;
    const timer = window.setInterval(() => {
      ticks += 1;
      if (ticks > LOADING_POLL_LIMIT) return window.clearInterval(timer);
      refreshInbox();
    }, LOADING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [stillLoading, refreshInbox]);

  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 ">
      {attachments.map((attachment) => {
        const href = attachment.original_href;
        const mimeType = attachment.mime_type.toLowerCase();
        if (!href) {
          return (
            <p key={attachment.id} className="text-xs text-muted-foreground">
              Loading{" "}
              {mimeType.startsWith("audio/")
                ? "voice message"
                : mimeType.startsWith("image/")
                  ? "photo"
                  : "file"}
              …
            </p>
          );
        }
        if (mimeType.startsWith("image/")) {
          return (
            <a
              key={attachment.id}
              href={href}
              className=" px-0.5 py-0.5"
              target="_blank"
              rel="noreferrer"
            >
              {/* A short-lived signed storage URL, not an optimisable static asset, so a plain img is correct here. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="max-h-72 rounded-md object-contain"
                src={href}
                alt={attachment.filename ?? "Photo from the customer"}
              />
            </a>
          );
        }
        if (mimeType.startsWith("audio/")) {
          const failedSource = failedAudioSources[attachment.id] === href;
          const refreshedSource = renewedAudioSources[attachment.id];
          return (
            <div key={attachment.id} className="space-y-1">
              <InboxVoiceMessagePlayer
                key={`${attachment.id}:${href}`}
                src={href}
                waveformSeed={attachment.id}
                onSourceError={() => {
                  setFailedAudioSources((current) => ({ ...current, [attachment.id]: href }));
                  if (shouldRenewInboxAudioSource({
                    attachmentId: attachment.id,
                    mimeType,
                    sourceHref: href,
                    renewedAttachmentIds: renewedAudioAttachmentIds.current,
                  })) {
                    renewedAudioAttachmentIds.current.add(attachment.id);
                    setRenewedAudioSources((current) => ({ ...current, [attachment.id]: href }));
                    refreshInbox();
                  }
                }}
                onStartedPlaying={() => {
                  setRenewedAudioSources((current) => {
                    if (!Object.hasOwn(current, attachment.id)) return current;
                    const remaining = { ...current };
                    delete remaining[attachment.id];
                    return remaining;
                  });
                }}
              />
              {(failedSource || (refreshedSource && refreshedSource !== href)) && (
                <p role="status" className="text-xs text-muted-foreground">
                  {failedSource
                    ? refreshedSource === href
                      ? "Refreshing voice message…"
                      : "This voice message could not be played."
                    : "Voice message refreshed. Press Play again."}
                </p>
              )}
            </div>
          );
        }
        return (
          <a
            key={attachment.id}
            className="flex items-center gap-2   px-3.5 py-1.5   text-sm underline-offset-2 hover:underline"
            href={href}
            target="_blank"
            rel="noreferrer"
          >
            <FilePdf className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {attachment.filename || "Open file"}
            </span>
          </a>
        );
      })}
    </div>
  );
}
