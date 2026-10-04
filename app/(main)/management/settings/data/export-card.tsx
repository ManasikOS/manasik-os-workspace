"use client";

import { Download, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import InputFormCard from "@/components/ui/input-form-card";
import { toast } from "@/components/ui/toast";
import { downloadTextFile, timestampedFilename } from "@/lib/csv";
import { EXPORT_ENTITY_LABELS } from "@/lib/data/settings-copy";
import type { AuditLogRow } from "@/lib/types/settings";

import { auditLogToCsv } from "../csv";
import { UnavailableNote } from "../components/unavailable-note";

const LIVE_ENTITIES = new Set(["AUDIT_LOG"]);

export function ExportCard({ auditLogRows }: { auditLogRows: AuditLogRow[] }) {
  const [exporting, setExporting] = useState<string | null>(null);

  const exportEntity = (entity: string) => {
    if (entity !== "AUDIT_LOG") return;
    setExporting(entity);
    downloadTextFile(timestampedFilename("audit-log"), auditLogToCsv(auditLogRows));
    setExporting(null);
    toast.add({ title: "Audit log exported" });
  };

  return (
    <InputFormCard title="Export data" icon={<Download className="size-4" />}>
      <UnavailableNote reason="Only the Audit Log export is wired up today. Pilgrims, Bookings, Payments, Invoices and Reports exports are on the build plan." />
      <div className="flex flex-col gap-2 mt-2">
        {Object.entries(EXPORT_ENTITY_LABELS).map(([key, label]) => {
          const live = LIVE_ENTITIES.has(key);
          return (
            <Button
              key={key}
              variant="outline"
              size="sm"
              className="self-start"
              disabled={!live || exporting === key}
              onClick={() => exportEntity(key)}
            >
              {exporting === key && <Loader2 className="animate-spin" />} {label}
            </Button>
          );
        })}
      </div>
    </InputFormCard>
  );
}
