"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { groupBookingSchema } from "@/lib/validations/departure-groups";
import {
  CheckCircle2,
  CircleAlert,
  Download,
  FileUp,
  Loader2,
  RotateCcw,
  TriangleAlert,
  Upload,
} from "lucide-react";
import React, { useMemo, useRef, useState, useTransition } from "react";

import {
  importGroupPilgrimsAction,
  type ImportBookingRowResult,
} from "../../actions";
import { downloadBinaryFile, downloadTextFile } from "../../csv";
import {
  buildPilgrimImportCandidates,
  pilgrimImportTemplateCsv,
  pilgrimImportTemplateMatrix,
  type PilgrimImportCandidate,
} from "../../manifest";
import type {
  DepartureGroupListItem,
  DepartureGroupPricing,
} from "../../types";
import { ROOM_TYPE_LABELS } from "../../utils";
import { matrixToXlsx, readSpreadsheetFile, XLSX_MIME } from "../../xlsx";
import { TONE_CLASS, TONE_TEXT } from "@/lib/ui/tone";

interface PreviewRow {
  candidate: PilgrimImportCandidate;
  errors: string[];
  valid: boolean;
}

interface ImportPilgrimsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: DepartureGroupListItem;
  pricing: DepartureGroupPricing;
  /** Bookings already on the group — used to number generated references. */
  existingBookingCount: number;
}

/**
 * Pilgrim import in one dialog: upload → preview by booking → confirm.
 *
 * A spreadsheet of pilgrims is one row per person, but a booking is what holds
 * seats, money and a room preference, so the preview is grouped the way the
 * import will actually run: rows sharing a `booking_reference` become one
 * booking, and each becomes one row here.
 *
 * Validation runs twice on purpose. Here, `groupBookingSchema` shows exactly
 * which bookings will fail and why, plus the seat arithmetic the group can
 * actually absorb. On submit only the valid bookings are sent, and the Server
 * Action validates them again as the real gate.
 */
const ImportPilgrimsDialog = ({
  open,
  onOpenChange,
  group,
  pricing,
  existingBookingCount,
}: ImportPilgrimsDialogProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, startImport] = useTransition();

  const [fileName, setFileName] = useState<string | null>(null);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<PilgrimImportCandidate[]>([]);
  const [results, setResults] = useState<ImportBookingRowResult[] | null>(null);

  const reset = () => {
    setFileName(null);
    setHeaderError(null);
    setCandidates([]);
    setResults(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const close = () => {
    onOpenChange(false);
    reset();
  };

  const downloadTemplate = (format: "csv" | "xlsx") => {
    if (format === "xlsx") {
      downloadBinaryFile(
        `${group.groupCode}-pilgrim-import-template.xlsx`,
        matrixToXlsx(pilgrimImportTemplateMatrix(pricing), "Pilgrims"),
        XLSX_MIME,
      );
    } else {
      downloadTextFile(
        `${group.groupCode}-pilgrim-import-template.csv`,
        pilgrimImportTemplateCsv(pricing),
      );
    }
    toast.add({
      title: "Template downloaded",
      description:
        "One row per pilgrim. Give a family the same booking_reference to keep them on one booking.",
    });
  };

  const handleFile = async (file: File) => {
    setResults(null);
    setFileName(file.name);

    try {
      const rows = await readSpreadsheetFile(file);
      const { candidates: mapped, headerError: error } =
        buildPilgrimImportCandidates(rows, {
          departureGroupId: group.id,
          groupCode: group.groupCode,
          pricing,
          existingBookingCount,
        });
      setHeaderError(error);
      setCandidates(mapped);
      if (!error && mapped.length === 0) {
        setHeaderError("The file has a header row but no pilgrim rows.");
      }
    } catch (error) {
      setHeaderError(
        error instanceof Error
          ? error.message
          : "That file could not be read as a spreadsheet.",
      );
      setCandidates([]);
    }
  };

  const onFileChosen = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void handleFile(file);
  };

  /**
   * Preview rows: mapping errors, schema errors, and a running seat check — a
   * booking that would push the group past its remaining capacity is flagged
   * here rather than left to fail server-side half-way through the file. Seats
   * are counted in file order, which is the order the import will run in.
   *
   * Duplicate references need no check: rows sharing one are how a family shares
   * a booking, and the grouping has already merged them.
   */
  const previewRows = useMemo<PreviewRow[]>(() => {
    // Folded rather than a mutated loop variable, so each step's seat balance
    // is a value derived from the previous one instead of shared mutable state.
    const { rows } = candidates.reduce<{
      rows: PreviewRow[];
      seatsLeft: number;
    }>(
      (acc, candidate) => {
        const errors = [...candidate.mappingErrors];

        const parsed = groupBookingSchema.safeParse(candidate.payload);
        if (!parsed.success) {
          for (const issue of parsed.error.issues) {
            errors.push(issue.message);
          }
        }

        const consumesSeats =
          candidate.payload.bookingStatus !== "WAITLIST" &&
          candidate.payload.bookingStatus !== "CANCELLED";

        let seatsLeft = acc.seatsLeft;
        if (errors.length === 0 && consumesSeats) {
          if (candidate.payload.travellerCount > seatsLeft) {
            errors.push(
              `Only ${seatsLeft} seat${seatsLeft === 1 ? "" : "s"} left in ${
                group.groupCode
              } — this booking needs ${candidate.payload.travellerCount}.`,
            );
          } else {
            seatsLeft -= candidate.payload.travellerCount;
          }
        }

        acc.rows.push({ candidate, errors, valid: errors.length === 0 });
        return { rows: acc.rows, seatsLeft };
      },
      { rows: [], seatsLeft: group.availableSeats },
    );
    return rows;
  }, [candidates, group.availableSeats, group.groupCode]);

  const validRows = previewRows.filter((row) => row.valid);
  const invalidCount = previewRows.length - validRows.length;
  const validTravellers = validRows.reduce(
    (sum, row) => sum + row.candidate.payload.travellerCount,
    0,
  );

  const runImport = () => {
    if (validRows.length === 0) return;

    startImport(async () => {
      const result = await importGroupPilgrimsAction(
        validRows.map((row) => row.candidate.payload),
      );

      if (!result.ok) {
        toast.add({ title: "Import failed", description: result.error });
        return;
      }

      setResults(result.results);
      toast.add({
        title: "Import complete",
        description: `${result.createdTravellers} pilgrim${
          result.createdTravellers === 1 ? "" : "s"
        } added across ${result.createdBookings} of ${result.totalBookings} booking${
          result.totalBookings === 1 ? "" : "s"
        }.`,
      });
    });
  };

  const createdCount = results?.filter((row) => row.ok).length ?? 0;
  const createdTravellers =
    results
      ?.filter((row) => row.ok)
      .reduce((sum, row) => sum + row.travellerCount, 0) ?? 0;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Pilgrims</DialogTitle>
          <DialogDescription>
            Upload an Excel (.xlsx) or CSV file of pilgrims for{" "}
            {group.groupName}. Rows sharing a{" "}
            <span className="font-number">booking_reference</span> become one
            booking; a blank reference becomes a booking of its own. Each
            booking is created exactly as the Add Booking form would create it.
          </DialogDescription>
        </DialogHeader>

        {/* Phase 3: results */}
        {results ? (
          <div className="flex flex-col gap-3">
            <div className={`flex items-center gap-2 rounded-sm px-3 py-2.5 text-sm ${TONE_CLASS.success}`}>
              <CheckCircle2 className="size-4" />
              {createdTravellers} pilgrim{createdTravellers === 1 ? "" : "s"}{" "}
              added across {createdCount} booking
              {createdCount === 1 ? "" : "s"}.
            </div>
            {results.some((row) => !row.ok) && (
              <div className="max-h-60 overflow-y-auto custom-scroll rounded-sm border border-border/40">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-none!">
                      {["Booking", "Contact", "Result"].map((label) => (
                        <TableHead
                          key={label}
                          className="h-9 px-3 text-xs font-medium text-muted-foreground"
                        >
                          {label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody className="divide-y divide-border/20">
                    {results
                      .filter((row) => !row.ok)
                      .map((row) => (
                        <TableRow key={row.bookingNumber}>
                          <TableCell className="px-3 py-2 text-xs font-number text-foreground">
                            {row.bookingReference}
                          </TableCell>
                          <TableCell className="px-3 py-2 text-xs text-muted-foreground">
                            {row.primaryContactName}
                          </TableCell>
                          <TableCell className="px-3 py-2 text-xs text-destructive">
                            {row.error}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Upload row */}
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={onFileChosen}
                className="hidden"
              />
              <Button
                variant="secondary"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload />{" "}
                {fileName ? "Choose Another File" : "Choose Excel or CSV File"}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="outline_without_border">
                      <Download /> Download Template
                    </Button>
                  }
                />
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => downloadTemplate("xlsx")}>
                    Excel template (.xlsx)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => downloadTemplate("csv")}>
                    CSV template (.csv)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {fileName && (
                <span className="text-xs text-muted-foreground truncate max-w-40">
                  {fileName}
                </span>
              )}
            </div>

            {/* Empty state / column help */}
            {!fileName && (
              <div className="rounded-md border border-dashed border-border/60 px-4 py-6 mt-5 text-center">
                <FileUp className="size-6 text-muted-foreground/60 mx-auto" />
                <p className="text-sm font-medium text-foreground mt-2">
                  Upload an Excel or CSV file to preview it here
                </p>
                <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                  Required column:{" "}
                  <span className="font-number">full_name</span>. Room type,
                  status and price fall back to this group&apos;s current
                  pricing, and a contact number comes from{" "}
                  <span className="font-number">primary_contact_phone</span> or{" "}
                  <span className="font-number">phone</span>.
                </p>
                <p className="text-xs text-muted-foreground mt-2 font-number">
                  {group.availableSeats} seat
                  {group.availableSeats === 1 ? "" : "s"} available
                </p>
              </div>
            )}

            {headerError && (
              <div className="flex items-start gap-2 rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
                <span>{headerError}</span>
              </div>
            )}

            {/* Preview */}
            {previewRows.length > 0 && (
              <>
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className={`inline-flex items-center gap-1.5 ${TONE_TEXT.success}`}>
                    <CheckCircle2 className="size-3.5" />
                    {validRows.length} booking
                    {validRows.length === 1 ? "" : "s"} ready ({validTravellers}{" "}
                    pilgrim{validTravellers === 1 ? "" : "s"})
                  </span>
                  {invalidCount > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-destructive">
                      <CircleAlert className="size-3.5" />
                      {invalidCount} with errors
                    </span>
                  )}
                  <span className="text-muted-foreground font-number">
                    {group.availableSeats} seat
                    {group.availableSeats === 1 ? "" : "s"} available
                  </span>
                </div>

                <div className="max-h-72 overflow-y-auto custom-scroll rounded-sm border border-border/40">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent border-none!">
                        {[
                          "#",
                          "Booking",
                          "Travellers",
                          "Occupancy",
                          "Status",
                        ].map((label) => (
                          <TableHead
                            key={label}
                            className="h-9 px-3 text-xs font-medium text-muted-foreground"
                          >
                            {label}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody className="divide-y divide-border/20">
                      {previewRows.map((row) => (
                        <TableRow
                          key={row.candidate.bookingNumber}
                          className={cn(!row.valid && "bg-destructive/5")}
                        >
                          <TableCell className="px-3 py-2 text-xs font-number text-muted-foreground align-top">
                            {row.candidate.bookingNumber}
                          </TableCell>
                          <TableCell className="px-3 py-2 align-top">
                            <p className="text-xs font-number text-foreground">
                              {row.candidate.payload.bookingReference}
                              {row.candidate.referenceGenerated && (
                                <span className="ml-1.5 text-[10px] text-muted-foreground font-sans">
                                  auto
                                </span>
                              )}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {row.candidate.payload.primaryContactName ||
                                "(no contact)"}
                            </p>
                          </TableCell>
                          <TableCell className="px-3 py-2 align-top">
                            <p className="text-xs font-number text-foreground">
                              {row.candidate.travellers.length}
                            </p>
                            <p className="text-[11px] text-muted-foreground max-w-40 truncate">
                              {row.candidate.travellers
                                .map((traveller) => traveller.fullName || "—")
                                .join(", ")}
                            </p>
                          </TableCell>
                          <TableCell className="px-3 py-2 text-xs text-muted-foreground align-top">
                            {
                              ROOM_TYPE_LABELS[
                                row.candidate.payload.roomOccupancyPreference
                              ]
                            }
                          </TableCell>
                          <TableCell className="px-3 py-2 align-top">
                            {row.valid ? (
                              <Badge className={`${TONE_CLASS.success} border-none rounded-sm text-[10px]`}>
                                Ready
                              </Badge>
                            ) : (
                              <div className="flex flex-col gap-0.5">
                                {row.errors.map((error, i) => (
                                  <span
                                    key={i}
                                    className="text-[11px] text-destructive"
                                  >
                                    {error}
                                  </span>
                                ))}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          {results ? (
            <>
              <Button variant="outline" onClick={reset}>
                <RotateCcw /> Import Another File
              </Button>
              <Button onClick={close}>Done</Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button
                disabled={validRows.length === 0 || isImporting}
                onClick={runImport}
              >
                {isImporting && <Loader2 className="animate-spin" />}
                Import {validTravellers > 0 ? validTravellers : ""} Pilgrim
                {validTravellers === 1 ? "" : "s"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ImportPilgrimsDialog;
