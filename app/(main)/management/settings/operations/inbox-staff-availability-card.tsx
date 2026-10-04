"use client";

import { CalendarClock, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import InputFormCard from "@/components/ui/input-form-card";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import type { StaffAvailabilityRecord } from "@/lib/inbox/routing/availability";

import { createInboxStaffAvailabilityAction, removeInboxStaffAvailabilityAction } from "./inbox-routing-actions";

function localTime(iso: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export function InboxStaffAvailabilityCard({ staff, entries, canEdit }: { staff: Array<{ id: string; name: string }>; entries: StaffAvailabilityRecord[]; canEdit: boolean }) {
  const router = useRouter();
  const [staffId, setStaffId] = useState(staff[0]?.id ?? "");
  const [kind, setKind] = useState<StaffAvailabilityRecord["kind"]>("SHIFT");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [pending, startTransition] = useTransition();

  function save() {
    if (!staffId || !startsAt || !endsAt) {
      toast.add({ title: "Add a staff member and both times", description: "Availability needs a person, a start, and an end." });
      return;
    }
    startTransition(async () => {
      const result = await createInboxStaffAvailabilityAction({ staffId, kind, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString() });
      if (!result.ok) {
        toast.add({ title: "Availability was not saved", description: result.error ?? "Try again." });
        return;
      }
      setStartsAt("");
      setEndsAt("");
      toast.add({ title: kind === "SHIFT" ? "Shift added" : "Leave added", description: "Inbox assignment uses this immediately." });
      router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const result = await removeInboxStaffAvailabilityAction(id);
      if (!result.ok) {
        toast.add({ title: "Availability was not removed", description: result.error ?? "Try again." });
        return;
      }
      router.refresh();
    });
  }

  const nameFor = (id: string) => staff.find((person) => person.id === id)?.name ?? "Former staff member";
  return (
    <InputFormCard title="Inbox staff availability" icon={<CalendarClock className="size-4" />} desc="Add a shift before a person can receive conversations. A leave entry overrides an overlapping shift.">
      {canEdit && (
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5"><label className="text-xs font-medium text-muted-foreground">Staff member</label><Select value={staffId} onValueChange={(value) => setStaffId(value ?? "")} disabled={pending || staff.length === 0}><SelectTrigger><SelectValue placeholder="Choose staff" /></SelectTrigger><SelectContent>{staff.map((person) => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="flex flex-col gap-1.5"><label className="text-xs font-medium text-muted-foreground">Availability</label><Select value={kind} onValueChange={(value) => setKind(value as StaffAvailabilityRecord["kind"])} disabled={pending}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="SHIFT">Working shift</SelectItem><SelectItem value="LEAVE">Leave / unavailable</SelectItem></SelectContent></Select></div>
          <InputGroup><InputGroupAddon align="block-start"><InputGroupText>Starts</InputGroupText></InputGroupAddon><InputGroupInput type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} disabled={pending} /></InputGroup>
          <InputGroup><InputGroupAddon align="block-start"><InputGroupText>Ends</InputGroupText></InputGroupAddon><InputGroupInput type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} disabled={pending} /></InputGroup>
        </div>
      )}
      {canEdit && <div className="mt-3 flex justify-end"><Button onClick={save} disabled={pending || staff.length === 0}>{pending ? "Saving…" : "Add availability"}</Button></div>}
      <div className="mt-4 space-y-2">
        {entries.length === 0 ? <p className="text-xs text-muted-foreground">No shifts are set. Automatic assignment will leave conversations unassigned until a working shift exists.</p> : entries.map((entry) => <div key={entry.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"><span><span className="font-medium">{nameFor(entry.staffId)}</span><span className="ml-2 text-muted-foreground">{entry.kind === "SHIFT" ? "Working shift" : "Leave"} · {localTime(entry.startsAt)} – {localTime(entry.endsAt)}</span></span>{canEdit && <Button variant="ghost" size="icon" onClick={() => remove(entry.id)} disabled={pending} aria-label={`Remove availability for ${nameFor(entry.staffId)}`}><Trash2 className="size-4" /></Button>}</div>)}
      </div>
    </InputFormCard>
  );
}
