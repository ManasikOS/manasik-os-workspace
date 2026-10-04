import { Switch } from "@/components/ui/switch";

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
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm text-foreground">{label}</span>
        {description && <span className="text-xs text-muted-foreground">{description}</span>}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}
