"use client";

import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { Plus, Radio } from "lucide-react";
import React, { useState } from "react";

import { upsertLeadSourceAction } from "../actions";
import type { LeadSourceRow } from "@/lib/types/leads";

interface ManageLeadSourcesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: LeadSourceRow[];
  onChanged: () => void;
}

/**
 * The "Manage Lead Sources" screen from the More menu. `source` on a lead
 * stays the fixed enum the rest of the app filters and reports on — this table
 * is the editable label/ordering layer shown here and, later, on the
 * per-source analytics breakdown.
 */
const ManageLeadSourcesSheet = ({
  open,
  onOpenChange,
  sources,
  onChanged,
}: ManageLeadSourcesSheetProps) => {
  const [newLabel, setNewLabel] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  const toggle = async (source: LeadSourceRow) => {
    setSaving(source.id);
    const result = await upsertLeadSourceAction({
      id: source.id,
      code: source.code,
      label: source.label,
      active: !source.active,
    });
    setSaving(null);
    if (!result.ok) {
      toast.add({ title: "Could not update source", description: result.error });
      return;
    }
    onChanged();
  };

  const addSource = async () => {
    if (!newLabel.trim()) return;
    setSaving("new");
    const result = await upsertLeadSourceAction({
      code: newLabel,
      label: newLabel,
      active: true,
    });
    setSaving(null);
    if (!result.ok) {
      toast.add({ title: "Could not add source", description: result.error });
      return;
    }
    setNewLabel("");
    onChanged();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="data-[side=right]:sm:max-w-md w-full">
        <SheetHeader className="gap-1">
          <SheetTitle className="flex items-center gap-2">
            <Radio className="size-4 text-primary" /> Manage lead sources
          </SheetTitle>
          <p className="text-sm text-muted-foreground">
            Deactivating a source hides it from the &ldquo;New Lead&rdquo; source picker without
            touching leads already recorded against it.
          </p>
        </SheetHeader>

        <div className="flex flex-col gap-2 px-4 pb-4">
          {sources.map((source) => (
            <div
              key={source.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border/50 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{source.label}</p>
                <p className="text-[11px] text-muted-foreground font-number">{source.code}</p>
              </div>
              <Switch
                checked={source.active}
                disabled={saving === source.id}
                onCheckedChange={() => toggle(source)}
              />
            </div>
          ))}

          <div className="flex items-center gap-2 mt-2">
            <InputGroup>
              <InputGroupInput
                placeholder="New source label, e.g. TikTok"
                value={newLabel}
                onChange={(event) => setNewLabel(event.target.value)}
              />
            </InputGroup>
            <Button
              size="sm"
              variant="secondary"
              disabled={!newLabel.trim() || saving === "new"}
              onClick={addSource}
            >
              <Plus /> Add
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default ManageLeadSourcesSheet;
