"use client";

import React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "../animate-ui/components/animate/tabs";

/** Pill group used for saved views / category tabs above a data table. */
export function SavedViewBar<T extends string>({
  views,
  active,
  onChange,
}: {
  views: readonly T[];
  active: T;
  onChange: (view: T) => void;
}) {
  return (
    <Tabs
      value={active}
      onValueChange={onChange as (value: string) => void}
      className=""
    >
      <TabsList>
        {views.map((view) => {
          const selected = active === view;
          return (
            <TabsTrigger
              key={view}
              value={view}
              className={cn(!selected && "text-muted-foreground")}
            >
              {view}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
