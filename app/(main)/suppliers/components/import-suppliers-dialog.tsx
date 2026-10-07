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
import { TONE_CLASS, TONE_TEXT } from "@/lib/ui/tone";
import { matrixToXlsx, readSpreadsheetFile, XLSX_MIME } from "@/lib/xlsx";
import { createSupplierSchema } from "@/lib/validations/suppliers";
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
  importSuppliersAction,
  type SupplierImportRowResult,
} from "../actions";
import {
  buildSupplierImportCandidates,
  downloadBinaryFile,
  downloadTextFile,
  importTemplateCsv,
  importTemplateMatrix,
  type SupplierImportCandidate,
} from "../csv";

interface PreviewRow {
  candidate: SupplierImportCandidate;
  errors: string[];
  valid: boolean;
}

interface ImportSuppliersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingCodes: string[];
}

/**
 * Spreadsheet import in one dialog: upload → preview with per-row validation
 * → confirm. Mirrors `ImportGroupsDialog` in Departure Groups.
 *
 * Validation runs twice on purpose. Here, `createSupplierSchema` gives the
 * operator an inline preview of exactly which rows will fail and why. On
 * submit, only the valid rows are sent, and the Server Action validates them
 * again as the real gate.
 */
const ImportSuppliersDialog = ({
  open,
  onOpenChange,
  existingCodes,
}: ImportSuppliersDialogProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, startImport] = useTransition();

  const [fileName, setFileName] = useState<string | null>(null);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<SupplierImportCandidate[]>([]);
  const [results, setResults] = useState<SupplierImportRowResult[] | null>(
    null,
  );

  const existingCodeSet = useMemo(
    () => new Set(existingCodes.map((code) => code.toUpperCase())),
    [existingCodes],
  );

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
        "suppliers-import-template.xlsx",
        matrixToXlsx(importTemplateMatrix(), "Import"),
        XLSX_MIME,
      );
    } else {
      downloadTextFile("suppliers-import-template.csv", importTemplateCsv());
    }
    toast.add({
      title: "Template downloaded",
      description: "Fill in one row per supplier, then upload the file here.",
    });
  };

  const handleFile = async (file: File) => {
    setResults(null);
    setFileName(file.name);

    try {
      const rows = await readSpreadsheetFile(file);
      const { candidates: mapped, headerError: error } =
        buildSupplierImportCandidates(rows);
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
   * Preview rows: schema errors plus mapping errors plus duplicate detection
   * against both the existing directory and the rest of this file (the second
   * occurrence of a code is the one flagged, so the first still imports).
   */
  const previewRows = useMemo<PreviewRow[]>(() => {
    const seen = new Map<string, number>();

    return candidates.map((candidate) => {
      const errors = [...candidate.mappingErrors];

      const code = candidate.payload.supplierCode.trim().toUpperCase();
      if (code) {
        const firstAt = seen.get(code);
        if (firstAt !== undefined) {
          errors.push(`Duplicate supplier code — also on row ${firstAt}.`);
        } else if (existingCodeSet.has(code)) {
          errors.push("That supplier code is already in use.");
        } else {
          seen.set(code, candidate.rowNumber);
        }
      }

      const parsed = createSupplierSchema.safeParse(candidate.payload);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          errors.push(issue.message);
        }
      }

      return { candidate, errors, valid: errors.length === 0 };
    });
  }, [candidates, existingCodeSet]);

  const validRows = previewRows.filter((row) => row.valid);
  const invalidCount = previewRows.length - validRows.length;

  const runImport = () => {
    if (validRows.length === 0) return;

    startImport(async () => {
      const result = await importSuppliersAction(
        validRows.map((row) => row.candidate.payload),
      );

      if (!result.ok) {
        toast.add({ title: "Import failed", description: result.error });
        return;
      }

      setResults(result.results);
      toast.add({
        title: "Import complete",
        description: `${result.created} of ${result.total} supplier${
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
          <DialogTitle>Import Suppliers</DialogTitle>
          <DialogDescription>
            Upload an Excel (.xlsx) or CSV file to add several suppliers to the
            directory at once. Each row is created exactly like the Add Supplier
            form.
          </DialogDescription>
        </DialogHeader>

        {/* Phase 3: results */}
        {results ? (
          <div className="flex flex-col gap-3">
            <div
              className={cn(
                "flex items-center gap-2 rounded-sm px-3 py-2.5 text-sm",
                TONE_CLASS.success,
              )}
            >
              <CheckCircle2 className="size-4" />
              {createdCount} supplier{createdCount === 1 ? "" : "s"} created.
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
                          <TableCell className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                            {row.rowNumber}
                          </TableCell>
                          <TableCell className="px-3 py-2 text-xs tabular-nums text-foreground">
                            {row.supplierCode}
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
                  Required columns: <span className="tabular-nums">name</span>,{" "}
                  <span className="tabular-nums">supplier_code</span>,{" "}
                  <span className="tabular-nums">supplier_type</span>,{" "}
                  <span className="tabular-nums">whatsapp</span>. The template
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
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5",
                      TONE_TEXT.success,
                    )}
                  >
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
                        {["Row", "Supplier", "Code", "Status"].map((label) => (
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
                          <TableCell className="px-3 py-2 text-xs tabular-nums text-muted-foreground align-top">
                            {row.candidate.rowNumber}
                          </TableCell>
                          <TableCell className="px-3 py-2 align-top">
                            <p className="text-xs font-medium text-foreground">
                              {row.candidate.name}
                            </p>
                          </TableCell>
                          <TableCell className="px-3 py-2 text-xs tabular-nums text-muted-foreground align-top">
                            {row.candidate.supplierCode}
                          </TableCell>
                          <TableCell className="px-3 py-2 align-top">
                            {row.valid ? (
                              <Badge
                                className={cn(
                                  TONE_CLASS.success,
                                  "border-none rounded-sm text-[10px]",
                                )}
                              >
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
                Import {validRows.length > 0 ? validRows.length : ""} Supplier
                {validRows.length === 1 ? "" : "s"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ImportSuppliersDialog;
