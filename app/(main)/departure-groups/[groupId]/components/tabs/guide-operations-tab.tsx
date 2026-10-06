"use client";

import SectionHeading from "@/components/section-heading";
import { useDepartureCapabilities } from "@/app/(main)/departure-groups/capabilities-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import {
  type StaffRole,
} from "@/lib/access/departure-groups-access";
import {
  CheckCircle2,
  Download,
  Loader2,
  Phone,
  Plus,
  RotateCcw,
  Users,
} from "lucide-react";
import React, { useState, useTransition } from "react";

import { updateGroupTaskStatusAction } from "../../../actions";
import {
  EmptyState,
  PersonChip,
  TaskStatusBadge,
} from "../../../components/status-badges";
import { downloadTextFile, timestampedFilename, toCsv } from "../../../csv";
import type {
  DepartureGroupFlight,
  DepartureGroupListItem,
  DepartureGroupReadinessItem,
  DepartureGroupTask,
  DepartureGroupTransport,
} from "../../../types";
import { formatDate, formatDateTime, formatTime } from "../../../utils";
import CreateTaskDialog from "../create-task-dialog";

interface GuideOperationsTabProps {
  group: DepartureGroupListItem;
  tasks: DepartureGroupTask[];
  flights: DepartureGroupFlight[];
  transports: DepartureGroupTransport[];
  /** Requirements a new task can be linked to. */
  readinessItems: DepartureGroupReadinessItem[];
  role: StaffRole;
}

const TASK_CATEGORY_LABELS: Record<string, string> = {
  OPERATIONS: "Operations",
  VISA: "Visa",
  FINANCE: "Finance",
  GUIDE: "Guide",
  MARKETING: "Marketing",
  OTHER: "Other",
};

function Assignment({
  label,
  name,
  fallback,
}: {
  label: string;
  name: string | null;
  fallback?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <PersonChip name={name} fallback={fallback} />
    </div>
  );
}

const GuideOperationsTab = ({
  group,
  tasks,
  flights,
  transports,
  readinessItems,
  role,
}: GuideOperationsTabProps) => {
  const can = useDepartureCapabilities(role);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const outbound = flights.find((flight) => flight.direction === "OUTBOUND");
  const firstTransport = transports.find(
    (transport) => transport.pickupAt !== null,
  );

  const setTaskStatus = (task: DepartureGroupTask, complete: boolean) => {
    setBusyTaskId(task.id);
    startTransition(async () => {
      const result = await updateGroupTaskStatusAction({
        id: task.id,
        departureGroupId: group.id,
        status: complete ? "COMPLETE" : "OPEN",
      });
      setBusyTaskId(null);

      if (!result.ok) {
        toast.add({ title: "Could not update task", description: result.error });
        return;
      }
      toast.add({
        title: complete ? "Task completed" : "Task reopened",
        description: result.title,
      });
    });
  };

  /**
   * The run sheet as a file the guide can carry. `window.print()` would print
   * the whole application chrome, so the sheet is exported as its own document
   * instead — it has to survive being read on a phone at 3am in a hotel lobby.
   */
  const exportRunSheet = () => {
    const rows: string[][] = [
      ["Day-of-departure run sheet"],
      ["Group", `${group.groupName} (${group.groupCode})`],
      ["Departure", formatDate(group.departureDate)],
      [
        "Meeting point",
        firstTransport?.pickupLocation ?? "Airport departure hall",
      ],
      [
        "Assembly time",
        firstTransport?.pickupAt
          ? formatDateTime(firstTransport.pickupAt)
          : "To be confirmed",
      ],
      [
        "Check-in opens",
        outbound ? `${formatTime(outbound.departureAt)} minus 3h` : "To be confirmed",
      ],
      [
        "Flight departure",
        outbound ? formatDateTime(outbound.departureAt) : "Not scheduled",
      ],
      ["Guide", group.primaryGuideName ?? "Unassigned"],
      ["Backup guide", group.backupGuideName ?? "None"],
      ["Operations owner", group.operationsOwnerName ?? "Unassigned"],
      ["Local coordinator", group.localCoordinatorName ?? "Not appointed"],
      [
        "Emergency contact",
        group.localCoordinatorPhone ?? group.emergencyPhone ?? "—",
      ],
      ["Transport pickup", firstTransport?.routeLabel ?? "Not scheduled"],
      ["Pilgrims booked", `${group.bookedSeats} of ${group.capacity}`],
      [],
      ["Open tasks", "Owner", "Due", "Status"],
      ...tasks
        .filter((task) => task.status !== "COMPLETE")
        .map((task) => [
          task.title,
          task.ownerName,
          formatDate(task.dueAt),
          task.status,
        ]),
    ];

    downloadTextFile(
      timestampedFilename(`${group.groupCode}-run-sheet`),
      toCsv(rows),
    );
    toast.add({
      title: "Run sheet exported",
      description: `${group.groupCode} day-of-departure run sheet downloaded.`,
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <CreateTaskDialog
        group={group}
        readinessItems={readinessItems}
        open={createTaskOpen}
        onClose={() => setCreateTaskOpen(false)}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Assignments */}
        <Card className="gap-4">
          <SectionHeading
            title="Assignments"
            act={<Users className="size-4 text-muted-foreground" />}
          />
          <div className="grid grid-cols-2 gap-4">
            <Assignment
              label="Primary guide"
              name={group.primaryGuideName}
              fallback="Unassigned"
            />
            <Assignment
              label="Backup guide"
              name={group.backupGuideName}
              fallback="None"
            />
            <Assignment
              label="Operations owner"
              name={group.operationsOwnerName}
            />
            <Assignment label="Visa owner" name={group.visaOwnerName} />
            <Assignment label="Finance owner" name={group.financeOwnerName} />
            <Assignment
              label="Local coordinator"
              name={group.localCoordinatorName}
              fallback="Not appointed"
            />
          </div>
          <Separator />
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">
              Local emergency contact
            </span>
            <span className="text-sm font-number text-foreground">
              {group.localCoordinatorPhone ?? group.emergencyPhone ?? "—"}
            </span>
          </div>
        </Card>

        {/* Communication. No messaging gateway is connected, so this card
            routes to the channels that do exist rather than offering a send
            button that cannot send. Per-booking reminders — which are real, and
            logged — live on the Pilgrims and Documents tabs. */}
        <Card className="gap-4">
          <SectionHeading
            title="Communication"
            act={
              <span className="text-xs text-muted-foreground">
                Channels for this group
              </span>
            }
          />
          <div className="flex flex-col divide-y divide-border/30">
            <div className="flex items-center justify-between py-2.5">
              <span className="text-xs text-muted-foreground">
                Guide WhatsApp group
              </span>
              {group.guideWhatsappLink ? (
                <a
                  href={group.guideWhatsappLink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline"
                >
                  Open group chat
                </a>
              ) : (
                <span className="text-xs text-muted-foreground">Not set up</span>
              )}
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-xs text-muted-foreground">
                Pilgrim broadcast list
              </span>
              {group.pilgrimBroadcastLink ? (
                <a
                  href={group.pilgrimBroadcastLink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline"
                >
                  Open broadcast list
                </a>
              ) : (
                <span className="text-xs text-muted-foreground">Not set up</span>
              )}
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-xs text-muted-foreground">
                Emergency phone
              </span>
              <span className="text-xs font-number text-foreground flex items-center gap-1.5">
                <Phone className="size-3.5 text-muted-foreground" />
                {group.emergencyPhone ?? "—"}
              </span>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-xs text-muted-foreground">
                Saudi local coordinator
              </span>
              <span className="text-xs text-foreground">
                {group.localCoordinatorName ?? "Not appointed"}
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* Day-of-departure run sheet */}
      <Card className="gap-4">
        <SectionHeading
          title="Day-of-departure run sheet"
          act={
            can.exportReports && (
              <Button variant="outline" size="sm" onClick={exportRunSheet}>
                <Download /> Export Run Sheet
              </Button>
            )
          }
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <RunSheetItem
            label="Meeting point"
            value={firstTransport?.pickupLocation ?? "Airport departure hall"}
          />
          <RunSheetItem
            label="Assembly time"
            value={
              firstTransport?.pickupAt
                ? formatDateTime(firstTransport.pickupAt)
                : "To be confirmed"
            }
          />
          <RunSheetItem
            label="Check-in opens"
            value={
              outbound
                ? `${formatTime(outbound.departureAt)} minus 3h`
                : "To be confirmed"
            }
          />
          <RunSheetItem
            label="Flight departure"
            value={
              outbound ? formatDateTime(outbound.departureAt) : "Not scheduled"
            }
          />
          <RunSheetItem
            label="Guide"
            value={group.primaryGuideName ?? "Unassigned"}
          />
          <RunSheetItem
            label="Emergency contact"
            value={group.emergencyPhone ?? "—"}
          />
          <RunSheetItem
            label="Transport pickup"
            value={firstTransport?.routeLabel ?? "Not scheduled"}
          />
          <RunSheetItem
            label="Last updated"
            value={formatDate(group.updatedAt)}
          />
        </div>
      </Card>

      {/* Tasks */}
      <Card className="gap-4">
        <SectionHeading
          title="Tasks"
          act={
            can.manageTasks && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCreateTaskOpen(true)}
              >
                <Plus /> Create Task
              </Button>
            )
          }
        />
        {tasks.length === 0 ? (
          <EmptyState title="No tasks for this group" />
        ) : (
          <div className="overflow-x-auto no-scrollbar">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-none!">
                  {["Task", "Owner", "Due", "Category", "Status", ""].map(
                    (label) => (
                      <TableHead
                        key={label}
                        className="h-10 px-3 text-xs font-medium text-muted-foreground"
                      >
                        {label}
                      </TableHead>
                    ),
                  )}
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-border/20">
                {tasks.map((task) => (
                  <TableRow key={task.id} className="hover:bg-muted/50">
                    <TableCell className="px-3 py-3">
                      <p className="text-sm text-foreground">{task.title}</p>
                      {task.description && (
                        <p className="text-[11px] text-muted-foreground max-w-90 truncate">
                          {task.description}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      <PersonChip name={task.ownerName} />
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      <span className="text-xs text-foreground">
                        {task.dueLabel}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {formatDate(task.dueAt)}
                      </span>
                    </TableCell>
                    <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                      {TASK_CATEGORY_LABELS[task.category]}
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      <TaskStatusBadge value={task.status} />
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      {can.manageTasks && (
                        <Button
                          variant="ghost"
                          size="xs"
                          disabled={isPending && busyTaskId === task.id}
                          onClick={() =>
                            setTaskStatus(task, task.status !== "COMPLETE")
                          }
                        >
                          {isPending && busyTaskId === task.id ? (
                            <Loader2 className="animate-spin" />
                          ) : task.status === "COMPLETE" ? (
                            <RotateCcw />
                          ) : (
                            <CheckCircle2 />
                          )}
                          {task.status === "COMPLETE" ? "Reopen" : "Complete"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
};

function RunSheetItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

export default GuideOperationsTab;
