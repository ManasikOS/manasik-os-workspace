import React from "react";

interface SectionHeadingProps {
  title: string;
  act?: React.ReactNode;
  description?: string;
}
const SectionHeading = ({ title, act, description }: SectionHeadingProps) => {
  return (
    <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-xl font-medium tracking-tight">{title}</h2>
        {description && (
          <p className="text-sm mt-0.5 text-muted-foreground">{description}</p>
        )}
      </div>
      {act && <div className="w-full sm:w-auto">{act}</div>}
    </div>
  );
};

export default SectionHeading;
