"use client";

import { Route } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import InputFormCard from "@/components/ui/input-form-card";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { COORDINATOR_ROLES, DEFAULT_ROUTING_POLICY, type CoordinatorRole, type LoadBalanceMode, type RoutingPolicy, type RoutingTopic } from "@/lib/inbox/routing/policy";

import { SettingToggleRow } from "../components/setting-toggle-row";
import { saveInboxRoutingPolicyAction } from "./inbox-routing-actions";

const ROLE_LABELS: Record<CoordinatorRole, string> = { ADMIN: "Admin", MARKETING: "Sales", OPERATIONS: "Operations", FINANCE: "Finance", VISA: "Visa" };
const TOPIC_LABELS: Record<RoutingTopic, string> = { GROUP: "Group enquiries", VISA_ISSUES: "Visa questions", DOCUMENTS: "Document questions" };

/**
 * Who a new conversation goes to — MI3.5. Off until it is saved once: an agency that never saves keeps today's behaviour
 * (the AI handoff assigns the default owner and nothing else assigns automatically). The order never changes: the customer's
 * existing owner first, then the team for the topic, then whoever has the least waiting, then the default owner. Nobody who is
 * off shift, deactivated or outside their access dates is ever picked; the conversation waits, unassigned, with its clock running.
 */
export function InboxRoutingForm({ policy, canEdit }: { policy: RoutingPolicy | null; canEdit: boolean }) {
  const initial = policy ?? DEFAULT_ROUTING_POLICY;
  const [sticky, setSticky] = useState(initial.stickyEnabled);
  const [respectShifts, setRespectShifts] = useState(initial.respectShifts);
  const [threshold, setThreshold] = useState(String(initial.groupThreshold));
  const [mode, setMode] = useState<LoadBalanceMode>(initial.loadBalanceMode);
  const [roles, setRoles] = useState(initial.coordinatorRoles);
  const [error, setError] = useState<string | null>(null);
  const [pending, startSaving] = useTransition();

  function save() {
    if (!/^\d+$/.test(threshold.trim())) {
      setError("Enter the group size as a whole number.");
      return;
    }
    setError(null);
    startSaving(async () => {
      const result = await saveInboxRoutingPolicyAction({ stickyEnabled: sticky, groupThreshold: Number(threshold), loadBalanceMode: mode, respectShifts, coordinatorRoles: roles });
      if (!result.ok) {
        setError(result.error ?? "The settings were not saved.");
        return;
      }
      toast.add({ title: "Assignment settings saved", description: "New conversations are now assigned automatically." });
    });
  }

  return (
    <InputFormCard
      title="Automatic assignment"
      icon={<Route className="size-4" />}
      desc="Decide who a new conversation goes to. Until you save these settings, nothing is assigned automatically."
    >
      <p className="mt-2 text-xs text-muted-foreground">
        {policy ? "Automatic assignment is on." : "Automatic assignment is off. Saving turns it on."}
      </p>
      <SettingToggleRow
        label="Keep a customer with their owner"
        description="If the customer's lead already has an owner who is available, the conversation goes to them first."
        checked={sticky}
        onCheckedChange={setSticky}
        disabled={!canEdit || pending}
      />
      <SettingToggleRow
        label="Only assign during working hours"
        description="Nobody is picked while the office is closed. The conversation waits, unassigned, and its reply clock keeps running."
        checked={respectShifts}
        onCheckedChange={setRespectShifts}
        disabled={!canEdit || pending}
      />
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <InputGroup>
          <InputGroupAddon align="block-start">
            <InputGroupText>Counts as a group from (people)</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput inputMode="numeric" value={threshold} disabled={!canEdit || pending} onChange={(event) => setThreshold(event.target.value)} />
        </InputGroup>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Sharing new conversations</label>
          <Select value={mode} onValueChange={(value) => setMode(value as LoadBalanceMode)} disabled={!canEdit || pending}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="LEAST_LOADED">To whoever has the least waiting</SelectItem>
              <SelectItem value="ROUND_ROBIN">In turn, one after another</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {(Object.keys(TOPIC_LABELS) as RoutingTopic[]).map((topic) => (
          <div key={topic} className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">{TOPIC_LABELS[topic]} go to</label>
            <Select value={roles[topic]} onValueChange={(value) => setRoles((current) => ({ ...current, [topic]: value as CoordinatorRole }))} disabled={!canEdit || pending}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COORDINATOR_ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {ROLE_LABELS[role]} team
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
      {canEdit && (
        <div className="mt-3 flex justify-end">
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save assignment settings"}
          </Button>
        </div>
      )}
    </InputFormCard>
  );
}
