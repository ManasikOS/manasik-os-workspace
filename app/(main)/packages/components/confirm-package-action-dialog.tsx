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
import React from "react";

import type { PackageLifecycleTarget } from "../use-package-lifecycle";
import { Card } from "@/components/ui/card";

export type PendingPackageActionType = "ARCHIVE" | "UNPUBLISH";

export interface PendingPackageAction {
  type: PendingPackageActionType;
  pkg: PackageLifecycleTarget;
}

interface Copy {
  title: string;
  description: (pkg: PackageLifecycleTarget) => string;
  confirmLabel: string;
  destructive: boolean;
}

const COPY: Record<PendingPackageActionType, Copy> = {
  ARCHIVE: {
    title: "Archive this package?",
    description: (pkg) =>
      pkg.liveGroupCount > 0
        ? `${pkg.liveGroupCount} live departure group${
            pkg.liveGroupCount === 1 ? " is" : "s are"
          } still running off this template — archiving does not affect them, ` +
          `it only stops it appearing when someone creates a NEW group. It stays readable and can be restored at any time.`
        : "It moves out of the active catalogue into the Archived view. It stays readable and can be restored at any time.",
    confirmLabel: "Archive Package",
    destructive: true,
  },
  UNPUBLISH: {
    title: "Unpublish this package?",
    description: () =>
      "It moves to Sales Closed and stops appearing to sales staff and Manasik Copilot as a sellable option. Existing departure groups built from it are unaffected.",
    confirmLabel: "Unpublish",
    destructive: false,
  },
};

interface ConfirmPackageActionDialogProps {
  pending: PendingPackageAction | null;
  onClose: () => void;
  onConfirmed: (action: PendingPackageAction) => void;
}

const ConfirmPackageActionDialog = ({
  pending,
  onClose,
  onConfirmed,
}: ConfirmPackageActionDialogProps) => {
  if (!pending) return null;
  const copy = COPY[pending.type];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description(pending.pkg)}</DialogDescription>
        </DialogHeader>

        <Card variant="md-shadow" className="rounded-sm  px-3 gap-1 py-2 ">
          <p className="font-medium text-foreground">{pending.pkg.title}</p>
          <p className="text-muted-foreground tabular-nums mt-0.5">
            {pending.pkg.code}
          </p>
        </Card>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={copy.destructive ? "destructive" : "default"}
            onClick={() => {
              onConfirmed(pending);
              onClose();
            }}
          >
            {copy.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ConfirmPackageActionDialog;
