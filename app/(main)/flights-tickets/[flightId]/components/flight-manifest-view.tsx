"use client";

import { useState } from "react";

import PageHeader from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputGroupField } from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { EmptyState, FlightStatusBadge } from "@/app/(main)/departure-groups/components/status-badges";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KpiCard } from "@/components/data-table/kpi-card";
import { Plus, Trash2, Users } from "lucide-react";

import { formatDateTime } from "@/app/(main)/departure-groups/utils";
import type { CrossGroupFlightRow, FlightManifestPassenger } from "@/lib/data/flights-repository";

import {
  assignPassengerToFlightAction,
  removePassengerFromFlightAction,
  updateFlightBaggageRulesAction,
} from "../../actions";

interface FlightManifestViewProps {
  flight: CrossGroupFlightRow;
  manifest: FlightManifestPassenger[];
  unassigned: FlightManifestPassenger[];
  canManage: boolean;
}

export default function FlightManifestView({ flight, manifest, unassigned, canManage }: FlightManifestViewProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [baggageOpen, setBaggageOpen] = useState(false);

  const unassignedInThisFlight = manifest.length < flight.seatCapacity ? flight.seatCapacity - manifest.length : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${flight.airline} ${flight.flightNumber ?? ""}`.trim()}
        breadcrumb={[
          { title: "Operations", link: "/operations" },
          { title: "Flights & Tickets", link: "/operations?tab=flights" },
          { title: flight.flightNumber ?? flight.id, link: `/flights-tickets/${flight.id}` },
        ]}
        subTitle={`${flight.originAirportCode} → ${flight.destinationAirportCode} · ${flight.direction} · ${flight.groupName} (${flight.groupCode})`}
        action={
          canManage && (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setBaggageOpen(true)}>Baggage rules</Button>
              <Button onClick={() => setAddOpen(true)} disabled={unassigned.length === 0}>
                <Plus /> Add passenger
              </Button>
            </div>
          )
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard title="Manifest" value={String(manifest.length)} />
        <KpiCard title="Seat capacity" value={String(flight.seatCapacity)} />
        <KpiCard title="Seats free" value={String(unassignedInThisFlight)} />
        <KpiCard title="Departure" value={formatDateTime(flight.departureAt)} />
      </div>

      <div className="flex items-center gap-2">
        <FlightStatusBadge value={flight.status} />
        {flight.pnr && <span className="text-xs text-muted-foreground font-number">PNR {flight.pnr}</span>}
      </div>

      {(flight.baggageAllowanceKg || flight.baggageNotes) && (
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">
            {flight.baggageAllowanceKg ? `${flight.baggageAllowanceKg}kg allowance` : "No allowance set"}
            {flight.baggageNotes ? ` — ${flight.baggageNotes}` : ""}
          </p>
        </Card>
      )}

      <Card className="p-0 overflow-x-auto no-scrollbar">
        {manifest.length === 0 ? (
          <EmptyState
            icon={<Users className="size-8" />}
            title="No passengers on this flight yet"
            description={canManage ? "Add passengers from the group's traveller list." : undefined}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-none!">
                {["Passenger", "Phone", "Passport", "Seat status", "Flight status", ""].map((label) => (
                  <TableHead key={label} className="h-9 px-3 text-xs font-medium text-muted-foreground">
                    {label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border/20">
              {manifest.map((p) => (
                <TableRow key={p.rowId}>
                  <TableCell className="px-3 py-3 text-sm text-foreground">{p.fullName}</TableCell>
                  <TableCell className="px-3 py-3 text-xs font-number text-muted-foreground">{p.phone ?? "—"}</TableCell>
                  <TableCell className="px-3 py-3 text-xs font-number text-muted-foreground">{p.passportNumber ?? "—"}</TableCell>
                  <TableCell className="px-3 py-3 text-xs text-foreground">{p.seatStatus}</TableCell>
                  <TableCell className="px-3 py-3 text-xs text-foreground">{p.flightStatus}</TableCell>
                  <TableCell className="px-3 py-3">
                    {canManage && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          const result = await removePassengerFromFlightAction(flight.id, p.rowId);
                          if (!result.ok) return toast.add({ title: result.error ?? "Could not remove" });
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {canManage && (
        <AddPassengerDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
          flightId={flight.id}
          candidates={unassigned}
        />
      )}
      {canManage && (
        <BaggageRulesDialog
          open={baggageOpen}
          onClose={() => setBaggageOpen(false)}
          flightId={flight.id}
          allowanceKg={flight.baggageAllowanceKg}
          notes={flight.baggageNotes}
        />
      )}
    </div>
  );
}

function AddPassengerDialog({
  open,
  onClose,
  flightId,
  candidates,
}: {
  open: boolean;
  onClose: () => void;
  flightId: string;
  candidates: FlightManifestPassenger[];
}) {
  const [adding, setAdding] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md! max-h-[70vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add passenger to this flight</DialogTitle></DialogHeader>
        {candidates.length === 0 ? (
          <p className="text-xs text-muted-foreground">Every traveller in this group is already on this flight.</p>
        ) : (
          <div className="flex flex-col gap-2 py-2">
            {candidates.map((c) => (
              <div key={c.rowId} className="flex items-center justify-between gap-2">
                <span className="text-sm text-foreground">{c.fullName}</span>
                <Button
                  size="sm"
                  disabled={adding === c.rowId}
                  onClick={async () => {
                    setAdding(c.rowId);
                    const result = await assignPassengerToFlightAction(flightId, c.rowId);
                    setAdding(null);
                    if (!result.ok) return toast.add({ title: result.error ?? "Could not add passenger" });
                  }}
                >
                  {adding === c.rowId ? "Adding…" : "Add"}
                </Button>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BaggageRulesDialog({
  open,
  onClose,
  flightId,
  allowanceKg,
  notes,
}: {
  open: boolean;
  onClose: () => void;
  flightId: string;
  allowanceKg: number | null;
  notes: string | null;
}) {
  const [allowance, setAllowance] = useState(allowanceKg?.toString() ?? "");
  const [note, setNote] = useState(notes ?? "");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    const result = await updateFlightBaggageRulesAction(flightId, {
      allowanceKg: allowance ? Number(allowance) : null,
      notes: note || null,
    });
    setSaving(false);
    if (!result.ok) {
      toast.add({ title: result.error ?? "Could not save" });
      return;
    }
    toast.add({ title: "Baggage rules saved" });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm!">
        <DialogHeader><DialogTitle>Baggage rules</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <InputGroupField label="Allowance (kg)" type="number" value={allowance} onChange={(e) => setAllowance(e.target.value)} />
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Notes</label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="e.g. 30kg checked + 7kg cabin" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
