"use client";

import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface GroupLeaveConfirmDialogProps {
  open: boolean;
  onKeepEditing: () => void;
  onConfirmDiscard: () => void;
}

/**
 * Asked when the person tries to leave the group editor with edits that were
 * never saved. Nothing is saved until the group is created, so the choices are
 * to keep editing or to discard. Escape and a click outside mean "Keep editing".
 */
export function GroupLeaveConfirmDialog({
  open,
  onKeepEditing,
  onConfirmDiscard,
}: GroupLeaveConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onKeepEditing()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5" aria-hidden /> Discard this departure group?
          </DialogTitle>
          <DialogDescription>
            The group has not been created yet. If you leave now, everything you
            entered on this page is lost.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 border-t border-border/40 pt-3">
          <Button type="button" variant="outline_without_border" onClick={onKeepEditing}>
            Keep editing
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirmDiscard}>
            Discard changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
