import { cn } from "@/lib/utils";
import React from "react";

const CardItem = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "flex flex-row justify-between rounded-sm shadow-sm px-2.5 py-1",
        className,
      )}
    >
      {children}
    </div>
  );
};

export default CardItem;
