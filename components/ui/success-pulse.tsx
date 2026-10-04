import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A brief confirmation moment — same brand gradient and easing as the
 * full-screen route loader (see .route-loader-* in app/globals.css), scaled
 * down and resolved into a checkmark instead of a spin, for the "your save/
 * payment/send went through" moment. One-shot, not a loop; respects
 * prefers-reduced-motion (the badge just appears, no pop/echo).
 */
export function SuccessPulse({
  className,
  iconClassName,
}: {
  className?: string;
  iconClassName?: string;
}) {
  return (
    <div className={cn("relative flex items-center justify-center size-14", className)}>
      <span
        aria-hidden
        className="success-pulse-echo absolute inset-0 rounded-full"
      />
      <span className="success-pulse-badge relative flex size-14 items-center justify-center rounded-full">
        <CheckIcon
          className={cn("size-7 text-white", iconClassName)}
          strokeWidth={3}
        />
      </span>
    </div>
  );
}
