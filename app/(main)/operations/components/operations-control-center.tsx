"use client";

import PageHeader from "@/components/page-header";
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
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { Download, MoreVertical, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useCallback, useMemo, useState } from "react";

import {
  computeOperationsKpis,
  deriveOperationsAlerts,
} from "@/lib/data/operations";

import { useOperations } from "../operations-store";
import { OPERATIONS_TABS, type OperationsTabId } from "../types";
import {
  operationsWorkspaceHref,
  resolveOperationsWorkspaceTab,
  resolveOperationsWorkspaceView,
  type OperationsWorkspaceSearchParams,
} from "../operations-workspace-navigation";
import {
  operationsSnapshotToReportCsv,
  downloadTextFile,
  timestampedFilename,
} from "../csv";
import OperationsMetrics from "./operations-metrics";
import OperationsAlerts from "./operations-alerts";
import CreateTaskDialog from "./create-task-dialog";
import AddSupplierBookingDialog from "./add-supplier-booking-dialog";
import OverviewTab from "./tabs/overview-tab";
import TasksTab from "./tabs/tasks-tab";
import SupplierConfirmationsTab from "./tabs/supplier-confirmations-tab";
import FlightsTab from "./tabs/flights-tab";
import SupportCasesQueue from "./tabs/support-cases-tab";
import AccommodationRoomingTab from "./tabs/accommodation-rooming-tab";
import TransportTab from "./tabs/transport-tab";
import GuidesBriefingsTab from "./tabs/guides-briefings-tab";
import GroupReadinessTab from "./tabs/group-readiness-tab";
import ActivityTab from "./tabs/activity-tab";
import { UnacknowledgedOperationsHandoffs } from "./unacknowledged-handoffs";

const OperationsControlCenter = () => {
  const { snapshot, can, handoffs, supportCases, canManageSupportCases } = useOperations();

  const router = useRouter();
  const searchParams = useSearchParams();
  const query = useMemo(() => {
    const collected: OperationsWorkspaceSearchParams = {};
    for (const key of new Set(searchParams.keys())) {
      const values = searchParams.getAll(key);
      collected[key] = values.length > 1 ? values : values[0];
    }
    return collected;
  }, [searchParams]);
  const requestedTab = resolveOperationsWorkspaceTab(query);
  const view = resolveOperationsWorkspaceView(requestedTab, query);
  // A viewer without support access never receives the cases, so a shared
  // `?tab=support` link lands them on Overview rather than an empty tab.
  const hasSupportCases = supportCases !== null;
  const tab: OperationsTabId =
    requestedTab === "support" && !hasSupportCases ? "overview" : requestedTab;
  const visibleTabs = OPERATIONS_TABS.filter(
    (entry) => entry.id !== "support" || hasSupportCases,
  );
  const [pendingFilter, setPendingFilter] = useState<string | null>(null);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [addSupplierOpen, setAddSupplierOpen] = useState(false);

  const goToTab = useCallback(
    (next: OperationsTabId, filter?: string) => {
      router.replace(operationsWorkspaceHref(next), { scroll: false });
      setPendingFilter(filter ?? null);
      if (typeof window !== "undefined")
        window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [router],
  );

  const kpis = useMemo(() => computeOperationsKpis(snapshot), [snapshot]);
  const alerts = useMemo(
    () => deriveOperationsAlerts(snapshot.groups),
    [snapshot.groups],
  );

  const exportReport = () => {
    downloadTextFile(
      timestampedFilename("operations-report"),
      operationsSnapshotToReportCsv(snapshot),
    );
    toast.add({
      title: "Operations report exported",
      description: `${snapshot.groups.length} group(s) included.`,
    });
  };

  const renderTab = () => {
    switch (tab) {
      case "overview":
        return <OverviewTab onNavigate={goToTab} />;
      case "tasks":
        return (
          <TasksTab
            initialView={pendingFilter}
            onConsumeFilter={() => setPendingFilter(null)}
          />
        );
      case "suppliers":
        return <SupplierConfirmationsTab />;
      case "flights":
        return <FlightsTab />;
      case "accommodation":
        return <AccommodationRoomingTab view={view} />;
      case "transport":
        return <TransportTab />;
      case "support":
        return supportCases ? (
          <SupportCasesQueue requests={supportCases} canManage={canManageSupportCases} />
        ) : null;
      case "guides":
        return <GuidesBriefingsTab />;
      case "readiness":
        return <GroupReadinessTab onNavigate={goToTab} />;
      case "activity":
        return <ActivityTab />;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={[
          { title: "Home", link: "/dashboard" },
          { title: "Operations", link: "/operations" },
        ]}
        title="Operations Control Center"
        subTitle="Track supplier confirmations, travel readiness, staff tasks, and critical group risks."
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline_without_border" render={<Link href="/operations/approvals" />}>
              <Sparkles /> AI Approvals
            </Button>
            {can.createTask && (
              <Button
                variant="secondary"
                onClick={() => setCreateTaskOpen(true)}
              >
                <Plus /> Create Task
              </Button>
            )}
            {can.addSupplierBooking && (
              <Button
                variant="outline_without_border"
                onClick={() => setAddSupplierOpen(true)}
              >
                <Plus /> Add Supplier Booking
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline_without_border">
                    <MoreVertical />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>More</DropdownMenuLabel>
                {can.exportOperationsReport && (
                  <DropdownMenuItem onClick={exportReport}>
                    <Download /> Export Operations Report
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <OperationsMetrics kpis={kpis} readOnly={can.readOnly} onOpen={goToTab} />
      <OperationsAlerts alerts={alerts} onOpenTab={goToTab} />
      <UnacknowledgedOperationsHandoffs handoffs={handoffs} canAcknowledge={can.acknowledgeInboxHandoff} />

      <div className="mt-2">
        <Tabs
          value={tab}
          onValueChange={(next) => {
            router.replace(operationsWorkspaceHref(next as OperationsTabId), {
              scroll: false,
            });
            setPendingFilter(null);
          }}
        >
          <TabsList className="flex-wrap h-auto">
            {visibleTabs.map((entry) => (
              <TabsTrigger key={entry.id} value={entry.id}>
                {entry.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="min-h-100 mt-5">{renderTab()}</div>
      </div>

      {can.createTask && (
        <CreateTaskDialog
          open={createTaskOpen}
          onClose={() => setCreateTaskOpen(false)}
        />
      )}
      {can.addSupplierBooking && (
        <AddSupplierBookingDialog
          open={addSupplierOpen}
          onClose={() => setAddSupplierOpen(false)}
        />
      )}
    </div>
  );
};

export default OperationsControlCenter;
