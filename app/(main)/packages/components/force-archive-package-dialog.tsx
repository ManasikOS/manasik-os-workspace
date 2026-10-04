"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { TONE_CLASS } from "@/lib/ui/tone";
import { TriangleAlert } from "lucide-react";

import type { PackageLifecycleTarget } from "../use-package-lifecycle";

/**
 * Follow-up dialog shown when `archivePackageAction` refuses a normal
 * archive with `code: "LIVE_GROUPS"` — the package still has live departure
 * groups selling off it. Archiving anyway is an ADMIN-only override that
 * requires a stated reason (enforced again, authoritatively, by
 * `archive_package()` in
 * supabase/migrations/20261006090000_packages_lifecycle_phase1.sql — this
 * dialog only makes that requirement visible before the call is made). See
 * docs/modules/packages-production-readiness-plan.md, finding B3.
 */
interface ForceArchivePackageDialogProps {
  pkg: PackageLifecycleTarget | null;
  liveGroupCount: number;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

const ForceArchivePackageDialog = ({
  pkg,
  liveGroupCount,
  onClose,
  onConfirm,
}: ForceArchivePackageDialogProps) => {
  const [reason, setReason] = useState("");

  if (!pkg) return null;

  const trimmed = reason.trim();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Archive despite live departure groups?</DialogTitle>
          <DialogDescription>
            {pkg.title} still has {liveGroupCount} live departure group
            {liveGroupCount === 1 ? "" : "s"} selling off it. Archiving hides
            it from the create-group picker and the sales catalogue — the
            groups themselves are never affected.
          </DialogDescription>
        </DialogHeader>

        <div
          className={`flex items-start gap-2 rounded-sm px-3 py-2 text-xs ${TONE_CLASS.warning}`}
        >
          <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
          <span>
            This is an administrator-only override. A reason is required and
            is kept on the package&apos;s activity log.
          </span>
        </div>

        <Textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why archive this package while it still has live groups?"
          rows={3}
        />

        <DialogFooter>
          <Button variant="outline_without_border" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!trimmed}
            onClick={() => {
              onConfirm(trimmed);
              onClose();
            }}
          >
            Force Archive
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ForceArchivePackageDialog;
