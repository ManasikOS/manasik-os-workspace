"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CalendarRange, Loader2, Search, Users } from "lucide-react";
import React, { useEffect, useState } from "react";

import { findAvailableGroupsAction, type AvailableGroupOption } from "../actions";
import type { LeadListItem } from "../types";
import { formatDate, ROOM_PREFERENCE_LABELS } from "../utils";
import { TONE_CLASS, TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

interface FindAvailableGroupsSheetProps {
  lead: LeadListItem | null;
  onClose: () => void;
  onSelect: (group: AvailableGroupOption) => void;
}

function roomPrice(group: AvailableGroupOption, room: LeadListItem["roomPreference"]): number | null {
  switch (room) {
    case "QUAD":
      return group.quadPrice;
    case "TRIPLE":
      return group.triplePrice;
    case "DOUBLE":
      return group.doublePrice;
    case "SINGLE":
      return group.singlePrice;
    default:
      return group.triplePrice ?? group.quadPrice ?? group.doublePrice ?? group.singlePrice;
  }
}

/**
 * Only sellable groups with enough seats for this lead's party — filtered
 * server-side in `findAvailableGroupsAction`. Selecting one just records
 * interest (`selected_departure_group_id`); it never touches seat counts.
 */
const FindAvailableGroupsSheet = ({ lead, onClose, onSelect }: FindAvailableGroupsSheetProps) => {
  return (
    <Sheet open={lead !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="data-[side=right]:sm:max-w-md w-full">
        {lead && (
          <GroupSearchResults key={lead.id} lead={lead} onSelect={onSelect} />
        )}
      </SheetContent>
    </Sheet>
  );
};

function GroupSearchResults({
  lead,
  onSelect,
}: {
  lead: LeadListItem;
  onSelect: (group: AvailableGroupOption) => void;
}) {
  // Starts `true` and only ever moves to `false` once the fetch below settles —
  // keying this component on `lead.id` (see above) remounts it, and therefore
  // resets this state, whenever a different lead's sheet opens.
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<AvailableGroupOption[]>([]);

  useEffect(() => {
    findAvailableGroupsAction({
      journeyType: lead.journeyType,
      packageId: lead.packageId,
      requiredSeats: lead.partySize,
    })
      .then(setGroups)
      .finally(() => setLoading(false));
  }, [lead]);

  return (
    <>
      <SheetHeader className="gap-1">
        <div className="flex items-center gap-2 text-base font-bold">
          <Search className="size-4 text-primary" />
          <SheetTitle>Available departure groups</SheetTitle>
        </div>
        <p className="text-sm text-muted-foreground">
          {lead.name} needs {lead.partySize} seat{lead.partySize === 1 ? "" : "s"} ·{" "}
          {ROOM_PREFERENCE_LABELS[lead.roomPreference]}
        </p>
      </SheetHeader>

      <div className="flex flex-col gap-3 px-4 pb-6">
        {loading && (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        )}

        {!loading && groups.length === 0 && (
          <Card className="p-4 text-sm text-muted-foreground text-center">
            No sellable groups currently have {lead.partySize} seat
            {lead.partySize === 1 ? "" : "s"} free for this journey type.
          </Card>
        )}

        {!loading &&
          groups.map((group) => {
            const price = roomPrice(group, lead.roomPreference);
            return (
              <Card key={group.id} className="p-3 gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{group.groupName}</p>
                    <p className="text-xs text-muted-foreground font-number">{group.groupCode}</p>
                  </div>
                  <Badge
                    className={cn(
                      "border-none",
                      TONE_CLASS[group.salesStatus === "SELLING" ? "success" : "warning"],
                    )}
                  >
                    {group.salesStatus === "SELLING" ? "Selling" : "Limited Availability"}
                  </Badge>
                </div>

                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <CalendarRange className="size-3.5" />
                    {formatDate(group.departureDate)} – {formatDate(group.returnDate)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="size-3.5" />
                    {group.availableSeats} seats left
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className={cn("text-sm font-semibold font-number", TONE_TEXT.success)}>
                    {price !== null ? `${group.currency} ${price.toLocaleString()}` : "Price not set"}
                  </span>
                  <Button size="sm" onClick={() => onSelect(group)}>
                    Select
                  </Button>
                </div>
              </Card>
            );
          })}
      </div>
    </>
  );
}

export default FindAvailableGroupsSheet;
