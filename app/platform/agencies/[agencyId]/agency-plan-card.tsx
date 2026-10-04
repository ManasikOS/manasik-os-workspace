"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { assignAgencyPlanAction, type AgencyPlanAssignment } from "../actions";

export function AgencyPlanAssignmentCard({ agencyId, assignment }: { agencyId: string; assignment: AgencyPlanAssignment }) {
  const [planCode, setPlanCode] = useState(assignment.planCode);
  const [pending, startTransition] = useTransition();
  return <Card className="gap-3 p-5"><div><p className="text-sm font-medium">Subscription plan</p><p className="text-xs text-muted-foreground">Current status: {assignment.status}. A downgrade clamps autonomy at runtime.</p></div><div className="flex gap-2"><Select value={planCode} onValueChange={(value) => value && setPlanCode(value)} disabled={pending}><SelectTrigger aria-label="Agency subscription plan"><SelectValue /></SelectTrigger><SelectContent>{assignment.plans.map((plan) => <SelectItem key={plan.code} value={plan.code}>{plan.name}</SelectItem>)}</SelectContent></Select><Button disabled={pending || planCode === assignment.planCode} onClick={() => startTransition(async () => { const result = await assignAgencyPlanAction({ agencyId, planCode }); toast.add({ title: result.ok ? "Agency plan updated" : "Could not update agency plan", ...(!result.ok ? { description: result.error } : {}) }); })}>Assign plan</Button></div></Card>;
}
