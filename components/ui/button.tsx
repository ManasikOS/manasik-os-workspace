import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 min-h-10   items-center ring-0 justify-center rounded-[calc(var(--radius-sm)-1px)] border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary shadow-sm border-none text-white [a]:hover:bg-primary/80",
        bg_primary_gradient:
          "shadow-sm bg-linear-to-r  from-primary via-primary/70 to-primary text-white [a]:hover:from-accent [a]:hover:to-emerald-600",
        outline_without_border:
          " bg-muted/10  dark:bg-white/2 shadow-sm border border-muted-foreground/5 hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground  dark:bg-input/40 dark:hover:bg-input/50",
        //  outline:
        //         "border-border  hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",

        outline:
          " bg-muted/10  dark:bg-white/2 shadow-sm border border-muted-foreground/5 hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground  dark:bg-input/40 dark:hover:bg-input/50",
        secondary:
          "bg-primary/10 ring-0 shadow-sm border-none   text-primary hover:bg-primary/20 dark:hover:bg-primary/25 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5  px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-sm px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  nativeButton,
  render,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      render={render}
      // A `render` prop almost always swaps in a non-<button> element (an
      // `<a>` via next/link, most often) — default `nativeButton` to false
      // in that case so Base UI doesn't warn about missing native button
      // semantics on an element that was never meant to be one. A caller
      // rendering an actual <button> through `render` can still pass
      // `nativeButton` explicitly to opt back in.
      nativeButton={nativeButton ?? !render}
      className={cn("p-0 px-5", buttonVariants({ variant, size, className }))}
      style={{
        boxShadow:
          variant === "bg_primary_gradient"
            ? "inset 1px 1px 0px rgba(255, 255, 255, 0.5)"
            : undefined,
      }}
      {...props}
    />
  );
}

export { Button, buttonVariants };
