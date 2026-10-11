"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface DiscardConfirmDialogProps {
  open: boolean;
  onKeepEditing: () => void;
  onConfirmDiscard: () => void;
}

export default function DiscardConfirmDialog({
  open,
  onKeepEditing,
  onConfirmDiscard,
}: DiscardConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(val) => !val && onKeepEditing()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5" /> Discard unsaved lead?
          </DialogTitle>
          <DialogDescription>
            You have entered information for this new lead. If you close now,
            all unsaved details will be lost.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2 border-t pt-3 border-border/40">
          <Button
            type="button"
            variant="outline_without_border"
            onClick={onKeepEditing}
          >
            Keep Editing
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirmDiscard}
          >
            Discard Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
