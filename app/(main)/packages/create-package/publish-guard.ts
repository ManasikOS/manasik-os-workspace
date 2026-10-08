/**
 * Decides whether the wizard may go on to publish after it has flushed the
 * pending draft (TASK-041).
 *
 * `handlePublish` used to ignore whether that flush worked. When the very
 * first save failed, the draft row never existed, so publish ran with a null
 * id and attempted a second insert that failed the same way — the user then
 * only saw the second, raw database error. Publishing is refused whenever the
 * flush before it failed, and the flush's own reason is what the user sees.
 *
 * A plain function (no React) so the rule can be unit-tested.
 */

export type DraftFlushForPublish = {
  ok: boolean;
  packageId: string | null;
  updatedAt: string | null;
  code?: "STALE";
  error?: string;
  step?: number;
};

export type PublishAfterSaveDecision =
  | { proceed: true; packageId: string | null; updatedAt: string | null }
  | { proceed: false; message: string; step?: number };

export function decidePublishAfterDraftSave(flush: DraftFlushForPublish): PublishAfterSaveDecision {
  if (flush.ok) {
    return { proceed: true, packageId: flush.packageId, updatedAt: flush.updatedAt };
  }
  if (flush.code === "STALE") {
    return {
      proceed: false,
      message: "This package changed in another tab, so it was not published. Reload and try again.",
    };
  }
  return {
    proceed: false,
    step: flush.step,
    message: flush.error ?? "Your latest changes could not be saved, so the package was not published. Please try again.",
  };
}
