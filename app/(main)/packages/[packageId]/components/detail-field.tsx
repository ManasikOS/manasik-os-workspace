import React from "react";

import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/tone-badge";
import SectionHeading from "@/components/section-heading";

export function DetailSection({
  title,
  icon,
  children,
  className,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <SectionHeading title={title} />
      {children}
    </Card>
  );
}

export function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
        {label}
      </span>
      <span className="text-sm text-foreground">{value || "—"}</span>
    </div>
  );
}

export function FieldGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {children}
    </div>
  );
}

export function TabEmpty({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return <EmptyState title={title} description={description} />;
}
