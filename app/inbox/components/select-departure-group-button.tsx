"use client";

import { useState, useTransition } from "react";
import { CalendarDays, Loader2, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import {
  findAvailableGroupsAction,
  type AvailableGroupOption,
} from "@/app/(main)/leads/actions";

import { selectConversationDepartureGroup } from "../actions";
import { useInboxRefresh } from "./inbox-refresh-context";
import { Card } from "@/components/ui/card";

export default function SelectDepartureGroupButton({
  conversationId,
  lead,
}: {
  conversationId: string;
  lead: {
    journey_type: string;
    desired_package_id: string | null;
    adults: number;
    children: number;
  };
}) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<AvailableGroupOption[] | null>(null);
  const [isPending, startTransition] = useTransition();
  const travellers = lead.adults + lead.children;
  const refreshInbox = useInboxRefresh();

  function openPicker() {
    setOpen(true);
    setGroups(null);
    startTransition(async () =>
      setGroups(
        await findAvailableGroupsAction({
          journeyType: lead.journey_type,
          packageId: lead.desired_package_id,
          requiredSeats: travellers,
        }),
      ),
    );
  }

  function selectGroup(group: AvailableGroupOption) {
    startTransition(async () => {
      const result = await selectConversationDepartureGroup({
        conversationId,
        departureGroupId: group.id,
      });
      if (!result.ok) {
        toast.add({
          title: "Could not select group",
          description: result.error,
        });
        return;
      }
      toast.add({
        title: "Departure group selected",
        description: "You can now create the booking from this conversation.",
      });
      setOpen(false);
      refreshInbox();
    });
  }

  return (
    <>
      <Button type="button" className="w-full" onClick={openPicker}>
        Select departure group
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Available departure groups</DialogTitle>
            <DialogDescription>
              Only sellable groups with enough seats for {travellers} traveller
              {travellers === 1 ? "" : "s"} are shown.
            </DialogDescription>
          </DialogHeader>
          {groups === null && (
            <div className="flex justify-center py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          )}
          {groups?.length === 0 && (
            <p className="rounded-lg border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
              No suitable departure groups are currently available.
            </p>
          )}
          <div className="space-y-3">
            {groups?.map((group) => (
              <Card key={group.id} className=" gap-1 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{group.groupName}</p>
                    <p className="text-xs text-muted-foreground">
                      {group.groupCode}
                    </p>
                  </div>
                  <Badge variant="outline">
                    {group.salesStatus
                      .replaceAll("_", " ")
                      .charAt(0)
                      .toUpperCase() +
                      group.salesStatus
                        .replaceAll("_", " ")
                        .slice(1, group.salesStatus.replaceAll("_", " ").length)
                        .toLowerCase()}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <CalendarDays className="size-3.5" />
                    {group.departureDate} – {group.returnDate}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="size-3.5" />
                    {group.availableSeats} seats left
                  </span>
                </div>
                <Button
                  className="mt-3 w-full"
                  disabled={isPending}
                  onClick={() => selectGroup(group)}
                >
                  Select this group
                </Button>
              </Card>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
