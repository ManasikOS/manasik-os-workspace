"use client";

import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";

import { provisionAgencyAction } from "../actions";

export function NewAgencyForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [agencyName, setAgencyName] = useState("");
  const [ownerFullName, setOwnerFullName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");

  const submit = () => {
    startTransition(async () => {
      const result = await provisionAgencyAction({ agencyName, ownerFullName, ownerEmail });
      if (!result.ok) {
        toast.add({ title: "Could not create the agency", description: result.error });
        return;
      }
      toast.add({ title: "Agency created", description: `${agencyName} is provisioned and the owner is invited.` });
      router.push(`/platform/agencies/${result.agencyId}`);
    });
  };

  return (
    <Card className="gap-4 p-5">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="agency-name">
          Agency name
        </label>
        <Input id="agency-name" value={agencyName} onChange={(e) => setAgencyName(e.target.value)} placeholder="e.g. Al-Noor Travels" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="owner-name">
          Owner full name
        </label>
        <Input id="owner-name" value={ownerFullName} onChange={(e) => setOwnerFullName(e.target.value)} placeholder="e.g. Fatima Rizwan" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="owner-email">
          Owner email
        </label>
        <Input
          id="owner-email"
          type="email"
          value={ownerEmail}
          onChange={(e) => setOwnerEmail(e.target.value)}
          placeholder="owner@agency.com"
        />
        <p className="text-xs text-muted-foreground">
          They receive a Supabase invitation email and become this agency&apos;s first ADMIN.
        </p>
      </div>
      <Button onClick={submit} disabled={isPending || !agencyName || !ownerFullName || !ownerEmail}>
        {isPending ? "Creating…" : "Create agency"}
      </Button>
    </Card>
  );
}
