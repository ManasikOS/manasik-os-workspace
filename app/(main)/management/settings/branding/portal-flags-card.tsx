import { SquareUserRound } from "lucide-react";

import InputFormCard from "@/components/ui/input-form-card";
import {
  PORTAL_FLAG_LABELS,
  PORTAL_FORBIDDEN_FIELDS,
} from "@/lib/data/settings-copy";
import type { PortalFlags } from "@/lib/types/settings";

import { SettingToggleRow } from "../components/setting-toggle-row";
import { UnavailableNote } from "../components/unavailable-note";
import { Card } from "@/components/ui/card";
import SectionHeading from "@/components/section-heading";

export function PortalFlagsCard({
  flags,
  onChange,
  canEdit,
}: {
  flags: PortalFlags;
  onChange: (key: keyof PortalFlags, next: boolean) => void;
  canEdit: boolean;
}) {
  return (
    <Card>
      <SectionHeading title="Portal controls" />
      <UnavailableNote reason="No pilgrim portal exists in the application yet — these toggles define the contract the portal will be built against, and already control what a portal-facing payload is allowed to include." />

      <div className="flex flex-col divide-y divide-border/20 mt-2">
        {(Object.keys(PORTAL_FLAG_LABELS) as (keyof PortalFlags)[]).map(
          (key) => (
            <SettingToggleRow
              key={key}
              label={PORTAL_FLAG_LABELS[key]}
              checked={flags[key]}
              onCheckedChange={(next) => onChange(key, next)}
              disabled={!canEdit}
            />
          ),
        )}
      </div>

      <div className="mt-2">
        <span className="text-xs font-medium text-muted-foreground">
          Never exposed to the portal
        </span>
        <ul className="mt-1.5 flex flex-col gap-1 text-xs text-muted-foreground">
          {PORTAL_FORBIDDEN_FIELDS.map((field) => (
            <li key={field}>· {field}</li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
