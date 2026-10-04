"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import type { CreateLeadInput } from "@/lib/data/leads";
import { AlertTriangle, CheckCircle2, Download, Import, Upload } from "lucide-react";
import React, { useRef, useState } from "react";

import type { StaffRow } from "@/lib/types/leads";
import type { LeadListItem, LeadPackageRow } from "../types";
import {
  downloadTextFile,
  importTemplateCsv,
  matrixToLeadInputs,
  parseCsv,
  type ImportPreview,
} from "../csv";
import { TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

interface ImportLeadsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingLeads: LeadListItem[];
  defaultAssigneeId: string;
  defaultAssigneeName: string;
  packages: LeadPackageRow[];
  staffOptions: StaffRow[];
  onImport: (rows: CreateLeadInput[]) => void;
}

const MAX_BYTES = 2 * 1024 * 1024;

/**
 * CSV import. Parsing and validation happen entirely in the browser and the
 * result is shown as a preview before anything is written, so an operator sees
 * every bad row at once rather than discovering them one failed import later.
 */
const ImportLeadsDialog = ({
  open,
  onOpenChange,
  existingLeads,
  defaultAssigneeId,
  defaultAssigneeName,
  packages,
  staffOptions,
  onImport,
}: ImportLeadsDialogProps) => {
  const fileInput = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  const reset = () => {
    setFilename(null);
    setPreview(null);
    setFatal(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const close = () => {
    reset();
    onOpenChange(false);
  };

  const readFile = async (file: File) => {
    if (file.size > MAX_BYTES) {
      setFatal("That file is larger than 2 MB. Split it and import in batches.");
      return;
    }

    try {
      const text = await file.text();
      const matrix = parseCsv(text);
      const existingMobiles = new Map(
        existingLeads.map((lead) => [lead.mobileRaw, lead.reference]),
      );
      setPreview(
        matrixToLeadInputs(matrix, {
          existingMobiles,
          defaultAssigneeId,
          defaultAssigneeName,
          packages,
          staffOptions,
        }),
      );
      setFilename(file.name);
      setFatal(null);
    } catch {
      setFatal("That file could not be read as CSV.");
    }
  };

  const confirm = () => {
    if (!preview || preview.rows.length === 0) return;
    onImport(preview.rows);
    close();
  };

  const ready = preview !== null && preview.rows.length > 0;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Import className="size-4 text-primary" /> Import leads
          </DialogTitle>
          <DialogDescription>
            Upload a CSV with at least a <strong>Full Name</strong> and a{" "}
            <strong>Mobile</strong> column. Nothing is uploaded anywhere — the
            file is read in your browser.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readFile(file);
              }}
            />
            <Button variant="secondary" onClick={() => fileInput.current?.click()}>
              <Upload /> Choose CSV
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                downloadTextFile("leads-import-template.csv", importTemplateCsv())
              }
            >
              <Download /> Download template
            </Button>
            {filename && (
              <span className="text-xs text-muted-foreground truncate">
                {filename}
              </span>
            )}
          </div>

          {fatal && (
            <Card className="p-3 gap-1 border-destructive/30 bg-destructive/5">
              <p
                role="alert"
                className="text-xs text-destructive font-medium flex items-center gap-1.5"
              >
                <AlertTriangle className="size-3.5" />
                {fatal}
              </p>
            </Card>
          )}

          {preview && (
            <Card className="p-3 gap-2 max-h-72 overflow-y-auto custom-scroll">
              <p className="text-sm font-semibold flex items-center gap-1.5">
                {ready ? (
                  <CheckCircle2 className={cn("size-4", TONE_TEXT.success)} />
                ) : (
                  <AlertTriangle className={cn("size-4", TONE_TEXT.warning)} />
                )}
                {preview.rows.length} lead
                {preview.rows.length === 1 ? "" : "s"} ready to import
              </p>

              {preview.duplicates.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  <p className={cn("font-medium", TONE_TEXT.warning)}>
                    {preview.duplicates.length} row
                    {preview.duplicates.length === 1 ? "" : "s"} skipped as
                    duplicates:
                  </p>
                  <ul className="list-disc ps-4 mt-1 space-y-0.5">
                    {preview.duplicates.slice(0, 8).map((duplicate) => (
                      <li key={`${duplicate.row}-${duplicate.name}`}>
                        Row {duplicate.row}: {duplicate.name} already exists as{" "}
                        {duplicate.existingReference}
                      </li>
                    ))}
                    {preview.duplicates.length > 8 && (
                      <li>…and {preview.duplicates.length - 8} more</li>
                    )}
                  </ul>
                </div>
              )}

              {preview.issues.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  <p className="font-medium text-destructive">
                    {preview.issues.length} issue
                    {preview.issues.length === 1 ? "" : "s"}:
                  </p>
                  <ul className="list-disc ps-4 mt-1 space-y-0.5">
                    {preview.issues.slice(0, 8).map((issue, index) => (
                      <li key={`${issue.row}-${index}`}>
                        Row {issue.row}: {issue.message}
                      </li>
                    ))}
                    {preview.issues.length > 8 && (
                      <li>…and {preview.issues.length - 8} more</li>
                    )}
                  </ul>
                </div>
              )}

              {ready && (
                <ul className="text-xs text-muted-foreground mt-1 space-y-0.5">
                  {preview.rows.slice(0, 5).map((row, index) => (
                    <li key={`${row.mobile}-${index}`}>
                      {row.fullName} · +94 {row.mobile}
                    </li>
                  ))}
                  {preview.rows.length > 5 && (
                    <li>…and {preview.rows.length - 5} more</li>
                  )}
                </ul>
              )}
            </Card>
          )}
        </div>

        <DialogFooter className="gap-2 border-t pt-3 border-border/40">
          <Button variant="outline" onClick={close} className="text-xs font-semibold">
            Cancel
          </Button>
          <Button
            disabled={!ready}
            onClick={() => {
              if (!ready) {
                toast.add({
                  title: "Nothing to import",
                  description: "No valid rows were found in that file.",
                });
                return;
              }
              confirm();
            }}
            className="text-xs font-semibold"
          >
            <Import /> Import {preview?.rows.length ?? 0} lead
            {preview?.rows.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ImportLeadsDialog;
