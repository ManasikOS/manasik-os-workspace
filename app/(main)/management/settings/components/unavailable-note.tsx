import { Info } from "lucide-react";

/**
 * Inline reason shown next to a read-only field whose enforcement is not
 * available from this application — password policy, 2FA, session
 * device/location. A switch that flips, saves and enforces nothing is a
 * security misrepresentation; this is what replaces it. See D15.
 */
export function UnavailableNote({ reason }: { reason: string }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <Info className="size-3.5 shrink-0 mt-0.5" />
      <span>{reason}</span>
    </p>
  );
}
