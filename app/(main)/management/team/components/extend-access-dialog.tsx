"use client";

import { format } from "date-fns";
import { CalendarIcon, Loader2 } from "lucide-react";
import React, { useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";

import { extendSeasonalAccessAction } from "../actions";

export interface ExtendAccessMemberRef {
  id: string;
  fullName: string;
  accessEndsOn: string | null;
}

interface ExtendAccessDialogProps {
  member: ExtendAccessMemberRef | null;
  onClose: () => void;
}

export default function ExtendAccessDialog({ member, onClose }: ExtendAccessDialogProps) {
  const [accessEndsOn, setAccessEndsOn] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useResetOnOpen(member !== null, member?.id ?? "", () => {
    setAccessEndsOn("");
    setError(null);
  });

  if (!member) return null;

  const selected = accessEndsOn ? new Date(`${accessEndsOn}T00:00:00`) : undefined;
  const pad = (n: number) => String(n).padStart(2, "0");

  const submit = async () => {
    if (!accessEndsOn) return;
    setSubmitting(true);
    const result = await extendSeasonalAccessAction({ staffId: member.id, accessEndsOn });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not extend access.");
      return;
    }
    toast.add({ title: "Access extended", description: `${member.fullName}'s access now runs until ${accessEndsOn}.` });
    onClose();
  };

  return (
    <Dialog open={member !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm gap-4">
        <DialogHeader>
          <DialogTitle>Extend Access</DialogTitle>
          <DialogDescription>
            {member.fullName}
            {member.accessEndsOn ? ` — access currently ends ${member.accessEndsOn}.` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">New end date *</label>
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger className="w-full">
              <InputGroup className="cursor-pointer">
                <InputGroupInput
                  readOnly
                  value={selected ? format(selected, "PP") : ""}
                  placeholder="Pick a date"
                  className="cursor-pointer"
                />
                <CalendarIcon className="size-4 text-muted-foreground mr-2" />
              </InputGroup>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-0">
              <Calendar
                mode="single"
                selected={selected}
                defaultMonth={selected}
                onSelect={(d) => {
                  if (!d) return;
                  setAccessEndsOn(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
                  setCalendarOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !accessEndsOn}>
            {submitting && <Loader2 className="animate-spin" />} Extend Access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
