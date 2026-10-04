"use client";

import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import { Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ToneBadge } from "@/components/ui/tone-badge";
import { BRANCH_STATUS_LABELS } from "@/lib/data/settings-copy";
import type { BranchDirectoryRow } from "@/lib/types/settings";
import type { Tone } from "@/lib/ui/tone";

import { SectionShell } from "../components/section-shell";
import { BranchSheet } from "./branch-sheet";
import { Edit2 } from "reicon-react";

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: "success",
  INACTIVE: "neutral",
  ARCHIVED: "neutral",
};

export function BranchList({
  branches,
  managers,
  canEdit,
}: {
  branches: BranchDirectoryRow[];
  managers: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<BranchDirectoryRow | null | "new">(
    null,
  );

  const onSaved = () => router.refresh();

  return (
    <SectionShell
      title="Branches"
      description="Where the agency operates from. Add a branch here rather than in code."
    >
      <div className="flex flex-col gap-3">
        {branches.map((branch) => (
          <Card
            key={branch.id}
            className="flex-row items-center justify-between gap-4 py-3 px-4"
          >
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  {branch.name}
                </span>
                <ToneBadge
                  tone={STATUS_TONE[branch.status]}
                  label={BRANCH_STATUS_LABELS[branch.status]}
                />
                {branch.is_primary && (
                  <ToneBadge tone="brand" label="Primary branch" />
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                Staff: {branch.staff_count} · Active Groups:{" "}
                {branch.active_group_count}
                {branch.manager_name
                  ? ` · Manager: ${branch.manager_name}`
                  : ""}
              </span>
            </div>
            {canEdit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(branch)}
              >
                <Edit2 size={20} />
              </Button>
            )}
          </Card>
        ))}

        {branches.length === 0 && (
          <Card className="items-center justify-center py-8 text-sm text-muted-foreground">
            No branches yet.
          </Card>
        )}

        {canEdit && (
          <Button
            variant="outline_without_border"
            className="self-end"
            onClick={() => setEditing("new")}
          >
            <Plus className="size-4" /> Add Branch
          </Button>
        )}
      </div>

      {canEdit && (
        <BranchSheet
          branch={editing === "new" ? null : editing}
          managers={managers}
          open={editing !== null}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </SectionShell>
  );
}
