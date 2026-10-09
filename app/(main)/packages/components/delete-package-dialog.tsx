"use client";

import { useEffect, useState, useTransition } from "react";
import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { runWithLoadingToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { TONE_CLASS } from "@/lib/ui/tone";

import { deleteBlocker, deleteSideEffects, type PackageDeleteImpact } from "@/lib/packages/delete-impact";

import { deletePackageAction, getPackageDeleteImpactAction } from "../actions";
import type { PackageLifecycleTarget } from "../use-package-lifecycle";

/**
 * Deleting a package (TASK-043). It is permanent, so it is slow on purpose: the person sees what the delete would touch, types the package code, and says
 * why. The package, its history and the impact are kept in a deletion record. Only a Draft or an Archived package can be deleted; the database refuses
 * anything else, and refuses while departure groups, lead quotes or agent submissions refer to the package.
 */
interface DeletePackageDialogProps {
  pkg: PackageLifecycleTarget | null;
  onClose: () => void;
  onDeleted: (pkg: PackageLifecycleTarget) => void;
}

type ImpactState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; impact: PackageDeleteImpact; code: string; updatedAt: string };

export default function DeletePackageDialog({ pkg, onClose, onDeleted }: DeletePackageDialogProps) {
  const [state, setState] = useState<ImpactState>({ phase: "loading" });
  const [confirmCode, setConfirmCode] = useState("");
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const packageId = pkg?.id ?? null;

  useEffect(() => {
    if (!packageId) return;
    let cancelled = false;
    getPackageDeleteImpactAction(packageId).then((result) => {
      if (cancelled) return;
      setState(
        result.ok
          ? { phase: "ready", impact: result.impact, code: result.code, updatedAt: result.updatedAt }
          : { phase: "error", message: result.error },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [packageId]);

  if (!pkg) return null;

  const blocker = state.phase === "ready" ? deleteBlocker(state.impact) : null;
  const effects = state.phase === "ready" ? deleteSideEffects(state.impact) : [];
  const codeMatches = state.phase === "ready" && confirmCode.trim().toLowerCase() === state.code.toLowerCase();
  const canDelete = state.phase === "ready" && !blocker && codeMatches && reason.trim().length > 0 && !isPending;

  const confirmDelete = () => {
    if (state.phase !== "ready") return;
    const ready = state;
    startTransition(async () => {
      const result = await runWithLoadingToast(
        () => deletePackageAction({ packageId: pkg.id, expectedUpdatedAt: ready.updatedAt, confirmCode: confirmCode.trim(), reason: reason.trim() }),
        {
          loadingTitle: "Deleting package…",
          successTitle: "Package deleted",
          successDescription: `${pkg.title} was deleted and a record of it was kept.`,
          errorTitle: "Could not delete package",
          getFailureMessage: (response) => (response.ok ? undefined : response.error),
        },
      );
      if (result?.ok) onDeleted(pkg);
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !isPending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Delete this package?</DialogTitle>
          <DialogDescription>
            This cannot be undone. A record of the package and its history is kept for administrators, but the package itself cannot be brought back.
          </DialogDescription>
        </DialogHeader>

        <Card variant="md-shadow" className="gap-1 rounded-sm px-3 py-2">
          <p className="font-medium text-foreground">{pkg.title}</p>
          <p className="mt-0.5 tabular-nums text-muted-foreground">{pkg.code}</p>
        </Card>

        {state.phase === "loading" ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : null}

        {state.phase === "error" ? <p className="text-sm text-destructive">{state.message}</p> : null}

        {blocker ? (
          <div className={cn("flex items-start gap-2 rounded-sm px-3 py-2 text-xs", TONE_CLASS.danger)}>
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>This package cannot be deleted. {blocker}</span>
          </div>
        ) : null}

        {state.phase === "ready" && !blocker ? (
          <>
            {effects.length > 0 ? (
              <ul className={cn("space-y-1 rounded-sm px-3 py-2 text-xs", TONE_CLASS.warning)}>
                {effects.map((effect) => (
                  <li key={effect}>{effect}</li>
                ))}
              </ul>
            ) : null}

            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Type {state.code} to confirm</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput value={confirmCode} onChange={(event) => setConfirmCode(event.target.value)} autoComplete="off" spellCheck={false} />
            </InputGroup>

            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Why is it being deleted?</InputGroupText>
              </InputGroupAddon>
              <InputGroupTextarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={500} />
            </InputGroup>
          </>
        ) : null}

        <DialogFooter>
          <Button variant="outline_without_border" disabled={isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!canDelete} onClick={confirmDelete}>
            {isPending ? "Deleting…" : "Delete package"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
