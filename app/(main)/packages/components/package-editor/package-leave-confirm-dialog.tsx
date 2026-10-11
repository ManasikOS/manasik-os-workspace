"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PackageLeaveConfirmDialogProps {
  open: boolean;
  /** The package is on sale, so saving goes through the comparison first. */
  isLive: boolean;
  isWorking: boolean;
  onKeepEditing: () => void;
  onDiscard: () => void;
  onSaveAndLeave: () => void;
}

/**
 * Asked when the person tries to leave the package editor with edits that were
 * never saved. Escape and a click outside both mean "Keep editing", never
 * "Discard".
 */
export function PackageLeaveConfirmDialog({
  open,
  isLive,
  isWorking,
  onKeepEditing,
  onDiscard,
  onSaveAndLeave,
}: PackageLeaveConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !isWorking && onKeepEditing()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>You have unsaved changes</DialogTitle>
          <DialogDescription>
            Nothing is saved until you choose to. If you leave now, the changes you made on this page are lost.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline_without_border" disabled={isWorking} onClick={onKeepEditing}>
            Keep editing
          </Button>
          <Button variant="destructive" disabled={isWorking} onClick={onDiscard}>
            Discard changes
          </Button>
          <Button disabled={isWorking} onClick={onSaveAndLeave}>
            {isLive ? "Review and save changes" : "Save draft and leave"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
