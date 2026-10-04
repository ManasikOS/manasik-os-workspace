import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
} from "@/components/ui/input-group";
import type React from "react";

/** Label + control, same composition as every other module's form fields. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <InputGroup>
        <InputGroupAddon align={"block-start"}>
          <InputGroupText>{label}</InputGroupText>
        </InputGroupAddon>
        {children}
      </InputGroup>
      {hint && !error && (
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
