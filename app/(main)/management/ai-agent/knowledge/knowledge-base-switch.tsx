"use client";

import { useState, useTransition } from "react";

import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";

import { setKnowledgeBaseEnabledAction } from "./actions";

export function KnowledgeBaseSwitch({ initiallyEnabled, canManage }: { initiallyEnabled: boolean; canManage: boolean }) {
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [isPending, startTransition] = useTransition();

  function changeEnabled(next: boolean) {
    const previous = enabled;
    setEnabled(next);
    startTransition(async () => {
      const result = await setKnowledgeBaseEnabledAction(next);
      if (!result.ok) {
        setEnabled(previous);
        toast.add({ title: "That didn't work", description: result.error });
        return;
      }
      toast.add({ title: next ? "The assistant can now use your documents" : "The assistant will ignore your documents" });
    });
  }

  return (
    <Card className="flex flex-row items-center justify-between gap-4 p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">Let the assistant answer from these documents</p>
        <p className="text-xs text-muted-foreground">
          When this is on, the assistant looks up your policies and guides before answering questions about them. Turn it off to stop
          all document answers at once.
        </p>
      </div>
      <Switch
        checked={enabled}
        disabled={!canManage || isPending}
        aria-label="Let the assistant answer from these documents"
        onCheckedChange={changeEnabled}
      />
    </Card>
  );
}
