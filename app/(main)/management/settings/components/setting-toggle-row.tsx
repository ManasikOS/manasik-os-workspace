import { Switch } from "@/components/ui/switch";
import { useId } from "react";

/** One `[✓] Label` row from the spec — a Switch plus a label and optional description. */
export function SettingToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const descriptionId = useId();

  return (
    <div className="flex min-h-12 items-start justify-between gap-4 py-2.5">
      <div className="flex flex-col gap-0.5">
        <label htmlFor={descriptionId} className="cursor-pointer text-sm font-medium text-foreground">
          {label}
        </label>
        {description && (
          <span id={`${descriptionId}-description`} className="text-xs leading-relaxed text-muted-foreground">
            {description}
          </span>
        )}
      </div>
      <Switch
        id={descriptionId}
        aria-describedby={description ? `${descriptionId}-description` : undefined}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </div>
  );
}
