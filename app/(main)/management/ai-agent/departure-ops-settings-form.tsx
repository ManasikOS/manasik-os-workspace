"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { STAFF_ROLES } from "@/lib/access/departure-groups-access";

import { saveDepartureOpsSettings } from "./actions";
import type { DepartureOpsSettingsRow } from "./types";

const MODE_OPTIONS: { value: DepartureOpsSettingsRow["departure_ops_mode"]; label: string; description: string }[] = [
  { value: "OFF", label: "Off", description: "The agent never runs." },
  { value: "SHADOW", label: "Shadow", description: "Runs the full review, records what it would have done, writes nothing." },
  { value: "PROPOSE", label: "Propose", description: "Internal tasks/findings write automatically; anything external is a proposal." },
  { value: "ACTIVE", label: "Active", description: "Same as Propose — nothing external ever writes without approval (D4)." },
];

export function DepartureOpsSettingsForm({ settings, canEdit }: { settings: DepartureOpsSettingsRow; canEdit: boolean }) {
  const [enabled, setEnabled] = useState(settings.departure_ops_enabled);
  const [mode, setMode] = useState(settings.departure_ops_mode);
  const [maxProposals, setMaxProposals] = useState(settings.departure_ops_max_proposals_per_run);
  const [maxTasks, setMaxTasks] = useState(settings.departure_ops_max_tasks_per_run);
  const [highRiskRoles, setHighRiskRoles] = useState<string[]>(settings.departure_ops_high_risk_roles);
  const [cooldownDays, setCooldownDays] = useState(settings.departure_ops_rejection_cooldown_days);
  const [submitting, setSubmitting] = useState(false);

  const toggleRole = (role: string) => {
    setHighRiskRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  };

  async function save() {
    setSubmitting(true);
    const result = await saveDepartureOpsSettings({
      enabled,
      mode,
      maxProposalsPerRun: maxProposals,
      maxTasksPerRun: maxTasks,
      highRiskRoles,
      rejectionCooldownDays: cooldownDays,
    });
    setSubmitting(false);

    if (!result.ok) {
      toast.add({ title: "Could not save Departure Operations settings", description: result.error });
      return;
    }
    toast.add({ title: "Departure Operations settings saved" });
  }

  return (
    <div className="rounded-lg border p-4 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Manasik Copilot — Departure Operations</h3>
          <p className="text-xs text-muted-foreground">
            Reviews every active departure group on a schedule — internal tasks and findings write
            automatically; anything a supplier, traveller or regulator would learn about always waits for a
            human to approve it first, regardless of mode.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canEdit} />
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium">Mode</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {MODE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex items-start gap-2 text-sm rounded-md border p-2.5 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            >
              <input
                type="radio"
                name="departure-ops-mode"
                className="mt-1"
                checked={mode === option.value}
                onChange={() => setMode(option.value)}
                disabled={!canEdit}
              />
              <span>
                <span className="font-medium">{option.label}</span>
                <span className="block text-xs text-muted-foreground">{option.description}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="border-t pt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium" htmlFor="max-proposals">
            Max proposals per review
          </label>
          <Input
            id="max-proposals"
            type="number"
            min={1}
            value={maxProposals}
            onChange={(e) => setMaxProposals(Number(e.target.value) || 1)}
            disabled={!canEdit}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium" htmlFor="max-tasks">
            Max tasks per review
          </label>
          <Input
            id="max-tasks"
            type="number"
            min={1}
            value={maxTasks}
            onChange={(e) => setMaxTasks(Number(e.target.value) || 1)}
            disabled={!canEdit}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium" htmlFor="cooldown-days">
            Rejection cooldown (days)
          </label>
          <Input
            id="cooldown-days"
            type="number"
            min={1}
            value={cooldownDays}
            onChange={(e) => setCooldownDays(Number(e.target.value) || 1)}
            disabled={!canEdit}
          />
        </div>
      </div>

      <div className="border-t pt-4 flex flex-col gap-2">
        <label className="text-xs font-medium">
          Roles that may approve a HIGH-risk proposal <span className="text-muted-foreground">(at least one)</span>
        </label>
        <div className="flex gap-4 flex-wrap">
          {STAFF_ROLES.map((role) => (
            <label key={role} className="flex items-center gap-1.5 text-sm">
              <Checkbox
                checked={highRiskRoles.includes(role)}
                onCheckedChange={() => toggleRole(role)}
                disabled={!canEdit}
              />
              {role}
            </label>
          ))}
        </div>
      </div>

      {canEdit && (
        <div>
          <Button onClick={save} disabled={submitting}>
            {submitting ? "Saving…" : "Save changes"}
          </Button>
        </div>
      )}
    </div>
  );
}
