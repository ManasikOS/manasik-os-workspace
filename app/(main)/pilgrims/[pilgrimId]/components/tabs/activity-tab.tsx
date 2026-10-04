"use client";

import { Card } from "@/components/ui/card";
import { EmptyState, ToneBadge } from "@/components/ui/tone-badge";
import React from "react";

import type { PilgrimProfile } from "../../../types";

import { ActorChip } from "@/components/ui/copilot-mark";
function formatWhen(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (isToday) return `Today · ${time}`;
  return `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${time}`;
}

export default function ActivityTab({ profile }: { profile: PilgrimProfile }) {
  if (profile.activity.length === 0) {
    return <EmptyState title="No activity yet" description="Every document, visa, payment and status change for this person will appear here." />;
  }

  return (
    <Card className="gap-0">
      <div className="flex flex-col divide-y divide-border/40">
        {profile.activity.map((entry) => (
          <div key={entry.id} className="flex items-start justify-between gap-3 py-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{formatWhen(entry.createdAt)}</span>
              <span className="text-sm text-foreground">{entry.message}</span>
              <span className="text-xs text-muted-foreground">by <ActorChip name={entry.actorName} inline /></span>
            </div>
            {entry.isSensitive && <ToneBadge tone="warning" label="Sensitive" />}
          </div>
        ))}
      </div>
    </Card>
  );
}
