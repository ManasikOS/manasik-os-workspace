import { Badge } from "@/components/ui/badge";
import { environmentBannerLabel } from "@/lib/ops/environment-banner";

/**
 * A small label fixed to the top edge on every page of a non-production deployment, so staging is never mistaken for production. It takes no
 * room in the layout (it is fixed and ignores the pointer), and renders nothing in production.
 */
export function EnvironmentBanner() {
  const label = environmentBannerLabel();
  if (!label) return null;
  return (
    <div role="status" className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex justify-center">
      <Badge variant="secondary" className="rounded-t-none">
        {label} environment: test data only
      </Badge>
    </div>
  );
}
