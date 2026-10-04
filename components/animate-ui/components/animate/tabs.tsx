import * as React from "react";

import {
  Tabs as TabsPrimitive,
  TabsList as TabsListPrimitive,
  TabsTrigger as TabsTriggerPrimitive,
  TabsContent as TabsContentPrimitive,
  TabsContents as TabsContentsPrimitive,
  TabsHighlight as TabsHighlightPrimitive,
  TabsHighlightItem as TabsHighlightItemPrimitive,
  type TabsProps as TabsPrimitiveProps,
  type TabsListProps as TabsListPrimitiveProps,
  type TabsTriggerProps as TabsTriggerPrimitiveProps,
  type TabsContentProps as TabsContentPrimitiveProps,
  type TabsContentsProps as TabsContentsPrimitiveProps,
} from "@/components/animate-ui/primitives/animate/tabs";
import { cn } from "@/lib/utils";

type TabsProps = TabsPrimitiveProps;

function Tabs({ className, ...props }: TabsProps) {
  return (
    <TabsPrimitive
      className={cn("flex flex-col rounded-sm gap-2", className)}
      {...props}
    />
  );
}

type TabsListProps = TabsListPrimitiveProps;

function TabsList({ className, ...props }: TabsListProps) {
  return (
    <TabsHighlightPrimitive className="absolute z-0  inset-0  rounded-[4px] bg-background dark:border-input dark:bg-input/30 shadow-sm">
      <TabsListPrimitive
        className={cn(
          "bg-white flex-wrap justify-start w-fit gap-2 dark:bg-card border-[0.2px] border-muted-foreground/5  text-muted-foreground inline-flex min-h-10 items-center rounded-[4px] px-1 py-1",
          "transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ",
          "shadow-[0_1px_3px_rgba(0,0,0,0.01),0_10px_10px_rgba(0,0,0,0.02),0_20px_40px_rgba(0,0,0,0.02)]",
          "dark:shadow-[0_1px_2px_rgba(0,0,0,0.2),0_8px_16px_rgba(0,0,0,0.4)]",
          className,
        )}
        {...props}
      />
    </TabsHighlightPrimitive>
  );
}

type TabsTriggerProps = TabsTriggerPrimitiveProps;

function TabsTrigger({ className, ...props }: TabsTriggerProps) {
  return (
    <TabsHighlightItemPrimitive
      value={props.value}
      className="w-fit ring-0! border-none! outline-none"
    >
      <TabsTriggerPrimitive
        className={cn(
          "data-[state=active]:text-primary! px-3 py-1  ring-transparent! border-transparent! outline-transparent dark:data-[state=active]:ring-0! data-[state=active]:border-transparent! data-[state=active]:outline-none! outline-none! data-[state=active]:bg-primary/10 ring-0!  data-[state=active]:border-none text-muted-foreground inline-flex flex-1 items-center justify-center gap-1.5 rounded-[4px] w-full min-h-full text-sm font-medium whitespace-nowrap transition-colors duration-500 ease-in-out   disabled:pointer-events-none disabled:opacity-70 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
          className,
        )}
        {...props}
      />
    </TabsHighlightItemPrimitive>
  );
}

type TabsContentsProps = TabsContentsPrimitiveProps;

function TabsContents(props: TabsContentsProps) {
  return <TabsContentsPrimitive {...props} />;
}

type TabsContentProps = TabsContentPrimitiveProps;

function TabsContent({ className, ...props }: TabsContentProps) {
  return (
    <TabsContentPrimitive
      className={cn("outline-none", className)}
      {...props}
    />
  );
}

export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContents,
  TabsContent,
  type TabsProps,
  type TabsListProps,
  type TabsTriggerProps,
  type TabsContentsProps,
  type TabsContentProps,
};
