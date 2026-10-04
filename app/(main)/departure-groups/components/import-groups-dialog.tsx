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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { createDepartureGroupSchema } from "@/lib/validations/departure-groups";
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
  importDepartureGroupsAction,
  type ImportRowResult,
} from "../actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  buildImportCandidates,
  downloadBinaryFile,
  downloadTextFile,
  importTemplateCsv,
  importTemplateMatrix,
  type ImportCandidate,
} from "../csv";
import { matrixToXlsx, readSpreadsheetFile, XLSX_MIME } from "../xlsx";
import type { PackageTemplateOption } from "../types";
import { TONE_CLASS, TONE_TEXT } from "@/lib/ui/tone";

interface PreviewRow {
  candidate: ImportCandidate;
  errors: string[];
  valid: boolean;
}

interface ImportGroupsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: PackageTemplateOption[];
}

/**
 * CSV import in one dialog: upload → preview with per-row validation → confirm.
 *
 * Validation runs twice on purpose. Here, `createDepartureGroupSchema` gives the
 * operator an inline preview of exactly which rows will fail and why. On submit,
 * only the valid rows are sent, and the Server Action validates them again as
 * the real gate.
 */
const ImportGroupsDialog = ({
  open,
  onOpenChange,
  templates,
}: ImportGroupsDialogProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, startImport] = useTransition();

  const [fileName, setFileName] = useState<string | null>(null);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [results, setResults] = useState<ImportRowResult[] | null>(null);

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
    const example = templates.find((template) => template.isOpenForSale) ?? templates[0];
    if (format === "xlsx") {
      downloadBinaryFile(
        "departure-groups-import-template.xlsx",
        matrixToXlsx(importTemplateMatrix(example), "Import"),
        XLSX_MIME,
      );
    } else {
      downloadTextFile(
        "departure-groups-import-template.csv",
        importTemplateCsv(example),
      );
    }
    toast.add({
      title: "Template downloaded",
      description: "Fill in one row per group, then upload the file here.",
    });
  };

  const handleFile = async (file: File) => {
    setResults(null);
    setFileName(file.name);

    try {
      const rows = await readSpreadsheetFile(file);
      const { candidates: mapped, headerError: error } = buildImportCandidates(
        rows,
        templates,
      );
      setHeaderError(error);
      setCandidates(mapped);
      if (!error && mapped.length === 0) {
        setHeaderError("The file has a header row but no data rows.");
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
   * Preview rows: schema errors plus mapping errors plus in-file duplicate
   * detection (the second occurrence of a code is the one flagged, so the first
   * still imports).
   */
  const previewRows = useMemo<PreviewRow[]>(() => {
    const seen = new Map<string, number>();

    return candidates.map((candidate) => {
      const errors = [...candidate.mappingErrors];

      const code = candidate.payload.groupCode.trim().toUpperCase();
      if (code) {
        const firstAt = seen.get(code);
        if (firstAt !== undefined) {
          errors.push(`Duplicate group code — also on row ${firstAt}.`);
        } else {
          seen.set(code, candidate.rowNumber);
        }
      }

      const parsed = createDepartureGroupSchema.safeParse(candidate.payload);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          // Skip the package-id message when we already have a clearer
          // "unknown package code" mapping error for the same row.
          if (
            issue.path[0] === "packageTemplateId" &&
            candidate.mappingErrors.length > 0
          ) {
            continue;
          }
          errors.push(issue.message);
        }
      }

      return { candidate, errors, valid: errors.length === 0 };
    });
  }, [candidates]);

  const validRows = previewRows.filter((row) => row.valid);
  const invalidCount = previewRows.length - validRows.length;

  const runImport = () => {
    if (validRows.length === 0) return;

    startImport(async () => {
      const result = await importDepartureGroupsAction(
        validRows.map((row) => row.candidate.payload),
      );

      if (!result.ok) {
        toast.add({ title: "Import failed", description: result.error });
        return;
      }

      setResults(result.results);
      toast.add({
        title: "Import complete",
        description: `${result.created} of ${result.total} group${
          result.total === 1 ? "" : "s"
        } created.`,
      });
    });
  };

  const createdCount = results?.filter((r) => r.ok).length ?? 0;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Departure Groups</DialogTitle>
          <DialogDescription>
            Upload an Excel (.xlsx) or CSV file to create several groups at
            once. Each row is created from its package template exactly like the
            Create form — package defaults are copied into an independent
            snapshot.
          </DialogDescription>
        </DialogHeader>

        {/* Phase 3: results */}
        {results ? (
          <div className="flex flex-col gap-3">
            <div className={`flex items-center gap-2 rounded-sm px-3 py-2.5 text-sm ${TONE_CLASS.success}`}>
              <CheckCircle2 className="size-4" />
              {createdCount} group{createdCount === 1 ? "" : "s"} created.
            </div>
            {results.some((r) => !r.ok) && (
              <div className="max-h-60 overflow-y-auto custom-scroll rounded-sm border border-border/40">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-none!">
                      {["Row", "Code", "Result"].map((label) => (
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
                      .filter((r) => !r.ok)
                      .map((row) => (
                        <TableRow key={row.rowNumber}>
                          <TableCell className="px-3 py-2 text-xs font-number text-muted-foreground">
                            {row.rowNumber}
                          </TableCell>
                          <TableCell className="px-3 py-2 text-xs font-number text-foreground">
                            {row.groupCode}
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
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
                    <Button variant="outline">
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
              <div className="rounded-md border border-dashed border-border/60 px-4 py-6 text-center">
                <FileUp className="size-6 text-muted-foreground/60 mx-auto" />
                <p className="text-sm font-medium text-foreground mt-2">
                  Upload an Excel or CSV file to preview it here
                </p>
                <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                  Required columns:{" "}
                  <span className="font-number">group_name</span>,{" "}
                  <span className="font-number">group_code</span>,{" "}
                  <span className="font-number">package_code</span>. The template
                  includes every optional column and one worked example row.
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
                <div className="flex items-center gap-3 text-xs">
                  <span className={`inline-flex items-center gap-1.5 ${TONE_TEXT.success}`}>
                    <CheckCircle2 className="size-3.5" />
                    {validRows.length} ready
                  </span>
                  {invalidCount > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-destructive">
                      <CircleAlert className="size-3.5" />
                      {invalidCount} with errors
                    </span>
                  )}
                </div>

                <div className="max-h-72 overflow-y-auto custom-scroll rounded-sm border border-border/40">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent border-none!">
                        {["Row", "Group", "Package", "Status"].map((label) => (
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
                          key={row.candidate.rowNumber}
                          className={cn(!row.valid && "bg-destructive/5")}
                        >
                          <TableCell className="px-3 py-2 text-xs font-number text-muted-foreground align-top">
                            {row.candidate.rowNumber}
                          </TableCell>
                          <TableCell className="px-3 py-2 align-top">
                            <p className="text-xs font-medium text-foreground">
                              {row.candidate.groupName}
                            </p>
                            <p className="text-[11px] font-number text-muted-foreground">
                              {row.candidate.groupCode}
                            </p>
                          </TableCell>
                          <TableCell className="px-3 py-2 text-xs text-muted-foreground align-top max-w-40 truncate">
                            {row.candidate.packageLabel}
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
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button
                disabled={validRows.length === 0 || isImporting}
                onClick={runImport}
              >
                {isImporting && <Loader2 className="animate-spin" />}
                Import {validRows.length > 0 ? validRows.length : ""} Group
                {validRows.length === 1 ? "" : "s"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ImportGroupsDialog;
