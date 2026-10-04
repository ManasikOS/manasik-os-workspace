/**
 * The composer can have several things to say at once: the send failed, replying is blocked, a colleague is writing, a
 * colleague owns the chat. Stacked, they push the message box off the screen. This keeps the most important one in view
 * and counts the rest, so nothing is lost but only one takes room.
 */
export type ComposerNoticeKind = "ERROR" | "BLOCKED" | "PRESENCE" | "OWNERSHIP";

export interface ComposerNotice {
  kind: ComposerNoticeKind;
  message: string;
}

/** Most important first: what just went wrong, then what stops sending, then who else is involved. */
const COMPOSER_NOTICE_PRIORITY: readonly ComposerNoticeKind[] = ["ERROR", "BLOCKED", "PRESENCE", "OWNERSHIP"];

export function pickComposerNotice(candidates: ReadonlyArray<ComposerNotice | null | false | undefined>): {
  primary: ComposerNotice | null;
  others: ComposerNotice[];
} {
  const present = candidates.filter((notice): notice is ComposerNotice => Boolean(notice && notice.message.trim()));
  const ordered = COMPOSER_NOTICE_PRIORITY.flatMap((kind) => {
    const first = present.find((notice) => notice.kind === kind);
    return first ? [first] : [];
  });
  return { primary: ordered[0] ?? null, others: ordered.slice(1) };
}
