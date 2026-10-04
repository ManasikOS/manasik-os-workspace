import { Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import InputFormCard from "@/components/ui/input-form-card";
import { IMPORT_ENTITY_LABELS } from "@/lib/data/settings-copy";

import { UnavailableNote } from "../components/unavailable-note";

/**
 * Disabled by design in V1 — an importer without a dry-run preview and a
 * partial-failure report is how a CRM ends up with 400 duplicate pilgrims.
 * Scheduled as its own phase (Phase 10b). See F7.
 */
export function ImportCard() {
  return (
    <InputFormCard title="Import data" icon={<Upload className="size-4" />}>
      <UnavailableNote reason="Not available yet — importing needs a dry-run preview and a partial-failure report before it is safe to ship." />
      <div className="flex flex-col gap-2 mt-2">
        {Object.entries(IMPORT_ENTITY_LABELS).map(([key, label]) => (
          <Button key={key} variant="outline" size="sm" className="self-start" disabled>
            {label}
          </Button>
        ))}
      </div>
    </InputFormCard>
  );
}
