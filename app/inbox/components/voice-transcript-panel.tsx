"use client";

import { useEffect } from "react";

import { ToneBadge } from "@/components/ui/tone-badge";
import CopyButton from "@/components/ui/copy-button";
import type { VoiceTranscriptView } from "@/lib/inbox/media/voice-transcript";

import { useInboxRefresh } from "./inbox-refresh-context";

const TRANSCRIPT_POLL_MS = 4000;
const TRANSCRIPT_POLL_LIMIT = 15;

const LANGUAGE_LABEL: Record<NonNullable<VoiceTranscriptView["language"]>, string> = {
  en: "English",
  ar: "Arabic",
  mixed: "Mixed languages",
  other: "Other language",
};

/**
 * The staff-only transcript under a customer's voice note. It sits beside the audio, never in place of it, and is
 * labelled as a machine aid in every state. Nothing here sends the text anywhere: staff can read it or copy it.
 */
export function VoiceTranscriptPanel({ transcript }: { transcript: VoiceTranscriptView }) {
  const refreshInbox = useInboxRefresh();
  const pending = transcript.state === "PENDING";

  // A transcript is prepared in the background and nothing announces it, so while one is pending, look again every few
  // seconds (for about a minute) instead of leaving "Transcribing…" until the person reloads.
  useEffect(() => {
    if (!pending) return;
    let ticks = 0;
    const timer = window.setInterval(() => {
      ticks += 1;
      if (ticks > TRANSCRIPT_POLL_LIMIT) return window.clearInterval(timer);
      refreshInbox();
    }, TRANSCRIPT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [pending, refreshInbox]);

  return (
    <section
      aria-label="Staff-only voice note transcript"
      className="flex max-w-[76%] flex-col gap-2 rounded-sm border border-dashed bg-muted/40 p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-medium">{transcript.headline}</p>
        <ToneBadge tone="neutral" label="Staff only" />
        {transcript.language && <ToneBadge tone="neutral" label={LANGUAGE_LABEL[transcript.language]} />}
        {transcript.state === "LOW_CONFIDENCE" && <ToneBadge tone="warning" label="Low confidence" />}
      </div>

      {transcript.text && (
        <p dir="auto" className="whitespace-pre-wrap wrap-break-word text-sm leading-relaxed">
          {transcript.text}
        </p>
      )}

      <p role={pending ? "status" : undefined} className="text-xs text-muted-foreground">
        {transcript.notice} It is never sent to the customer.
      </p>

      {transcript.text && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <CopyButton textToCopy={transcript.text} />
          <span>Copy the text to use it in your own reply.</span>
        </div>
      )}
    </section>
  );
}
