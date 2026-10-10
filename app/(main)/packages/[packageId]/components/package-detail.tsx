"use client";

import PageHeader from "@/components/page-header";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/animate/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PackageCapabilities } from "@/lib/access/packages-access";
import type { PackageRow } from "@/lib/types/database";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Calendar,
  Clock,
  Copy,
  MoreVertical,
  Pencil,
  PlusCircle,
  Send,
  Star,
  Trash2,
  Users,
} from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useState } from "react";

import {
  JourneyTypeBadge,
  PackageStatusBadge,
  VisibilityBadge,
} from "../../components/package-status-badges";
import ConfirmPackageActionDialog from "../../components/confirm-package-action-dialog";
import DeletePackageDialog from "../../components/delete-package-dialog";
import ForceArchivePackageDialog from "../../components/force-archive-package-dialog";
import { usePackageLifecycle } from "../../use-package-lifecycle";
import type {
  DepartureGroupUsingPackage,
  PackageUsageSummary,
} from "@/lib/data/packages-repository";
import type { PackageActivityLog } from "@/lib/types/packages";
import type { PackageChangeRequest } from "@/lib/data/packages-repository";
import PackageChangeRequestsPanel from "../../components/package-change-requests-panel";
import ActivityTab from "./tabs/activity-tab";
import GroupDefaultsTab from "./tabs/group-defaults-tab";
import GroupsTab from "./tabs/groups-tab";
import JourneyTab from "./tabs/journey-tab";
import OverviewTab from "./tabs/overview-tab";
import PricingTab from "./tabs/pricing-tab";
import RequirementsTab from "./tabs/requirements-tab";
import ServicesTab from "./tabs/services-tab";
import { Card } from "@/components/ui/card";

export type PackageDetailTabId =
  | "overview"
  | "pricing"
  | "journey"
  | "services"
  | "requirements"
  | "group-defaults"
  | "groups"
  | "activity";

const TABS: { id: PackageDetailTabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "pricing", label: "Pricing & Payments" },
  // Flight routing moved to Departure Group creation — this tab is the
  // reusable journey template only, never flights. See
  // docs/modules/packages-production-readiness-plan.md, finding E8.
  { id: "journey", label: "Journey" },
  { id: "services", label: "Services & Accommodation" },
  { id: "requirements", label: "Traveller Requirements" },
  { id: "group-defaults", label: "Group Defaults" },
  { id: "groups", label: "Departure Groups" },
  { id: "activity", label: "Activity" },
];

interface PackageDetailProps {
  pkg: PackageRow;
  usage: PackageUsageSummary;
  groups: DepartureGroupUsingPackage[];
  activity: PackageActivityLog[];
  /** Changes to payment/contract/booking terms waiting for an administrator's approval. */
  pendingChanges: PackageChangeRequest[];
  /** Past reviewed changes (decided, applied, withdrawn or expired), newest first, for the Activity tab. */
  changeHistory: PackageChangeRequest[];
  currentUserId: string | null;
  /**
   * Resolved server-side (`[packageId]/page.tsx`) via
   * `loadDynamicCapabilities` — see `PackagesList`'s identical `can` prop
   * comment and docs/modules/packages-production-readiness-plan.md, finding A4.
   */
  can: PackageCapabilities;
  initialTab: PackageDetailTabId;
}

/**
 * Read-only package detail — the module's missing "just let me look at it"
 * screen. Same shell as the Departure Group detail: tabs drive `?tab=`, and
 * only the active tab is mounted.
 *
 * Every lifecycle action (publish, unpublish, reopen, feature, archive,
 * restore, delete) goes through `usePackageLifecycle()`, the same hook the
 * list uses — this menu previously had none of Archive, Restore or Delete
 * at all (finding E5). Edit navigates to the full-page editor at
 * `/packages/[id]/edit` (TASK-044).
 */
const PackageDetail = ({
  pkg,
  usage,
  groups,
  activity,
  pendingChanges,
  changeHistory,
  currentUserId,
  can,
  initialTab,
}: PackageDetailProps) => {
  const router = useRouter();
  const lifecycle = usePackageLifecycle();
  const [tab, setTab] = useState<PackageDetailTabId>(initialTab);

  const lifecycleTarget = {
    id: pkg.id,
    title: pkg.title || "Untitled package",
    code: pkg.internal_code,
    status: pkg.status,
    featured: pkg.featured,
    groupCount: usage.groupCount,
    liveGroupCount: usage.liveGroupCount,
  };

  const goToTab = (next: PackageDetailTabId) => {
    setTab(next);
    // A shallow history update, not `router.replace()` — only the `?tab=`
    // query is changing, not which package this page shows, so a real
    // Next.js navigation would re-run this page's server component and
    // refetch the package purely to update a bookmarkable URL, on every
    // single tab click. Same reasoning as the wizard's step-in-URL fix —
    // see docs/modules/packages-production-readiness-plan.md, finding E1.
    window.history.replaceState(null, "", `/packages/${pkg.id}?tab=${next}`);
  };

  const renderTab = () => {
    switch (tab) {
      case "overview":
        return <OverviewTab pkg={pkg} usage={usage} onNavigate={goToTab} />;
      case "pricing":
        return <PricingTab pkg={pkg} />;
      case "journey":
        return <JourneyTab pkg={pkg} />;
      case "services":
        return <ServicesTab pkg={pkg} />;
      case "requirements":
        return <RequirementsTab pkg={pkg} />;
      case "group-defaults":
        return <GroupDefaultsTab pkg={pkg} />;
      case "groups":
        return <GroupsTab groups={groups} />;
      case "activity":
        return <ActivityTab activity={activity} changeHistory={changeHistory} />;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full mx-auto pb-10">
      <ConfirmPackageActionDialog
        pending={lifecycle.pending}
        onClose={lifecycle.closePending}
        onConfirmed={lifecycle.confirmPending}
      />
      <DeletePackageDialog
        key={lifecycle.deleteTarget?.id ?? "none"}
        pkg={lifecycle.deleteTarget}
        onClose={lifecycle.closeDelete}
        onDeleted={() => {
          lifecycle.closeDelete();
          router.push("/packages");
          router.refresh();
        }}
      />
      <ForceArchivePackageDialog
        pkg={lifecycle.forceArchiveTarget?.pkg ?? null}
        liveGroupCount={lifecycle.forceArchiveTarget?.liveGroupCount ?? 0}
        onClose={lifecycle.closeForceArchive}
        onConfirm={lifecycle.forceArchive}
      />

      <PageHeader
        subTitle="Package template details."
        title={pkg.title || "Untitled package"}
        breadcrumb={[
          { title: "Home", link: "/dashboard" },
          { title: "Packages", link: "/packages" },
          { title: pkg.title || "Package", link: `/packages/${pkg.id}` },
        ]}
        action={
          <div className="flex items-center gap-3">
            <Button
              variant="outline_without_border"
              size="sm"
              onClick={() => router.push("/packages")}
              className="gap-1.5 text-xs font-medium bg-transparent! shadow-none!"
            >
              <ArrowLeft className="size-3.5" /> Back to Packages
            </Button>
            {can.editPackage && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => router.push(`/packages/${pkg.id}/edit`)}
              >
                <Pencil className="size-3.5" /> Edit
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline_without_border"
                    size="icon"
                    aria-label="More actions"
                  >
                    <MoreVertical />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                {can.duplicatePackage && (
                  <DropdownMenuItem
                    onClick={() =>
                      lifecycle.actions.onDuplicate(lifecycleTarget)
                    }
                  >
                    <Copy /> Duplicate
                  </DropdownMenuItem>
                )}
                {can.createGroupFromPackage &&
                  pkg.status === "Open for Sale" && (
                    <DropdownMenuItem
                      onClick={() =>
                        router.push(
                          `/departure-groups?create=1&template=${pkg.id}`,
                        )
                      }
                    >
                      <PlusCircle /> Create Departure Group
                    </DropdownMenuItem>
                  )}
                {can.toggleFeatured && (
                  <DropdownMenuItem
                    onClick={() =>
                      lifecycle.actions.onToggleFeatured(lifecycleTarget)
                    }
                  >
                    <Star /> {pkg.featured ? "Unfeature" : "Feature"}
                  </DropdownMenuItem>
                )}
                {can.publishPackage && (
                  <>
                    <DropdownMenuSeparator />
                    {pkg.status === "Draft" ? (
                      <DropdownMenuItem
                        onClick={() =>
                          lifecycle.actions.onPublish(lifecycleTarget)
                        }
                      >
                        <Send /> Publish
                      </DropdownMenuItem>
                    ) : pkg.status === "Open for Sale" ? (
                      <DropdownMenuItem
                        onClick={() =>
                          lifecycle.actions.onUnpublish(lifecycleTarget)
                        }
                      >
                        <Send /> Unpublish
                      </DropdownMenuItem>
                    ) : pkg.status === "Sales Closed" ? (
                      <DropdownMenuItem
                        onClick={() =>
                          lifecycle.actions.onReopen(lifecycleTarget)
                        }
                      >
                        <Send /> Reopen for Sale
                      </DropdownMenuItem>
                    ) : null}
                  </>
                )}
                {can.archiveOrRestorePackage && (
                  <>
                    <DropdownMenuSeparator />
                    {pkg.status === "Archived" ? (
                      <DropdownMenuItem
                        onClick={() =>
                          lifecycle.actions.onRestore(lifecycleTarget)
                        }
                      >
                        <ArchiveRestore /> Restore
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        onClick={() =>
                          lifecycle.actions.onArchive(lifecycleTarget)
                        }
                      >
                        <Archive /> Archive
                      </DropdownMenuItem>
                    )}
                  </>
                )}
                {can.deletePackage && (
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={usage.groupCount > 0 || (pkg.status !== "Draft" && pkg.status !== "Archived")}
                    onClick={() => lifecycle.actions.onDelete(lifecycleTarget)}
                  >
                    <Trash2 />
                    {usage.groupCount > 0
                      ? `Delete (used by ${usage.groupCount})`
                      : pkg.status === "Draft" || pkg.status === "Archived"
                        ? "Delete Package"
                        : "Delete (archive it first)"}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className="text-xs tabular-nums text-muted-foreground"
        >
          {pkg.internal_code}
        </Badge>
        <JourneyTypeBadge value={pkg.journey_type} />
        <PackageStatusBadge value={pkg.status} />
        <VisibilityBadge value={pkg.visibility} />
        {pkg.featured && (
          <Badge className="bg-primary/10 text-primary border-none text-[10px] font-semibold px-2 py-0.5">
            <Star className="size-3 me-1 fill-primary text-primary" />
            Featured
          </Badge>
        )}
      </div>

      <Card className="flex flex-row items-center gap-6 rounded-md border border-border/40 bg-card/50 px-4 py-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Clock className="size-3.5 text-primary" /> {pkg.duration}
        </span>
        <span className="flex items-center gap-1.5">
          <Users className="size-3.5" /> {usage.liveGroupCount} live group
          {usage.liveGroupCount === 1 ? "" : "s"} · {usage.seatsBooked}/
          {usage.seatsCapacity} seats
        </span>
        {pkg.published_at && (
          <span className="flex items-center gap-1.5">
            <Calendar className="size-3.5" /> Published{" "}
            {new Date(pkg.published_at).toLocaleDateString()}
          </span>
        )}
      </Card>

      <PackageChangeRequestsPanel requests={pendingChanges} can={can} currentUserId={currentUserId} />

      <div>
        <Tabs
          value={tab}
          onValueChange={(next) => goToTab(next as PackageDetailTabId)}
        >
          <TabsList className="flex-wrap h-auto">
            {TABS.map((entry) => (
              <TabsTrigger key={entry.id} value={entry.id}>
                {entry.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* Only the active tab is mounted. */}
        <div className="min-h-100 mt-5">{renderTab()}</div>
      </div>
    </div>
  );
};

export default PackageDetail;
