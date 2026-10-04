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
      <div className="flex gap-1">
        <div className="mt-0.5">{icon}</div>
        <div>
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {title}
          </h2>
          {desc && <p className="text-sm text-muted-foreground">{desc}</p>}{" "}
        </div>
      </div>
      {children}
    </Card>
  );
};

export default InputFormCard;
