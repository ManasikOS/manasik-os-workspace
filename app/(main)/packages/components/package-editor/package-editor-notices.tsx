import { ShieldAlert, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { TONE_CLASS } from "@/lib/ui/tone";

import type { PackageEditSnapshot } from "../../package-edit-snapshot";

export type PendingChangeSummary = NonNullable<PackageEditSnapshot["pendingChange"]>;

function PackageEditorNotice({
  tone,
  icon,
  children,
}: {
  tone: "info" | "warning";
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex shrink-0 items-start gap-2 px-4 py-2 text-[11px] sm:px-5", TONE_CLASS[tone])}>
      {icon}
      <span>{children}</span>
    </div>
  );
}

interface PackageEditorNoticesProps {
  mode: "create" | "edit";
  isLive: boolean;
  canEditSensitiveTerms: boolean;
  liveGroupCount: number;
  pendingChange: PendingChangeSummary | null;
}

/** The notes shown above the open step: a change waiting for approval, live groups, and role limits. */
export function PackageEditorNotices({
  mode,
  isLive,
  canEditSensitiveTerms,
  liveGroupCount,
  pendingChange,
}: PackageEditorNoticesProps) {
  return (
    <>
      {pendingChange ? (
        <PackageEditorNotice tone="info" icon={<ShieldAlert className="mt-0.5 size-3.5 shrink-0" />}>
          A change requested by {pendingChange.requestedByName} is waiting for approval. Fields it changes will show
          the values saved today until it is decided.
        </PackageEditorNotice>
      ) : null}
      {mode === "edit" && liveGroupCount > 0 ? (
        <PackageEditorNotice tone="warning" icon={<TriangleAlert className="mt-0.5 size-3.5 shrink-0" />}>
          {liveGroupCount} live departure group{liveGroupCount === 1 ? " is" : "s are"} already running off this
          template. Saving here never rewrites them — each keeps its own independent price and configuration — it only
          changes what the NEXT group created from this package copies.
        </PackageEditorNotice>
      ) : null}
      {isLive && !canEditSensitiveTerms ? (
        <PackageEditorNotice tone="warning" icon={<TriangleAlert className="mt-0.5 size-3.5 shrink-0" />}>
          This package is on sale. You can edit its display text, but your role cannot change its payment or booking
          terms.
        </PackageEditorNotice>
      ) : null}
    </>
  );
}
