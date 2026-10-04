import React from "react";

interface SectionHeadingProps {
  title: string;
  act?: React.ReactNode;
  description?: string;
}
const SectionHeading = ({ title, act, description }: SectionHeadingProps) => {
  return (
    <div className="flex flex-row justify-between w-full items-start gap-3">
      <div className="min-w-0">
        <h2 className="text-xl font-medium tracking-tight">{title}</h2>
        {description && (
          <p className="text-sm mt-0.5 text-muted-foreground">{description}</p>
        )}
      </div>
      {act && <div>{act}</div>}
    </div>
  );
};

export default SectionHeading;
