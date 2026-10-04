"use client";

import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROLE_LABELS } from "@/lib/access/team-access";
import type { SeatCapacity } from "@/lib/setup/seat-capacity";
import { setupTeamInviteSchema } from "@/lib/validations/setup";

import { inviteSetupTeamMemberAction } from "../actions";

const INVITABLE_ROLES = ["OPERATIONS", "FINANCE", "MARKETING", "VISA", "GUIDE", "CEO"] as const;

/** Step 3. One invitation at a time, with the plan's seat limit shown and enforced. */
export function TeamInviteStep({ capacity }: { capacity: SeatCapacity }) {
  const router = useRouter();
  const [form, setForm] = useState({ fullName: "", email: "", role: "OPERATIONS" as string });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isSending, startSending] = useTransition();

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);

    const parsed = setupTeamInviteSchema.safeParse(form);
    if (!parsed.success) {
      setMessage({ ok: false, text: parsed.error.issues[0]?.message ?? "Check the details." });
      return;
    }

    startSending(async () => {
      const result = await inviteSetupTeamMemberAction(parsed.data);
      setMessage({ ok: result.ok, text: result.ok ? (result.message ?? "Invitation sent.") : result.error });
      if (result.ok) {
        setForm({ fullName: "", email: "", role: form.role });
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {capacity.limit === null
          ? `${capacity.used} team seats in use.`
          : `${capacity.used} of ${capacity.limit} team seats in use on your plan.`}
      </p>

      {capacity.atLimit ? (
        <p role="alert" className="text-sm text-destructive">
          All of your plan&apos;s team seats are in use. Upgrade your plan or remove someone to invite more people.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>Full name</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput value={form.fullName} onChange={(event) => setForm((previous) => ({ ...previous, fullName: event.target.value }))} required />
          </InputGroup>
          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>Email</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              type="email"
              value={form.email}
              onChange={(event) => setForm((previous) => ({ ...previous, email: event.target.value }))}
              placeholder="aisha@youragency.com"
              required
            />
          </InputGroup>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Their role</span>
            <Select value={form.role} onValueChange={(value) => setForm((previous) => ({ ...previous, role: value ?? previous.role }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INVITABLE_ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">They&apos;ll get an email to set up their own sign-in. You can change their access later on the Team screen.</p>
          {message && (
            <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-sm text-foreground" : "text-sm text-destructive"}>
              {message.text}
            </p>
          )}
          <Button type="submit" className="self-start" disabled={isSending}>
            {isSending && <Loader2Icon className="animate-spin" />} Send invitation
          </Button>
        </form>
      )}
    </div>
  );
}
