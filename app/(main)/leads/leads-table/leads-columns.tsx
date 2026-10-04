"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  header,
  sortableHeader,
} from "@/components/data-table/sortable-header";
import type { DataTableSort } from "@/components/data-table/data-table";
import { PersonChip, ToneBadge } from "@/components/ui/tone-badge";
import { TONE_BAR, TONE_CLASS, TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";
import type { ColumnDef } from "@tanstack/react-table";
import {
  AlertCircle,
  Ban,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock,
  Eye,
  MessageSquare,
  MoreHorizontal,
  PhoneCall,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
} from "lucide-react";
import React from "react";

import type { StaffRow } from "@/lib/types/leads";
import type { LeadListItem, LeadStage } from "../types";
import {
  ACTIVE_STAGE_ORDER,
  FOLLOW_UP_TONES,
  JOURNEY_TYPE_LABELS,
  STAGE_LABELS,
  STAGE_TONES,
  TEMPERATURE_LABELS,
  TEMPERATURE_TONES,
  followUpLabel,
  formatCurrencyLKR,
  nextStage,
  partySizeLabel,
  whatsappLink,
  type LeadSort,
  type LeadSortField,
} from "../utils";

export interface LeadRowActions {
  onOpen: (lead: LeadListItem) => void;
  onLogContact: (lead: LeadListItem) => void;
  onChangeStage: (lead: LeadListItem, stage: LeadStage) => void;
  onAssign: (lead: LeadListItem, staffId: string) => void;
  onMarkLost: (lead: LeadListItem) => void;
}

/** Which sort field each column header drives, for `aria-sort` on the `<th>`. */
export const LEAD_COLUMN_SORT_FIELDS: Record<string, LeadSortField> = {
  lead: "name",
  stage: "stage",
  owner: "owner",
  followUp: "followUp",
  value: "value",
};

/** Stages offered in the inline stage menu. Terminal stages have their own guarded actions. */
const SELECTABLE_STAGES = ACTIVE_STAGE_ORDER;

export function buildLeadColumns(
  actions: LeadRowActions,
  sort: LeadSort,
  onSortChange: (sort: DataTableSort) => void,
  staffOptions: StaffRow[],
): ColumnDef<LeadListItem>[] {
  return [
    {
      id: "lead",
      header: sortableHeader("Lead Info", "name", sort, onSortChange),
      cell: ({ row }) => {
        const lead = row.original;
        return (
          <div className="flex items-start gap-3 py-1">
            <div
              className={cn(
                "size-9 rounded-full shadow-md flex items-center justify-center font-bold text-xs shrink-0",
                lead.avatarTone,
              )}
              aria-hidden
            >
              {lead.initials}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-medium group-hover:text-primary transition-colors tracking-tight text-sm text-foreground truncate flex items-center gap-1.5">
                {lead.name}
                <ToneBadge
                  tone={TEMPERATURE_TONES[lead.temperature]}
                  label={TEMPERATURE_LABELS[lead.temperature]}
                  className="text-[10px] px-1.5 py-0.5"
                />
              </span>
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                <Badge
                  variant="outline"
                  className="text-muted-foreground text-[10px] font-number"
                >
                  {lead.reference}
                </Badge>
                <span className="truncate">{lead.city}</span>
              </div>
            </div>
          </div>
        );
      },
    },
    {
      id: "interest",
      header: header("Interest"),
      cell: ({ row }) => {
        const lead = row.original;
        return (
          <div className="flex flex-col gap-1 max-w-56">
            <span className="text-xs font-medium text-foreground/90 flex items-center gap-1.5">
              {lead.journeyType === "HAJJ" && (
                // eslint-disable-next-line no-restricted-syntax -- Hajj journey-type marker, not a status/severity signal
                <Sparkles className="size-3 text-amber-500 shrink-0" />
              )}
              <span className="truncate" title={lead.interestedIn}>
                {lead.interestedIn}
              </span>
            </span>
            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Users className="size-3 shrink-0" />
              {partySizeLabel(lead.adults, lead.children)}
            </span>
          </div>
        );
      },
    },
    {
      id: "package",
      header: header("Desired Package"),
      cell: ({ row }) => {
        const lead = row.original;
        return (
          <span
            className={cn(
              "text-xs truncate max-w-48 inline-block",
              lead.packageId
                ? "text-foreground/90"
                : "text-muted-foreground italic",
            )}
            title={lead.packageName}
          >
            {lead.packageName}
          </span>
        );
      },
    },
    {
      id: "stage",
      header: sortableHeader("Pipeline Stage", "stage", sort, onSortChange),
      cell: ({ row }) => {
        const lead = row.original;
        const tone = STAGE_TONES[lead.stage];

        return (
          <DropdownMenu>
            <DropdownMenuTrigger
              onClick={(event) => event.stopPropagation()}
              aria-label={`Change stage — currently ${STAGE_LABELS[lead.stage]}`}
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "gap-1.5 px-2.5 font-medium border-none",
                    TONE_CLASS[tone],
                  )}
                >
                  <span
                    className={cn("size-1.5 rounded-full", TONE_BAR[tone])}
                    aria-hidden
                  />
                  {STAGE_LABELS[lead.stage]}
                </Button>
              }
            />
            <DropdownMenuContent
              align="start"
              onClick={(event) => event.stopPropagation()}
            >
              <DropdownMenuLabel>Move to stage</DropdownMenuLabel>
              {SELECTABLE_STAGES.map((stage) => (
                <DropdownMenuItem
                  key={stage}
                  disabled={stage === lead.stage}
                  onClick={() => actions.onChangeStage(lead, stage)}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      TONE_BAR[STAGE_TONES[stage]],
                    )}
                    aria-hidden
                  />
                  {STAGE_LABELS[stage]}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => actions.onMarkLost(lead)}
              >
                <Ban /> Mark as Lost…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
    {
      id: "owner",
      header: sortableHeader("Assigned", "owner", sort, onSortChange),
      cell: ({ row }) => <PersonChip name={row.original.assignedToName} />,
    },
    {
      id: "followUp",
      header: sortableHeader("Next Follow-Up", "followUp", sort, onSortChange),
      cell: ({ row }) => {
        const lead = row.original;
        const label = followUpLabel(
          lead.nextFollowUpAt,
          lead.daysUntilFollowUp,
        );

        if (lead.isClosed) {
          return (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <CheckCircle2
                className={cn("size-3 shrink-0", TONE_TEXT.success)}
              />
              {lead.stage === "LOST" ? "Closed — lost" : "Closed — converted"}
            </span>
          );
        }

        if (lead.followUpStatus === "NONE") {
          return (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <CalendarClock className="size-3 shrink-0" />
              No follow-up scheduled
            </span>
          );
        }

        const Icon = lead.followUpStatus === "OVERDUE" ? AlertCircle : Clock;

        return (
          <ToneBadge
            tone={FOLLOW_UP_TONES[lead.followUpStatus]}
            icon={<Icon className="size-3 shrink-0" />}
            label={label}
            className="rounded-sm px-2 py-0.5"
          />
        );
      },
    },
    {
      id: "value",
      header: sortableHeader("Est. Value", "value", sort, onSortChange),
      cell: ({ row }) => (
        <ToneBadge
          tone="success"
          icon={<TrendingUp className="size-3" />}
          label={formatCurrencyLKR(row.original.estimatedValueLkr)}
          className="font-number"
        />
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => {
        const lead = row.original;
        const advance = nextStage(lead.stage);

        return (
          <DropdownMenu>
            <DropdownMenuTrigger
              onClick={(event) => event.stopPropagation()}
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Actions for ${lead.name}`}
                >
                  <MoreHorizontal />
                </Button>
              }
            />
            <DropdownMenuContent
              align="end"
              onClick={(event) => event.stopPropagation()}
            >
              <DropdownMenuLabel>{lead.reference}</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => actions.onOpen(lead)}>
                <Eye /> Open Lead
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => actions.onLogContact(lead)}>
                <MessageSquare /> Log Contact…
              </DropdownMenuItem>

              {/* No number yet (Messenger/Instagram lead): nothing to call or open on WhatsApp. */}
              {lead.mobileRaw && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    render={<a href={`tel:+94${lead.mobileRaw}`} />}
                  >
                    <PhoneCall /> Call {lead.mobile}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    render={
                      <a
                        href={whatsappLink(lead.mobileRaw)}
                        target="_blank"
                        rel="noreferrer noopener"
                      />
                    }
                  >
                    <MessageSquare /> Open WhatsApp
                  </DropdownMenuItem>
                </>
              )}

              <DropdownMenuSeparator />
              {advance && (
                <DropdownMenuItem
                  onClick={() => actions.onChangeStage(lead, advance)}
                >
                  <ChevronRight /> Advance to {STAGE_LABELS[advance]}
                </DropdownMenuItem>
              )}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <UserCheck /> Reassign
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {staffOptions.map((staff) => (
                    <DropdownMenuItem
                      key={staff.id}
                      disabled={staff.id === lead.assignedToId}
                      onClick={() => actions.onAssign(lead, staff.id)}
                    >
                      {staff.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              {!lead.isClosed && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => actions.onMarkLost(lead)}
                  >
                    <Ban /> Mark as Lost…
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
}

/** Journey badge reused by the drawer header. */
export function JourneyBadge({ lead }: { lead: LeadListItem }) {
  return (
    <Badge variant="outline" className="gap-1 text-[11px]">
      {lead.journeyType === "HAJJ" && (
        // eslint-disable-next-line no-restricted-syntax -- Hajj journey-type marker, not a status/severity signal
        <Sparkles className="size-3 text-amber-500" />
      )}
      {JOURNEY_TYPE_LABELS[lead.journeyType]}
    </Badge>
  );
}
