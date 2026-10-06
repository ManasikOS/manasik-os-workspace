"use client";

import SectionHeading from "@/components/section-heading";
import { useDepartureCapabilities } from "@/app/(main)/departure-groups/capabilities-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Download,
  Eye,
  Hourglass,
  Loader2,
  MegaphoneIcon,
  Send,
  Upload,
  XCircle,
} from "lucide-react";
import React, { useMemo, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import {
  EmptyState,
  PermissionDenied,
  ProgressBar,
  VisaStatusBadge,
} from "../../../components/status-badges";
import { markVisasUnderReviewAction } from "../../../actions";
import { downloadTextFile, timestampedFilename, toCsv } from "../../../csv";
import { createDocumentDownloadUrl } from "../../../document-storage";
import type {
  DepartureGroupBooking,
  DepartureGroupListItem,
  DepartureGroupManifestRow,
  DepartureGroupPackageSnapshot,
  GroupActivityLog,
  PilgrimVisaStatus,
} from "../../../types";
import { formatDate } from "../../../utils";
import { TONE_CLASS, TONE_TEXT } from "@/lib/ui/tone";
import MarkApplicationsSubmittedDialog from "../mark-applications-submitted-dialog";
import PilgrimDocumentsDrawer from "../pilgrim-documents-drawer";
import RejectVisaDialog from "../reject-visa-dialog";
import SendReminderDialog from "../send-reminder-dialog";
import UploadVisaDialog from "../upload-visa-dialog";

interface DocumentsVisaTabProps {
  manifest: DepartureGroupManifestRow[];
  bookings: DepartureGroupBooking[];
  group: DepartureGroupListItem;
  activity: GroupActivityLog[];
  snapshot: DepartureGroupPackageSnapshot;
  role: StaffRole;
  /** Slice to open on, when arrived at from an Overview blocker. */
  initialFilter?: string | null;
}

const SUBTABS = [
  "All Requirements",
  "Missing Documents",
  "Under Review",
  "Visa Queue",
  "Rejected / Issues",
] as const;

type Subtab = (typeof SUBTABS)[number];

const UNRESOLVED_VISA: PilgrimVisaStatus[] = [
  "NOT_STARTED",
  "DOCUMENTS_PENDING",
  "READY_TO_SUBMIT",
  "SUBMITTED",
  "UNDER_REVIEW",
];

/**
 * Document and visa completion is not a separate ledger — it is the same
 * manifest, sliced. Every change here feeds the pilgrim's status, the group
 * readiness score and the Overview blockers.
 */
/** Blocker filters the Overview can send here, mapped to the slice they mean. */
const FILTER_SUBTABS: Record<string, Subtab> = {
  "visa-queue": "Visa Queue",
  "missing-documents": "Missing Documents",
  rejected: "Rejected / Issues",
};

const DocumentsVisaTab = ({
  manifest,
  bookings,
  group,
  activity,
  snapshot,
  role,
  initialFilter,
}: DocumentsVisaTabProps) => {
  const can = useDepartureCapabilities(role);
  const [isPending, startTransition] = useTransition();
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [subtab, setSubtab] = useState<Subtab>(
    (initialFilter && FILTER_SUBTABS[initialFilter]) || "All Requirements",
  );
  // The per-document work happens in the drawer now: a traveller's checklist
  // is eight distinct decisions with eight distinct owners, not one button.
  const [openPilgrimId, setOpenPilgrimId] = useState<string | null>(null);
  const [rejectingVisaFor, setRejectingVisaFor] =
    useState<DepartureGroupManifestRow | null>(null);

  const [submittedDialogOpen, setSubmittedDialogOpen] = useState(false);
  const [uploadVisaOpen, setUploadVisaOpen] = useState(false);
  const [reminderPickerOpen, setReminderPickerOpen] = useState(false);
  const [reminderBookingId, setReminderBookingId] = useState<string | null>(
    null,
  );

  const rows = useMemo(() => {
    switch (subtab) {
      case "Missing Documents":
        return manifest.filter(
          (row) => row.documentsCompleted < row.documentsRequired,
        );
      case "Under Review":
        return manifest.filter(
          (row) =>
            row.visaStatus === "UNDER_REVIEW" || row.visaStatus === "SUBMITTED",
        );
      case "Visa Queue":
        return manifest.filter((row) =>
          UNRESOLVED_VISA.includes(row.visaStatus),
        );
      case "Rejected / Issues":
        return manifest.filter(
          (row) =>
            row.visaStatus === "REJECTED" ||
            row.visaStatus === "REWORK_REQUIRED",
        );
      default:
        return manifest;
    }
  }, [manifest, subtab]);

  const bookingsById = useMemo(
    () => new Map(bookings.map((booking) => [booking.id, booking])),
    [bookings],
  );
  const travellersByBooking = useMemo(() => {
    const map = new Map<string, DepartureGroupManifestRow[]>();
    for (const row of manifest) {
      const list = map.get(row.bookingId);
      if (list) list.push(row);
      else map.set(row.bookingId, [row]);
    }
    return map;
  }, [manifest]);

  const bookingsNeedingReminder = useMemo(() => {
    const seen = new Set<string>();
    const list: { booking: DepartureGroupBooking; outstanding: number }[] = [];
    for (const row of manifest) {
      if (row.documentsCompleted >= row.documentsRequired) continue;
      if (seen.has(row.bookingId)) continue;
      seen.add(row.bookingId);
      const booking = bookingsById.get(row.bookingId);
      if (!booking || booking.bookingStatus === "CANCELLED") continue;
      list.push({
        booking,
        outstanding: (travellersByBooking.get(row.bookingId) ?? []).filter(
          (t) => t.documentsCompleted < t.documentsRequired,
        ).length,
      });
    }
    return list;
  }, [manifest, bookingsById, travellersByBooking]);

  const reminderBooking = reminderBookingId
    ? (bookingsById.get(reminderBookingId) ?? null)
    : null;

  const openReminder = () => {
    if (bookingsNeedingReminder.length === 0) {
      toast.add({
        title: "Nothing to remind",
        description: "Every booking on this group has complete documents.",
      });
      return;
    }
    if (bookingsNeedingReminder.length === 1) {
      setReminderBookingId(bookingsNeedingReminder[0].booking.id);
      return;
    }
    setReminderPickerOpen(true);
  };

  /**
   * Acknowledges that the consulate has picked a lodged application up.
   *
   * `UNDER_REVIEW` had a badge, a filter and a subtab of its own but nothing
   * that could produce it, so "Under Review" could only ever mean "posted and
   * not yet heard back". Done per row rather than in bulk: the consulate
   * acknowledges files as it reaches them, not all at once.
   */
  const moveToReview = (row: DepartureGroupManifestRow) => {
    setReviewingId(row.id);
    startTransition(async () => {
      try {
        const result = await markVisasUnderReviewAction({
          departureGroupId: group.id,
          pilgrimIds: [row.id],
        });
        if (!result.ok) {
          toast.add({
            title: "Could not move to review",
            description: result.error,
          });
          return;
        }
        toast.add({
          title: "Application under review",
          description: `${row.fullName} is with the consulate.`,
        });
      } catch {
        toast.add({
          title: "Could not move to review",
          description: "The change did not reach the server. Try again.",
        });
      } finally {
        setReviewingId(null);
      }
    });
  };

  const viewVisaFile = (path: string) => {
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    startTransition(async () => {
      const link = await createDocumentDownloadUrl(path);
      if (!link.ok) {
        tab?.close();
        toast.add({ title: "Could not open", description: link.error });
        return;
      }
      if (tab) tab.location.replace(link.url);
      else window.open(link.url, "_blank", "noopener,noreferrer");
    });
  };

  /** Client-side export of the current slice — respects the active subtab. */
  const exportVisaBatch = () => {
    if (rows.length === 0) {
      toast.add({
        title: "Nothing to export",
        description: `${subtab} has no pilgrims right now.`,
      });
      return;
    }

    const matrix: string[][] = [
      [
        "Pilgrim",
        "Passport",
        "Booking Reference",
        "Documents Completed",
        "Documents Required",
        "Documents %",
        "Visa Status",
        "Visa Submitted",
        "Visa ID",
        "Visa Issue Note",
      ],
      ...rows.map((row) => [
        row.fullName,
        row.passportNumber ?? "Restricted",
        row.bookingReference,
        String(row.documentsCompleted),
        String(row.documentsRequired),
        String(row.documentCompletionPercent),
        row.visaStatus,
        row.visaSubmittedAt ? row.visaSubmittedAt.slice(0, 10) : "",
        row.visaId ?? "",
        row.visaIssueNote ?? "",
      ]),
    ];

    downloadTextFile(
      timestampedFilename(`${group.groupCode}-visa-batch`),
      toCsv(matrix),
    );
    toast.add({
      title: "Export ready",
      description: `${rows.length} pilgrim${rows.length === 1 ? "" : "s"} exported from ${subtab}.`,
    });
  };

  if (!can.manageDocumentsAndVisa && !can.viewSensitiveTravellerData) {
    return (
      <Card>
        <PermissionDenied what="Traveller documents and visa data" />
      </Card>
    );
  }

  const documentsComplete = manifest.filter(
    (row) => row.documentsCompleted === row.documentsRequired,
  ).length;
  const visasApproved = manifest.filter(
    (row) => row.visaStatus === "APPROVED",
  ).length;

  // The per-pilgrim checklist length was frozen from the snapshot's traveller
  // requirements when each booking was created, so it is read back off the
  // manifest rather than guessed — a group copied without the traveller
  // requirements has a different count, and hardcoding one would lie about it.
  const documentsPerPilgrim =
    manifest.length > 0 ? manifest[0].documentsRequired : 0;
  const mixedRequirements = manifest.some(
    (row) => row.documentsRequired !== documentsPerPilgrim,
  );

  return (
    <div className="flex flex-col gap-5">
      <MarkApplicationsSubmittedDialog
        manifest={manifest}
        departureGroupId={group.id}
        open={submittedDialogOpen}
        onClose={() => setSubmittedDialogOpen(false)}
      />
      <UploadVisaDialog
        manifest={manifest}
        departureGroupId={group.id}
        open={uploadVisaOpen}
        onClose={() => setUploadVisaOpen(false)}
      />
      <PilgrimDocumentsDrawer
        row={manifest.find((r) => r.id === openPilgrimId) ?? null}
        departureGroupId={group.id}
        role={role}
        open={openPilgrimId !== null}
        onClose={() => setOpenPilgrimId(null)}
      />
      <RejectVisaDialog
        row={rejectingVisaFor}
        departureGroupId={group.id}
        open={rejectingVisaFor !== null}
        onClose={() => setRejectingVisaFor(null)}
      />
      {can.sendGroupCommunications && (
        <SendReminderDialog
          kind={reminderBookingId ? "DOCUMENT" : null}
          booking={reminderBooking}
          travellers={travellersByBooking.get(reminderBookingId ?? "") ?? []}
          group={group}
          activity={activity}
          role={role}
          currency={snapshot.currency || "LKR"}
          open={reminderBookingId !== null}
          onClose={() => setReminderBookingId(null)}
        />
      )}
      <Dialog
        open={reminderPickerOpen}
        onOpenChange={(open) => setReminderPickerOpen(open)}
      >
        <DialogContent className="max-w-md!">
          <DialogHeader>
            <DialogTitle>Select a booking to remind</DialogTitle>
            <DialogDescription>
              {bookingsNeedingReminder.length} booking
              {bookingsNeedingReminder.length === 1 ? "" : "s"} still have
              outstanding documents.
            </DialogDescription>
          </DialogHeader>
          <div className="flex max-h-80 flex-col gap-1 overflow-y-auto custom-scroll">
            {bookingsNeedingReminder.map(({ booking, outstanding }) => (
              <button
                key={booking.id}
                type="button"
                className="flex items-center justify-between gap-3 rounded-sm px-2.5 py-2 text-left hover:bg-muted/50"
                onClick={() => {
                  setReminderPickerOpen(false);
                  setReminderBookingId(booking.id);
                }}
              >
                <div className="min-w-0">
                  <p className="text-sm text-foreground truncate">
                    {booking.bookingReference} · {booking.primaryContactName}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {booking.primaryContactPhone}
                  </p>
                </div>
                <span className="text-xs font-number text-muted-foreground shrink-0">
                  {outstanding} outstanding
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Card className="gap-4">
        <SectionHeading
          title="Documents & Visa"
          act={
            <div className="flex flex-wrap items-center gap-2">
              {can.sendGroupCommunications && (
                <Button variant="secondary" size="sm" onClick={openReminder}>
                  <MegaphoneIcon /> Send Document Reminder
                </Button>
              )}
              {can.manageDocumentsAndVisa && (
                <>
                  <Button
                    variant="outline_without_border"
                    size="sm"
                    onClick={() => setSubmittedDialogOpen(true)}
                  >
                    <Send /> Mark Application Submitted
                  </Button>
                  <Button
                    variant="outline_without_border"
                    size="sm"
                    onClick={() => setUploadVisaOpen(true)}
                  >
                    <Upload /> Upload Visa
                  </Button>
                </>
              )}
              {can.exportReports && (
                <Button variant="ghost" size="sm" onClick={exportVisaBatch}>
                  <Download /> Export Visa Batch
                </Button>
              )}
            </div>
          }
        />

        <div className="grid gap-4 sm:grid-cols-3 mt-2">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              Documents complete
            </span>
            <span className="text-sm font-number text-foreground">
              {documentsComplete} / {manifest.length} pilgrims
            </span>
            <ProgressBar
              percent={
                manifest.length === 0
                  ? 0
                  : Math.round((documentsComplete / manifest.length) * 100)
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Visas issued</span>
            <span className="text-sm font-number text-foreground">
              {visasApproved} / {manifest.length}
            </span>
            <ProgressBar
              percent={
                manifest.length === 0
                  ? 0
                  : Math.round((visasApproved / manifest.length) * 100)
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              Snapshot requirements
            </span>
            <span className="text-sm font-number text-foreground">
              {manifest.length === 0
                ? "No pilgrims yet"
                : mixedRequirements
                  ? "Varies by booking"
                  : `${documentsPerPilgrim} document${
                      documentsPerPilgrim === 1 ? "" : "s"
                    } per pilgrim`}
            </span>
            <span className="text-[11px] text-muted-foreground">
              Frozen from {snapshot.packageName || "the package template"}
            </span>
          </div>
        </div>

        {/* Subtabs */}
        <div
          role="group"
          aria-label="Filter document and visa requirements"
          className="max-w-full overflow-x-auto no-scrollbar"
        >
        <Card className="flex w-max flex-row items-center px-1 py-1">
          {SUBTABS.map((entry) => (
            <Button
              key={entry}
              variant={subtab === entry ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setSubtab(entry)}
              className={cn(subtab !== entry && "text-muted-foreground")}
            >
              {entry}
            </Button>
          ))}
        </Card>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className={cn("size-6", TONE_TEXT.success)} />}
            title={`Nothing in ${subtab}`}
            description="Every pilgrim in this slice is clear."
          />
        ) : (
          <div className="overflow-x-auto no-scrollbar">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-none!">
                  {[
                    "Pilgrim",
                    "Passport",
                    "Documents",
                    "Visa status",
                    "Submitted",
                    "Visa ID",
                    "Issue",
                    "",
                  ].map((label) => (
                    <TableHead
                      key={label}
                      className="h-10 px-3 text-xs font-medium text-muted-foreground"
                    >
                      {label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-border/20">
                {rows.map((row) => (
                  <TableRow
                    key={row.id}
                    onClick={() => setOpenPilgrimId(row.id)}
                    className="hover:bg-muted/50"
                  >
                    <TableCell className="px-3 py-2.5 text-sm text-foreground">
                      {row.fullName}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-xs font-number text-muted-foreground">
                      {row.passportNumber ?? "Restricted"}
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <div className="flex flex-col gap-1 min-w-24">
                        <span className="text-xs font-number text-foreground">
                          {row.documentsCompleted} / {row.documentsRequired}
                        </span>
                        <ProgressBar percent={row.documentCompletionPercent} />
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <VisaStatusBadge value={row.visaStatus} />
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">
                      {formatDate(row.visaSubmittedAt)}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-xs font-number text-muted-foreground">
                      {row.visaId ?? "—"}
                    </TableCell>
                    <TableCell className={cn("px-3 py-2.5 text-xs max-w-55 truncate", TONE_TEXT.warning)}>
                      {row.visaIssueNote ?? "—"}
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="xs"
                          title="Open document checklist"
                          onClick={() => setOpenPilgrimId(row.id)}
                        >
                          <BadgeCheck />
                        </Button>
                        {row.visaFilePath && (
                          <Button
                            variant="ghost"
                            size="xs"
                            title="View the uploaded visa file"
                            onClick={() => viewVisaFile(row.visaFilePath!)}
                          >
                            <Eye />
                          </Button>
                        )}
                        {row.visaAiStatus === "COMPLETE" &&
                          (row.visaAiIssues?.length ?? 0) > 0 && (
                            <Badge
                              className={cn(TONE_CLASS.warning, "text-[10px]")}
                              title={row.visaAiIssues!.map((i) => i.message).join(" · ")}
                            >
                              <AlertTriangle className="size-3" />{" "}
                              {row.visaAiIssues!.length}
                            </Badge>
                          )}
                        {can.manageDocumentsAndVisa &&
                          row.visaStatus === "SUBMITTED" && (
                            <Button
                              variant="ghost"
                              size="xs"
                              title="Consulate has picked this up — move to under review"
                              disabled={isPending && reviewingId === row.id}
                              onClick={() => moveToReview(row)}
                            >
                              {isPending && reviewingId === row.id ? (
                                <Loader2 className="animate-spin" />
                              ) : (
                                <Hourglass />
                              )}
                            </Button>
                          )}
                        {can.manageDocumentsAndVisa &&
                          (row.visaStatus === "SUBMITTED" ||
                            row.visaStatus === "UNDER_REVIEW") && (
                            <Button
                              variant="ghost"
                              size="xs"
                              title="Record a refusal"
                              onClick={() => setRejectingVisaFor(row)}
                            >
                              <XCircle />
                            </Button>
                          )}
                      </div>
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

export default DocumentsVisaTab;
