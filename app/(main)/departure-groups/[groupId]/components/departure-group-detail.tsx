"use client";

import PageHeader from "@/components/page-header";
import { useDepartureCapabilities } from "@/app/(main)/departure-groups/capabilities-context";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/animate/tabs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { capabilitiesForVault } from "@/lib/access/vault-access";
import { type StaffRole } from "@/lib/access/departure-groups-access";
import {
  Archive,
  Ban,
  CalendarDays,
  CheckCheck,
  FileText,
  GitCompare,
  Lock,
  LockOpen,
  MoreVertical,
  Pencil,
  PlaneLanding,
  PlaneTakeoff,
  Plus,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useCallback, useState, useTransition } from "react";

import { cn } from "@/lib/utils";
import { TONE_TEXT } from "@/lib/ui/tone";
import AddBookingSheet from "../../components/add-booking-sheet";
import ConfirmActionDialog, {
  type PendingGroupAction,
} from "../../components/confirm-action-dialog";
import {
  GroupStatusBadge,
  JourneyTypeBadge,
  ReadinessStatusBadge,
  SalesStatusBadge,
} from "../../components/status-badges";
import {
  DEPARTURE_GROUP_TABS,
  type DepartureGroupDetail,
  type DepartureGroupTabId,
  type MoveTargetGroupOption,
} from "../../types";
import { departureCountdown, formatDate } from "../../utils";
import {
  archiveDepartureGroupAction,
  setGroupLifecycleAction,
} from "../../actions";
import { createDepartureGroupBrochureAction } from "../brochure-actions";
import EditGroupDetailsSheet from "./edit-group-details-sheet";
import TemplateComparisonDialog from "./template-comparison-dialog";
import ActivityTab from "./tabs/activity-tab";
import AgentTab from "./tabs/agent-tab";
import DocumentsVisaTab from "./tabs/documents-visa-tab";
import FlightsTab from "./tabs/flights-tab";
import GuideOperationsTab from "./tabs/guide-operations-tab";
import HotelsRoomsTab from "./tabs/hotels-rooms-tab";
import OverviewTab from "./tabs/overview-tab";
import PaymentsTab from "./tabs/payments-tab";
import PilgrimsBookingsTab from "./tabs/pilgrims-bookings-tab";
import ReadinessTab from "./tabs/readiness-tab";
import TransportTab from "./tabs/transport-tab";
import type { GroupAgentPanel } from "@/lib/data/departure-groups-agent";

interface DepartureGroupDetailViewProps {
  detail: DepartureGroupDetail;
  role: StaffRole;
  /** Groups a booking can be moved into. Empty for roles that cannot move one. */
  moveTargets: MoveTargetGroupOption[];
  /** Branch choices for the edit sheet. */
  branches: string[];
  /** Departure Operations Agent state/findings/proposals for this group. */
  agentPanel: GroupAgentPanel;
  visibleTabs: DepartureGroupTabId[];
  initialTab: DepartureGroupTabId;
  /** Open the Add Booking sheet on mount (from the list's `?add=1` deep link). */
  initialAddBooking?: boolean;
  /** Open the edit sheet on mount (from the list's `?edit=1` deep link). */
  initialEdit?: boolean;
  /** Open the template comparison on mount (from the list's `?compare=1`). */
  initialCompare?: boolean;
}

/**
 * The control center shell: identity and live counts up top, everything
 * operational behind tabs. Overview owns the signals; the tabs own the detail.
 */
const DepartureGroupDetailView = ({
  detail,
  role,
  moveTargets,
  branches,
  agentPanel,
  visibleTabs,
  initialTab,
  initialAddBooking = false,
  initialEdit = false,
  initialCompare = false,
}: DepartureGroupDetailViewProps) => {
  const can = useDepartureCapabilities(role);
  const canCreateBrochure = capabilitiesForVault(role).manageVault;
  const { group } = detail;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isGeneratingBrochure, setIsGeneratingBrochure] = useState(false);

  const handleCreateBrochure = useCallback(async () => {
    setIsGeneratingBrochure(true);
    try {
      const result = await createDepartureGroupBrochureAction({
        departureGroupId: group.id,
      });
      if (result.ok) {
        toast.add({
          title: "Brochure generated",
          description:
            "Saved to the Document Vault, under Brochure — ready to send.",
        });
      } else {
        toast.add({
          title: "Could not generate the brochure",
          description: result.error,
        });
      }
    } finally {
      setIsGeneratingBrochure(false);
    }
  }, [group.id]);

  const [tab, setTab] = useState<DepartureGroupTabId>(initialTab);
  const [pending, setPending] = useState<PendingGroupAction | null>(null);
  const [addBookingOpen, setAddBookingOpen] = useState(
    initialAddBooking && can.addBookings,
  );
  const [editOpen, setEditOpen] = useState(initialEdit && can.editGroupDetails);
  const [compareOpen, setCompareOpen] = useState(initialCompare);

  /**
   * A blocker or category bar can ask for a specific slice of its destination
   * tab — "the visa queue", "the overdue balances" — not just the tab itself.
   * The active filter is handed to the tab, which clears it once consumed.
   */
  const [tabFilter, setTabFilter] = useState<string | null>(null);

  const openAddBooking = () => setAddBookingOpen(true);

  /** Every blocker, bar and supplier line routes through here. */
  const goToTab = useCallback((next: DepartureGroupTabId, filter?: string) => {
    setTab(next);
    setTabFilter(filter ?? null);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  /**
   * Persists a group-level decision. Archive has its own action; the rest go
   * through the lifecycle action, which cascades into bookings when cancelling.
   */
  const runGroupAction = (action: PendingGroupAction) => {
    startTransition(async () => {
      if (action.type === "ARCHIVE") {
        const result = await archiveDepartureGroupAction(group.id);
        if (!result.ok) {
          toast.add({
            title: "Could not archive group",
            description: result.error,
          });
          return;
        }
        toast.add({
          title: "Group archived",
          description: `${result.groupName} moved to archived groups.`,
        });
        router.push("/departure-groups");
        return;
      }

      const result = await setGroupLifecycleAction({
        groupId: group.id,
        action: action.type,
        ...(action.type === "CANCEL"
          ? { reason: action.reason?.trim() || "Departure group cancelled." }
          : {}),
      });

      if (!result.ok) {
        toast.add({
          title: "Could not update group",
          description: result.error,
        });
        return;
      }

      toast.add({
        title:
          action.type === "CANCEL"
            ? "Group cancelled"
            : action.type === "MARK_READY"
              ? "Marked ready to depart"
              : action.type === "REOPEN_SALES"
                ? "Sales reopened"
                : "Sales closed",
        description:
          action.type === "CANCEL"
            ? `${result.groupName}: ${result.cancelledBookings} booking${
                result.cancelledBookings === 1 ? "" : "s"
              } withdrawn.`
            : result.groupName,
      });
      router.refresh();
    });
  };

  const tabs = DEPARTURE_GROUP_TABS.filter((entry) =>
    visibleTabs.includes(entry.id),
  );

  const salesClosed = group.salesStatus === "SALES_CLOSED";
  const isCancelled = group.groupStatus === "CANCELLED";

  const renderTab = () => {
    switch (tab) {
      case "overview":
        return (
          <OverviewTab
            overview={detail.overview}
            snapshot={detail.snapshot}
            pricing={detail.pricing}
            costing={detail.costing}
            bookingCount={detail.bookings.length}
            role={role}
            onNavigate={goToTab}
            agentState={
              agentPanel.state
                ? {
                    lastRunAt: agentPanel.state.lastRunAt,
                    nextRunAt: agentPanel.state.nextRunAt,
                  }
                : null
            }
          />
        );
      case "pilgrims":
        return (
          <PilgrimsBookingsTab
            manifest={detail.manifest}
            bookings={detail.bookings}
            group={group}
            snapshot={detail.snapshot}
            pricing={detail.pricing}
            moveTargets={moveTargets}
            activity={detail.activity}
            role={role}
            flights={detail.flights}
            accommodations={detail.accommodations}
            transports={detail.transports}
            serviceAddons={detail.serviceAddons}
          />
        );
      case "flights":
        return (
          <FlightsTab
            groupId={group.id}
            groupDepartureDate={group.departureDate}
            groupReturnDate={group.returnDate}
            flights={detail.flights}
            manifest={detail.manifest}
            role={role}
          />
        );
      case "hotels":
        return (
          <HotelsRoomsTab
            groupId={group.id}
            groupCode={group.groupCode}
            accommodations={detail.accommodations}
            manifest={detail.manifest}
            role={role}
          />
        );
      case "transport":
        return (
          <TransportTab
            groupId={group.id}
            transports={detail.transports}
            manifest={detail.manifest}
            role={role}
          />
        );
      case "payments":
        return (
          <PaymentsTab
            payments={detail.payments}
            bookings={detail.bookings}
            manifest={detail.manifest}
            pricing={detail.pricing}
            group={group}
            activity={detail.activity}
            role={role}
          />
        );
      case "documents":
        return (
          <DocumentsVisaTab
            manifest={detail.manifest}
            bookings={detail.bookings}
            group={group}
            activity={detail.activity}
            snapshot={detail.snapshot}
            role={role}
            initialFilter={tabFilter}
          />
        );
      case "readiness":
        return (
          <ReadinessTab
            items={detail.readinessItems}
            summary={detail.overview.readiness}
            role={role}
          />
        );
      case "guide":
        return (
          <GuideOperationsTab
            group={group}
            tasks={detail.tasks}
            flights={detail.flights}
            transports={detail.transports}
            readinessItems={detail.readinessItems}
            role={role}
          />
        );
      case "agent":
        return <AgentTab groupId={group.id} panel={agentPanel} role={role} />;
      case "activity":
        return (
          <ActivityTab departureGroupId={group.id} activity={detail.activity} />
        );
      default:
        return null;
    }
  };

  return (
    <>
      <ConfirmActionDialog
        pending={pending}
        onClose={() => setPending(null)}
        onConfirmed={runGroupAction}
      />
      {can.addBookings && (
        <AddBookingSheet
          open={addBookingOpen}
          onOpenChange={setAddBookingOpen}
          group={group}
          pricing={detail.pricing}
          existingBookingCount={detail.bookings.length}
          role={role}
        />
      )}
      {can.editGroupDetails && (
        <EditGroupDetailsSheet
          group={group}
          pricing={detail.pricing}
          costing={detail.costing}
          branches={branches}
          role={role}
          open={editOpen}
          onClose={() => setEditOpen(false)}
        />
      )}
      <TemplateComparisonDialog
        group={group}
        snapshot={detail.snapshot}
        pricing={detail.pricing}
        accommodations={detail.accommodations}
        transports={detail.transports}
        readinessItems={detail.readinessItems}
        role={role}
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
      />

      <div className="mx-auto flex w-full flex-col gap-8 pb-10">
        <div>
          <PageHeader
            title={group.groupName}
            breadcrumb={[
              { title: "Departure Groups", link: "/departure-groups" },
              { title: group.groupName, link: `/departure-groups/${group.id}` },
            ]}
            subTitle={
              <>
                {group.groupCode} · From:{" "}
                {/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                  group.packageTemplateId,
                ) ? (
                  <a
                    href={`/packages/${group.packageTemplateId}?tab=groups`}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    {group.packageTemplateName}
                  </a>
                ) : (
                  group.packageTemplateName
                )}
              </>
            }
            action={
              <div className="flex items-center gap-3">
                {can.addBookings && !isCancelled && (
                  <Button variant="default" onClick={openAddBooking}>
                    <Plus /> Add Booking
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="outline_without_border"
                        aria-label="More group actions"
                      >
                        <MoreVertical />
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end">
                    {can.editGroupDetails && !isCancelled && (
                      <DropdownMenuItem onClick={() => setEditOpen(true)}>
                        <Pencil /> Edit Group Details
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => setCompareOpen(true)}>
                      <GitCompare /> Compare with Package Template
                    </DropdownMenuItem>
                    {canCreateBrochure && (
                      <DropdownMenuItem
                        disabled={isGeneratingBrochure}
                        onClick={handleCreateBrochure}
                      >
                        <FileText />{" "}
                        {isGeneratingBrochure
                          ? "Generating Brochure…"
                          : "Create Brochure (PDF)"}
                      </DropdownMenuItem>
                    )}
                    {can.editGroupDetails && !isCancelled && (
                      <>
                        <DropdownMenuSeparator />
                        {salesClosed ? (
                          <DropdownMenuItem
                            disabled={isPending}
                            onClick={() =>
                              setPending({ type: "REOPEN_SALES", group })
                            }
                          >
                            <LockOpen /> Reopen Sales
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            disabled={isPending}
                            onClick={() =>
                              setPending({ type: "CLOSE_SALES", group })
                            }
                          >
                            <Lock /> Close Sales
                          </DropdownMenuItem>
                        )}
                        {/* The lifecycle runs PLANNING → PREPARING → READY →
                            DEPARTED → COMPLETED → CLOSED. Only the step the
                            group is actually at is offered, so the menu reads
                            as the next thing to do rather than a list of
                            states. */}
                        {group.groupStatus !== "READY_TO_DEPART" &&
                          group.groupStatus !== "DEPARTED" &&
                          group.groupStatus !== "COMPLETED" &&
                          group.groupStatus !== "CLOSED" && (
                            <DropdownMenuItem
                              disabled={isPending}
                              onClick={() =>
                                setPending({ type: "MARK_READY", group })
                              }
                            >
                              <ShieldCheck /> Mark Ready to Depart
                            </DropdownMenuItem>
                          )}
                        {group.groupStatus === "READY_TO_DEPART" && (
                          <DropdownMenuItem
                            disabled={isPending}
                            onClick={() =>
                              setPending({ type: "MARK_DEPARTED", group })
                            }
                          >
                            <PlaneTakeoff /> Record Departure
                          </DropdownMenuItem>
                        )}
                        {group.groupStatus === "DEPARTED" && (
                          <DropdownMenuItem
                            disabled={isPending}
                            onClick={() =>
                              setPending({ type: "MARK_COMPLETED", group })
                            }
                          >
                            <PlaneLanding /> Mark Completed
                          </DropdownMenuItem>
                        )}
                        {group.groupStatus === "COMPLETED" && (
                          <DropdownMenuItem
                            disabled={isPending}
                            onClick={() =>
                              setPending({ type: "CLOSE_GROUP", group })
                            }
                          >
                            <CheckCheck /> Close Group
                          </DropdownMenuItem>
                        )}
                      </>
                    )}
                    {can.cancelOrArchiveGroup && (
                      <>
                        <DropdownMenuSeparator />
                        {!isCancelled && (
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={isPending}
                            onClick={() =>
                              setPending({ type: "CANCEL", group })
                            }
                          >
                            <Ban /> Cancel Group
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          disabled={isPending}
                          onClick={() => setPending({ type: "ARCHIVE", group })}
                        >
                          <Archive /> Archive Group
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            }
          />

          {/* Identity strip: status language plus the three live counts. */}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <JourneyTypeBadge value={group.journeyType} />
              <SalesStatusBadge value={group.salesStatus} />
              <GroupStatusBadge value={group.groupStatus} />
              <ReadinessStatusBadge value={group.readinessStatus} />
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <CalendarDays className="size-3.5" />
                {formatDate(group.departureDate)} –{" "}
                {formatDate(group.returnDate)}
              </span>
              <span
                className={
                  group.daysUntilDeparture >= 0 &&
                  group.daysUntilDeparture <= 14
                    ? cn("font-medium", TONE_TEXT.warning)
                    : ""
                }
              >
                {departureCountdown(group.daysUntilDeparture)}
              </span>
              <span className="flex items-center gap-1.5">
                <Users className="size-3.5" />
                <strong className="tabular-nums text-foreground">
                  {group.bookedSeats}
                </strong>{" "}
                booked
                {group.heldSeats > 0 && (
                  <>
                    {" "}
                    · <span className="tabular-nums">{group.heldSeats}</span> on
                    hold
                  </>
                )}{" "}
                / <span className="tabular-nums">{group.capacity}</span>{" "}
                capacity
              </span>
              <span className="tabular-nums">
                {group.availableSeats} seats available
              </span>
            </div>
          </div>
        </div>

        <div>
          <Tabs
            value={tab}
            onValueChange={(next) => {
              setTab(next as DepartureGroupTabId);
              // A manual tab click is not a drill-down, so any pending filter
              // from a blocker is dropped rather than silently reapplied.
              setTabFilter(null);
            }}
          >
            <TabsList className="h-auto w-full flex-nowrap justify-start overflow-x-auto no-scrollbar">
              {tabs.map((entry) => (
                <TabsTrigger key={entry.id} value={entry.id}>
                  {entry.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {/* Only the active tab is mounted — ten operational tabs is too much
            work to render eagerly. */}
          <div className="mt-6 min-h-100">{renderTab()}</div>
        </div>
      </div>
    </>
  );
};

export default DepartureGroupDetailView;
