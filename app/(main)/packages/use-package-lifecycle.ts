"use client";

import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import { useState, useTransition } from "react";

import { runWithLoadingToast } from "@/components/ui/toast";

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
    messages: { loading: string; success: string },
  ) => {
    startTransition(async () => {
      const res = await runWithLoadingToast(run, {
        loadingTitle: messages.loading,
        successTitle: messages.success,
        errorTitle: `Could not ${label}`,
        getFailureMessage: (result) => (result.ok ? undefined : result.error),
      });
      if (res?.ok) router.refresh();
    });
  };

  const confirmPending = (action: PendingPackageAction) => {
    if (action.type === "ARCHIVE") {
      startTransition(async () => {
        const res = await runWithLoadingToast(
          () => archivePackageAction(action.pkg.id),
          {
            loadingTitle: "Archiving package…",
            successTitle: "Package archived",
            errorTitle: "Could not archive package",
            // Not a failure to just toast — offer the ADMIN-only
            // force-archive-with-a-reason path instead. The actual ADMIN
            // requirement is enforced server-side when it is submitted.
            shouldDismissSilently: (result) =>
              !result.ok && result.code === "LIVE_GROUPS",
            getFailureMessage: (result) => (result.ok ? undefined : result.error),
          },
        );
        if (!res) return;
        if (!res.ok) {
          if (res.code === "LIVE_GROUPS") {
            setForceArchiveTarget({
              pkg: action.pkg,
              liveGroupCount: res.liveGroupCount,
            });
          }
          return;
        }
        router.refresh();
      });
    } else if (action.type === "UNPUBLISH") {
      runAction("unpublish package", () => unpublishPackageAction(action.pkg.id), {
        loading: "Unpublishing package…",
        success: "Package unpublished",
      });
    } else if (action.type === "DELETE") {
      startTransition(async () => {
        const res = await runWithLoadingToast(
          () => deletePackageAction(action.pkg.id),
          {
            loadingTitle: "Deleting package…",
            successTitle: "Package deleted",
            successDescription: `${action.pkg.title} was deleted.`,
            errorTitle: "Could not delete package",
            getFailureMessage: (result) => (result.ok ? undefined : result.error),
          },
        );
        if (res?.ok) router.refresh();
      });
    }
  };

  const forceArchive = (reason: string) => {
    const target = forceArchiveTarget;
    if (!target) return;
    startTransition(async () => {
      const res = await runWithLoadingToast(
        () => archivePackageAction(target.pkg.id, { force: true, reason }),
        {
          loadingTitle: "Archiving package…",
          successTitle: "Package archived",
          errorTitle: "Could not archive package",
          getFailureMessage: (result) => (result.ok ? undefined : result.error),
        },
      );
      if (res?.ok) router.refresh();
    });
  };

  const actions = {
    onPublish: (pkg: PackageLifecycleTarget) =>
      runAction("publish package", () => publishExistingPackageAction(pkg.id), {
        loading: "Publishing package…",
        success: "Package published",
      }),
    onUnpublish: (pkg: PackageLifecycleTarget) => setPending({ type: "UNPUBLISH", pkg }),
    onReopen: (pkg: PackageLifecycleTarget) =>
      runAction("reopen package", () => reopenPackageAction(pkg.id), {
        loading: "Reopening package for sale…",
        success: "Package reopened for sale",
      }),
    onToggleFeatured: (pkg: PackageLifecycleTarget) =>
      runAction(
        "update package",
        () => setPackageFeaturedAction(pkg.id, !pkg.featured),
        {
          loading: pkg.featured ? "Removing from featured…" : "Marking as featured…",
          success: pkg.featured ? "Removed from featured" : "Marked as featured",
        },
      ),
    onDuplicate: (pkg: PackageLifecycleTarget) =>
      runAction("duplicate package", () => duplicatePackageAction(pkg.id), {
        loading: "Duplicating package…",
        success: "Package duplicated",
      }),
    onArchive: (pkg: PackageLifecycleTarget) => setPending({ type: "ARCHIVE", pkg }),
    onRestore: (pkg: PackageLifecycleTarget) =>
      runAction("restore package", () => restorePackageAction(pkg.id), {
        loading: "Restoring package…",
        success: "Package restored",
      }),
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
