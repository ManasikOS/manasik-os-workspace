"use client";

import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ToneBadge } from "@/components/ui/tone-badge";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import {
  TEMPLATE_AUDIENCE_LABELS,
  TEMPLATE_CATEGORY_LABELS,
  TEMPLATE_CHANNEL_LABELS,
} from "@/lib/data/settings-copy";
import type { MessageTemplateRow, TemplateCategory } from "@/lib/types/settings";

import { SectionShell } from "../components/section-shell";
import { TemplateEditorSheet } from "./template-editor-sheet";

export function TemplateList({
  templates,
  canEdit,
  scopedRole,
  emailOnly = false,
  onReload,
}: {
  templates: MessageTemplateRow[];
  canEdit: boolean;
  scopedRole: StaffRole | null;
  emailOnly?: boolean;
  onReload?: () => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<MessageTemplateRow | null | "new">(null);

  const grouped = useMemo(() => {
    const byCategory = new Map<TemplateCategory, MessageTemplateRow[]>();
    for (const template of templates) {
      const list = byCategory.get(template.category) ?? [];
      list.push(template);
      byCategory.set(template.category, list);
    }
    return byCategory;
  }, [templates]);

  const onSaved = () => { router.refresh(); onReload?.(); };

  return (
    <SectionShell
      title={emailOnly ? "Email Templates" : "Communication Templates"}
      description={emailOnly ? "Create reusable email subjects and messages with customer and booking variables." : "Reusable WhatsApp, Email, Portal and SMS copy."}
    >
      {templates.length === 0 && (
        <EmptyState title="No templates yet" description="Add the first template to get started." />
      )}

      <div className="flex flex-col gap-4">
        {[...grouped.entries()].map(([category, items]) => (
          <Card key={category} className="gap-3">
            <span className="text-xs font-medium text-muted-foreground uppercase">
              {TEMPLATE_CATEGORY_LABELS[category]}
            </span>
            <div className="flex flex-col divide-y divide-border/20">
              {items.map((template) => (
                <div key={template.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm text-foreground">{template.name}</span>
                    <div className="flex items-center gap-1.5">
                      <ToneBadge tone="info" label={TEMPLATE_CHANNEL_LABELS[template.channel]} />
                      <ToneBadge tone="neutral" label={TEMPLATE_AUDIENCE_LABELS[template.audience]} />
                      {!template.is_active && <ToneBadge tone="warning" label="Inactive" />}
                    </div>
                  </div>
                  {canEdit && (
                    <Button variant="secondary" size="sm" onClick={() => setEditing(template)}>
                      Edit
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {canEdit && (
        <Button variant="outline" className="self-start" onClick={() => setEditing("new")}>
          <Plus className="size-4" /> New Template
        </Button>
      )}

      {canEdit && (
        <TemplateEditorSheet
          template={editing === "new" ? null : editing}
          open={editing !== null}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
          scopedRole={scopedRole}
          fixedChannel={emailOnly ? "EMAIL" : undefined}
        />
      )}
    </SectionShell>
  );
}
