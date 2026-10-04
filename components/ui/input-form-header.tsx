import React from "react";

interface InputFormHeaderProps {
  title: string;
  icon: React.ReactNode;
  act?: React.ReactNode;
}
const InputFormHeader = ({ title, icon, act }: InputFormHeaderProps) => {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="size-3.5 text-primary">{icon}</div>
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
      </div>
      {act && act}
    </div>
  );
};

export default InputFormHeader;
