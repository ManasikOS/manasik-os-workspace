"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";

import { header } from "@/components/data-table/sortable-header";
import { ToneBadge } from "@/components/ui/tone-badge";
import { AUDIT_SOURCE_LABELS } from "@/lib/data/settings-copy";
import type { AuditLogRow } from "@/lib/types/settings";
import type { Tone } from "@/lib/ui/tone";

import { ActorChip } from "@/components/ui/copilot-mark";
const SOURCE_TONE: Record<string, Tone> = {
  GROUP: "brand",
  PILGRIM: "info",
  STAFF: "neutral",
  SETTINGS: "warning",
};

export const auditLogColumns: ColumnDef<AuditLogRow>[] = [
  {
    id: "date",
    header: header("Date"),
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {format(new Date(row.original.created_at), "PP p")}
      </span>
    ),
  },
  {
    id: "user",
    header: header("User"),
    cell: ({ row }) => <ActorChip name={row.original.actor_name_snapshot} inline />,
  },
  {
    id: "action",
    header: header("Action"),
    cell: ({ row }) => <span className="text-sm text-foreground">{row.original.action}</span>,
  },
  {
    id: "entity",
    header: header("Entity"),
    cell: ({ row }) => (
      <div className="flex items-center gap-1.5">
        <ToneBadge tone={SOURCE_TONE[row.original.source] ?? "neutral"} label={AUDIT_SOURCE_LABELS[row.original.source] ?? row.original.source} />
        <span className="text-xs text-muted-foreground">{row.original.entity_label}</span>
      </div>
    ),
  },
  {
    id: "branch",
    header: header("Branch"),
    cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.branch ?? "—"}</span>,
  },
];
