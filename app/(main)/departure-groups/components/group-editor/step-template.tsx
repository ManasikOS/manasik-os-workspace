"use client";

import { Check, TriangleAlert } from "lucide-react";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import SearchInput from "@/components/ui/search-input";
import { Switch } from "@/components/ui/switch";
import { useProgressRouter } from "@/hooks/use-progress-router";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import { TONE_CLASS, TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

import type { PackageTemplateOption } from "../../types";
import { JOURNEY_TYPE_LABELS } from "../../utils";
import { COPY_LABELS } from "./group-editor-model";
import type { GroupEditorForm } from "./use-group-editor-form";

interface StepTemplateProps {
  form: GroupEditorForm;
  templates: PackageTemplateOption[];
  role: StaffRole;
  /** Shown under the list once the person has pressed Continue without choosing. */
  problem: string | undefined;
}

/** Step 1: pick the package the group is copied from. */
export default function StepTemplate({ form, templates, role, problem }: StepTemplateProps) {
  const router = useProgressRouter();
  const { selected, selectedId, includeDrafts, templateSearch } = form;

  const filtered = useMemo(() => {
    const scoped = includeDrafts
      ? templates
      : templates.filter(
          (template) => template.isOpenForSale || template.id === selectedId,
        );
    const needle = templateSearch.trim().toLowerCase();
    if (!needle) return scoped;
    return scoped.filter((template) =>
      [
        template.name,
        template.code,
        template.category,
        JOURNEY_TYPE_LABELS[template.journeyType],
        template.status,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [templates, templateSearch, includeDrafts, selectedId]);

  const hasDrafts = templates.some((template) => !template.isOpenForSale);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
      <Card className="gap-4">
        {templates.length > 0 ? (
          <SearchInput
            value={form.templateSearch}
            onChange={form.setTemplateSearch}
            placeholder="Search package templates by name, code, type, or season..."
          />
        ) : null}

        {role === "ADMIN" && hasDrafts ? (
          <div className="flex items-center justify-between gap-4 rounded-md border border-border/50 bg-muted/30 px-4 py-2">
            <div>
              <p className="text-sm font-medium">Include drafts</p>
              <p className="text-xs text-muted-foreground">
                Admin-only. A group started from a Draft template can never itself
                be put on sale.
              </p>
            </div>
            <Switch
              checked={includeDrafts}
              onCheckedChange={form.setIncludeDrafts}
              aria-label="Include draft packages"
            />
          </div>
        ) : null}

        {templates.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              No packages yet. Create a package first, then start a departure
              group from it.
            </p>
            <Button type="button" onClick={() => router.push("/packages/new")}>
              Create package
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No package templates match that search.
          </p>
        ) : (
          <ul role="list" className="flex flex-col gap-3">
            {filtered.map((template) => {
              const isSelected = template.id === selectedId;
              return (
                <li key={template.id}>
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => form.chooseTemplate(template)}
                    className={cn(
                      "flex w-full items-start justify-between gap-3 rounded-md border px-4 py-3 text-left transition-colors",
                      "outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                      isSelected
                        ? "border-primary/20 bg-primary/5"
                        : "border-border/50 hover:bg-muted/50",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {template.name}
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className="text-xs tabular-nums text-muted-foreground"
                        >
                          {template.code}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {template.category} · {template.durationLabel}
                        </span>
                      </span>
                      <span className="mt-1.5 block text-xs text-muted-foreground">
                        Default capacity: {template.defaultCapacity}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-2">
                      <Badge
                        className={cn(
                          "rounded-sm border-none px-2 py-1 text-xs font-normal",
                          template.isOpenForSale
                            ? TONE_CLASS.success
                            : TONE_CLASS.neutral,
                        )}
                      >
                        {template.status}
                      </Badge>
                      {!template.isOpenForSale ? (
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          {template.completeness}% complete
                        </span>
                      ) : null}
                      {isSelected ? (
                        <Check className="size-4 text-primary" aria-label="Selected" />
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {problem ? (
          <p role="alert" className="text-xs text-destructive">
            {problem}
          </p>
        ) : null}
      </Card>

      <Card className="gap-1 lg:sticky lg:top-20">
        {selected ? (
          <>
            <p className="text-sm font-medium text-muted-foreground">
              Selected package template
            </p>
            <h3 className="text-lg font-medium">{selected.name}</h3>
            <p className="text-xs text-muted-foreground">
              {JOURNEY_TYPE_LABELS[selected.journeyType]} · {selected.category} ·{" "}
              {selected.durationLabel}
            </p>
            <p className="text-xs text-muted-foreground">
              Default capacity: {selected.defaultCapacity}
            </p>

            <p className="mt-4 text-sm font-medium">This group will copy:</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The payment schedule structure is copied in. This departure&apos;s
              own price, cost estimate and flight routing are set in a later step;
              a template has none of its own.
            </p>
            <ul className="mt-1.5 grid gap-1">
              {COPY_LABELS.map(({ key, label }) => (
                <li
                  key={key}
                  className="flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <Check className={cn("size-3.5 shrink-0", TONE_TEXT.success)} aria-hidden />
                  {label}
                </li>
              ))}
            </ul>

            {!selected.isOpenForSale ? (
              <div
                className={cn(
                  "mt-3 flex items-start gap-2 rounded-sm px-2.5 py-2 text-xs",
                  TONE_CLASS.warning,
                )}
              >
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  This template is not open for sale. Only an administrator can
                  create a planning group from it.
                </span>
              </div>
            ) : null}
          </>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Choose a package on the left to see what the group will copy from it.
          </p>
        )}
      </Card>
    </div>
  );
}
