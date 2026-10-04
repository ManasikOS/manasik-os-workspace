import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

import PageHeader from "./page-header";

/**
 * Shared shell for nav destinations that have a route and a place in the
 * sidebar but no module behind them yet. Keeps every "not built yet" page
 * consistent (breadcrumb, title, planned scope) instead of each one
 * improvising its own placeholder.
 */
export default function ComingSoonPage({
  title,
  section,
  icon: Icon,
  description,
  plannedFeatures,
}: {
  title: string;
  section: string;
  icon: LucideIcon;
  description: string;
  plannedFeatures: string[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={title}
        breadcrumb={[
          { title: section, link: "#" },
          { title, link: "#" },
        ]}
        action={<Badge variant="secondary">Coming soon</Badge>}
      />
      <Card className="max-w-2xl">
        <CardContent className="flex flex-col gap-4">
          <div className="flex size-11 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="size-5" />
          </div>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-base font-medium">{title} is on the roadmap</h3>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          <ul className="flex flex-col gap-2 border-t pt-4 text-sm text-muted-foreground">
            {plannedFeatures.map((feature) => (
              <li key={feature} className="flex items-start gap-2">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/50" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
