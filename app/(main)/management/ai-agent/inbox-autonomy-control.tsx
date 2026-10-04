"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { AUTONOMY_LEVEL_COPY, autonomyLevelName } from "@/lib/inbox/autonomy/labels";
import type { AutonomyLevel } from "@/lib/inbox/intelligence/contracts";
import { NEVER_AUTONOMOUS } from "@/lib/inbox/risk/never-promise";

import { saveInboxAutonomyLevel } from "./actions";

const LEVELS = Object.keys(AUTONOMY_LEVEL_COPY) as AutonomyLevel[];

/**
 * What the assistant may do on its own in the Inbox, in plain words: pick how much it may do, read what that means, and see
 * the things it can never do at any setting. The choice saved here is the single policy for the assistant's own replies.
 */
export function InboxAutonomyControl({ initialLevel, blockers, canEdit }: { initialLevel: AutonomyLevel; blockers: string[]; canEdit: boolean }) {
  const [level, setLevel] = useState<AutonomyLevel>(initialLevel);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await saveInboxAutonomyLevel({ level });
      toast.add({ title: result.ok ? "Assistant settings updated" : "Could not update the assistant settings", ...(!result.ok ? { description: result.error } : {}) });
    });
  }

  return (
    <section className="space-y-4 rounded-lg border p-4" aria-label="What the assistant may do in the Inbox">
      <div>
        <h3 className="text-sm font-semibold">What the assistant may do on its own</h3>
        <p className="text-xs text-muted-foreground">
          Once you save a choice here, it is the only setting that decides what the assistant may send on its own. The older WhatsApp
          assistant switch no longer overrides it. Your plan, the assistant&apos;s track record and a colleague taking over a chat can
          only reduce what it does, never increase it.
        </p>
      </div>

      <div className="space-y-2">
        <InputGroup>
          <InputGroupAddon align="block-start">
            <InputGroupText>Assistant behaviour</InputGroupText>
          </InputGroupAddon>
          <Select value={level} onValueChange={(value) => value && setLevel(value as AutonomyLevel)} disabled={!canEdit || pending}>
            <SelectTrigger className="w-full" aria-label="Assistant behaviour">
              <SelectValue>{autonomyLevelName(level)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {LEVELS.map((item) => (
                <SelectItem key={item} value={item} disabled={(item === "L2" || item === "L3") && blockers.length > 0}>
                  {autonomyLevelName(item)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </InputGroup>
        <p className="text-xs text-muted-foreground" role="status">
          {AUTONOMY_LEVEL_COPY[level].description}
        </p>
        {canEdit && (
          <Button onClick={save} disabled={pending || level === initialLevel}>
            {pending ? "Saving…" : "Save"}
          </Button>
        )}
      </div>

      {blockers.length > 0 && (
        <div>
          <p className="text-xs font-medium">Automatic replies stay locked until:</p>
          <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="text-xs font-medium">Always human-only, at every setting</p>
        <p className="text-xs text-muted-foreground">The assistant will never do these. A person always does.</p>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {NEVER_AUTONOMOUS.map((item) => (
            <li key={item.id} className="flex items-start gap-2 text-xs">
              <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
              <span>{item.label.charAt(0).toUpperCase() + item.label.slice(1)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
