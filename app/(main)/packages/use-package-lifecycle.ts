"use client";

import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import { useState, useTransition } from "react";

import { toast } from "@/components/ui/toast";

import {
  archivePackageAction,
  deletePackageAction,
  duplicatePackageAction,
  publishExistingPackageAction,
  reopenPackageAction,
  restorePackageAction,
  setPackageFeaturedAction,
  unpublishPackageAction,
} from "./actions";
import type { PendingPackageAction } from "./components/confirm-package-action-dialog";

/**
 * The minimal shape every lifecycle action needs — deliberately narrower
 * than `PackageListItem` (the list's own row type) or `PackageRow` (the
 * detail page's full row) so this hook works from either screen without
 * depending on either one specifically. `PackageListItem` already satisfies
 * this shape directly; the detail page builds one from its `PackageRow` +
 * `PackageUsageSummary` props.
 */
export interface PackageLifecycleTarget {
  id: string;
  title: string;
  code: string;
  status: string;
  featured: boolean;
  groupCount: number;
  liveGroupCount: number;
}

/**
 * Every package lifecycle mutation (publish, unpublish, reopen, feature,
 * archive — with the force-archive-with-a-reason follow-up, restore,
 * duplicate, delete) in one place, shared by the list, its row/context
 * menus, and the detail page — previously each screen re-implemented its
 * own version of this, and the detail page was missing Archive, Restore
 * and Delete entirely (finding E5 in
 * docs/modules/packages-production-readiness-plan.md). Every destructive or
 * customer-visible action still goes through a confirm dialog
 * (`ConfirmPackageActionDialog`/`ForceArchivePackageDialog`) — this hook
 * only decides when to open one and what to do once confirmed.
 *
 * Callers render `<ConfirmPackageActionDialog>` and
 * `<ForceArchivePackageDialog>` once, wired to this hook's `pending`/
 * `forceArchiveTarget` state and `confirmPending`/`forceArchive` handlers,
 * and pass `actions` to whatever row/menu component needs the handlers
 * (`PackageRowActions`-shaped for the list's columns/context menu, or
 * called directly from the detail page's own dropdown).
 */
export function usePackageLifecycle() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pending, setPending] = useState<PendingPackageAction | null>(null);
  const [forceArchiveTarget, setForceArchiveTarget] = useState<{
    pkg: PackageLifecycleTarget;
    liveGroupCount: number;
  } | null>(null);

  const runAction = (
    label: string,
    run: () => Promise<{ ok: boolean; error?: string }>,
  ) => {
    startTransition(async () => {
      const res = await run();
      if (!res.ok) {
        toast.add({ title: `Could not ${label}`, description: res.error });
        return;
      }
      toast.add({ title: `${label[0].toUpperCase()}${label.slice(1)} succeeded` });
      router.refresh();
    });
  };

  const confirmPending = (action: PendingPackageAction) => {
    if (action.type === "ARCHIVE") {
      startTransition(async () => {
        const res = await archivePackageAction(action.pkg.id);
        if (!res.ok) {
          if (res.code === "LIVE_GROUPS") {
            // Not a failure to just toast — offer the ADMIN-only
            // force-archive-with-a-reason path instead. The actual ADMIN
            // requirement is enforced server-side when it is submitted.
            setForceArchiveTarget({
              pkg: action.pkg,
              liveGroupCount: res.liveGroupCount,
            });
            return;
          }
          toast.add({ title: "Could not archive package", description: res.error });
          return;
        }
        toast.add({ title: "Archive package succeeded" });
        router.refresh();
      });
    } else if (action.type === "UNPUBLISH") {
      runAction("unpublish package", () => unpublishPackageAction(action.pkg.id));
    } else if (action.type === "DELETE") {
      startTransition(async () => {
        const res = await deletePackageAction(action.pkg.id);
        if (!res.ok) {
          toast.add({ title: "Could not delete package", description: res.error });
          return;
        }
        toast.add({ title: "Deleted", description: `${action.pkg.title} was deleted.` });
        router.refresh();
      });
    }
  };

  const forceArchive = (reason: string) => {
    const target = forceArchiveTarget;
    if (!target) return;
    startTransition(async () => {
      const res = await archivePackageAction(target.pkg.id, { force: true, reason });
      if (!res.ok) {
        toast.add({ title: "Could not archive package", description: res.error });
        return;
      }
      toast.add({ title: "Package archived" });
      router.refresh();
    });
  };

  const actions = {
    onPublish: (pkg: PackageLifecycleTarget) =>
      runAction("publish package", () => publishExistingPackageAction(pkg.id)),
    onUnpublish: (pkg: PackageLifecycleTarget) => setPending({ type: "UNPUBLISH", pkg }),
    onReopen: (pkg: PackageLifecycleTarget) =>
      runAction("reopen package", () => reopenPackageAction(pkg.id)),
    onToggleFeatured: (pkg: PackageLifecycleTarget) =>
      runAction("update package", () => setPackageFeaturedAction(pkg.id, !pkg.featured)),
    onDuplicate: (pkg: PackageLifecycleTarget) =>
      runAction("duplicate package", () => duplicatePackageAction(pkg.id)),
    onArchive: (pkg: PackageLifecycleTarget) => setPending({ type: "ARCHIVE", pkg }),
    onRestore: (pkg: PackageLifecycleTarget) =>
      runAction("restore package", () => restorePackageAction(pkg.id)),
    onDelete: (pkg: PackageLifecycleTarget) => setPending({ type: "DELETE", pkg }),
  };

  return {
    isPending,
    actions,
    pending,
    closePending: () => setPending(null),
    confirmPending,
    forceArchiveTarget,
    closeForceArchive: () => setForceArchiveTarget(null),
    forceArchive,
  };
}
