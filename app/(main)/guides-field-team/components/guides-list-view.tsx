"use client";

import { useMemo, useState } from "react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";

import PageHeader from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import { Tabs, TabsList, TabsTrigger } from "@/components/animate-ui/components/animate/tabs";
import { EmptyState } from "@/components/ui/tone-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KpiCard } from "@/components/data-table/kpi-card";
import { UserCog } from "lucide-react";

import { formatDate } from "@/app/(main)/departure-groups/utils";
import { TONE_TEXT } from "@/lib/ui/tone";
import type {
  StaffAccountStatus,
  StaffAssignmentResponsibility,
  StaffBranch,
} from "@/lib/types/team";

const RESPONSIBILITY_LABELS: Record<StaffAssignmentResponsibility, string> = {
  PRIMARY_GUIDE: "Primary Guide",
  BACKUP_GUIDE: "Backup Guide",
  OPERATIONS_OWNER: "Operations Owner",
  BACKUP_OPERATIONS: "Backup Operations",
  VISA_OWNER: "Visa Owner",
  FINANCE_OWNER: "Finance Owner",
  MARKETING_OWNER: "Marketing Owner",
};

const BRANCH_LABELS: Record<StaffBranch, string> = {
  COLOMBO: "Colombo",
  KANDY: "Kandy",
  ALL: "All Branches",
};

export interface GuideRosterRow {
  id: string;
  fullName: string;
  whatsapp: string | null;
  branch: StaffBranch;
  status: StaffAccountStatus;
  assignedGroupCount: number;
  assignments: { groupId: string; groupName: string; responsibility: StaffAssignmentResponsibility }[];
  openTaskCount: number;
  overdueTaskCount: number;
  dueTodayCount: number;
  lastActiveAt: string | null;
}

type Filter = "ALL" | "ASSIGNED" | "UNASSIGNED" | "OVERDUE_TASKS";

export default function GuidesListView({ guides }: { guides: GuideRosterRow[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return guides.filter((g) => {
      if (filter === "ASSIGNED" && g.assignedGroupCount === 0) return false;
      if (filter === "UNASSIGNED" && g.assignedGroupCount > 0) return false;
      if (filter === "OVERDUE_TASKS" && g.overdueTaskCount === 0) return false;
      if (!needle) return true;
      return [g.fullName, ...g.assignments.map((a) => a.groupName)].join(" ").toLowerCase().includes(needle);
    });
  }, [guides, search, filter]);

  const assignedCount = guides.filter((g) => g.assignedGroupCount > 0).length;
  const unassignedCount = guides.filter((g) => g.assignedGroupCount === 0).length;
  const overdueTaskCount = guides.reduce((sum, g) => sum + g.overdueTaskCount, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Guides & Field Team"
        breadcrumb={[{ title: "Operations", link: "/operations" }, { title: "Guides & Field Team", link: "/guides-field-team" }]}
        subTitle="Every active guide, their current departure-group assignments and task workload. Assign a guide from that group's Overview tab."
        action={null}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard title="Active guides" value={String(guides.length)} />
        <KpiCard title="Currently assigned" value={String(assignedCount)} />
        <KpiCard title="Unassigned" value={String(unassignedCount)} />
        <KpiCard
          title="Overdue tasks"
          value={String(overdueTaskCount)}
          desc={overdueTaskCount > 0 ? <span className={TONE_TEXT.warning}>Across the roster</span> : undefined}
        />
      </div>

      <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
        <TabsList>
          {(["ALL", "ASSIGNED", "UNASSIGNED", "OVERDUE_TASKS"] as const).map((key) => (
            <TabsTrigger
              key={key}
              value={key}
            >
              {key === "ALL"
                ? "All"
                : key === "ASSIGNED"
                  ? "Assigned"
                  : key === "UNASSIGNED"
                    ? "Unassigned"
                    : "Has Overdue Tasks"}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <DataTableSurface search={search} onSearchChange={setSearch} searchPlaceholder="Search guide or group…" rowCount={filtered.length}>
        {filtered.length === 0 ? (
          <EmptyState
            icon={<UserCog className="size-8" />}
            title="No guides found"
            description="Try a different search or filter."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-none!">
                {["Guide", "Branch", "Assignments", "Workload", "Last Active", ""].map((label) => (
                  <TableHead key={label} className="h-9 px-3 text-xs font-medium text-muted-foreground">
                    {label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border/20">
              {filtered.map((g) => (
                <TableRow
                  key={g.id}
                  className="hover:bg-muted/40 cursor-pointer"
                  onClick={() => router.push(`/management/team/${g.id}?tab=groups`)}
                >
                  <TableCell className="px-3 py-3">
                    <p className="text-sm text-foreground">{g.fullName}</p>
                    {g.whatsapp && (
                      <p className="text-[11px] text-muted-foreground font-number">{g.whatsapp}</p>
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs text-foreground">{BRANCH_LABELS[g.branch]}</TableCell>
                  <TableCell className="px-3 py-3">
                    {g.assignments.length === 0 ? (
                      <span className="text-xs text-muted-foreground">Unassigned</span>
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        {g.assignments.slice(0, 2).map((a) => (
                          <span key={a.groupId} className="text-xs text-foreground">
                            {a.groupName}
                            <span className="text-muted-foreground"> · {RESPONSIBILITY_LABELS[a.responsibility]}</span>
                          </span>
                        ))}
                        {g.assignments.length > 2 && (
                          <span className="text-[11px] text-muted-foreground">
                            +{g.assignments.length - 2} more
                          </span>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs">
                    <span className="text-foreground">{g.openTaskCount} open</span>
                    {g.overdueTaskCount > 0 && (
                      <span className={`ml-1.5 ${TONE_TEXT.danger}`}>· {g.overdueTaskCount} overdue</span>
                    )}
                    {g.dueTodayCount > 0 && (
                      <span className={`ml-1.5 ${TONE_TEXT.warning}`}>· {g.dueTodayCount} due today</span>
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                    {g.lastActiveAt ? formatDate(g.lastActiveAt) : "—"}
                  </TableCell>
                  <TableCell className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="outline" onClick={() => router.push(`/guides-field-team/${g.id}`)}>
                      Field ops
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DataTableSurface>
    </div>
  );
}
