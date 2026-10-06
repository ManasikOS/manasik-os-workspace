import React from "react";
import { Card } from "./card";

interface InputFormCardProps {
  children: React.ReactNode;
  title: string;
  icon: React.ReactNode;
  desc?: string;
}

const InputFormCard = ({ children, title, icon, desc }: InputFormCardProps) => {
  return (
    <Card className="px-5 py-3 bg-card/70!">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 text-muted-foreground">{icon}</div>
        <div>
          <h2 className="text-base font-medium text-foreground">
            {title}
          </h2>
          {desc && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{desc}</p>}
        </div>
      </div>
      {children}
    </Card>
  );
};

export default InputFormCard;
