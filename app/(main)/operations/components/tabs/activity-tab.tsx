"use client";

import { FilterSelect } from "@/components/data-table/filter-select";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/tone-badge";
import React, { useMemo, useState } from "react";

import { useOperations } from "../../operations-store";
import { ALL } from "../../types";
import { formatDateTime } from "../../utils";

import { ActorChip } from "@/components/ui/copilot-mark";
import { displayActorName } from "@/lib/agent/identity";
/** Cross-group high-impact activity feed. Filters run client-side over the
 *  loaded window (`activityLimit` in `operations-repository.ts`). */
const ActivityTab = () => {
  const { snapshot } = useOperations();
  const [groupId, setGroupId] = useState(ALL);
  const [actorName, setActorName] = useState(ALL);
  const [highImpactOnly, setHighImpactOnly] = useState(true);

  const groupOptions = useMemo(
    () =>
      [
        ...new Map(
          snapshot.activity.map((a) => [a.groupId, a.groupName]),
        ).entries(),
      ].map(([value, label]) => ({ value, label })),
    [snapshot.activity],
  );
  const actorOptions = useMemo(
    () =>
      [
        ...new Set(snapshot.activity.map((a) => displayActorName(a.actorName))),
      ].map((n) => ({ value: n, label: n })),
    [snapshot.activity],
  );

  const filtered = useMemo(
    () =>
      snapshot.activity.filter(
        (a) =>
          (groupId === ALL || a.groupId === groupId) &&
          (actorName === ALL || displayActorName(a.actorName) === actorName) &&
          (!highImpactOnly || a.isHighImpact),
      ),
    [snapshot.activity, groupId, actorName, highImpactOnly],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Group"
          value={groupId}
          options={groupOptions}
          onChange={setGroupId}
        />
        <FilterSelect
          label="Staff Owner"
          value={actorName}
          options={actorOptions}
          onChange={setActorName}
        />
        <Button
          variant={highImpactOnly ? "secondary" : "outline_without_border"}
          size="sm"
          onClick={() => setHighImpactOnly((v) => !v)}
        >
          {highImpactOnly ? "Showing high-impact only" : "Showing everything"}
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No activity yet"
          description="Nothing matches this filter."
        />
      ) : (
        <div className="rounded-md bg-card/60 dark:bg-gray-950/10 border border-muted/50 backdrop-blur-lg shadow-lg p-4 flex flex-col gap-4">
          {filtered.map((a) => (
            <div
              key={a.id}
              className="flex items-start gap-3 border-b border-border/20 pb-3 last:border-0 last:pb-0"
            >
              <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-36">
                {formatDateTime(a.createdAt)}
              </span>
              <div className="min-w-0">
                <p className="text-sm text-foreground">
                  <ActorChip name={a.actorName} inline /> {a.message}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {a.groupName}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ActivityTab;
