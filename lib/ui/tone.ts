/**
 * Shared tone vocabulary for status badges and progress bars across modules.
 *
 * Mirrors the palette already used by Departure Groups
 * (`app/(main)/departure-groups/utils.ts`) so a status reads the same colour
 * everywhere in the app. Colour is never the only signal — every tone is
 * always paired with a text label by the components in
 * `components/ui/tone-badge.tsx`.
 */

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "brand";

export const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-muted/60 text-muted-foreground",
  info: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  danger: "bg-destructive/10 text-destructive",
  brand: "bg-primary/10 text-primary",
};

export const TONE_BAR: Record<Tone, string> = {
  neutral: "bg-muted-foreground/40",
  info: "bg-sky-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-destructive",
  brand: "bg-primary",
};

/** Icon/text-only version of TONE_CLASS, for icons that sit outside a badge pill. */
export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  info: "text-sky-600 dark:text-sky-400",
  success: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
  danger: "text-destructive",
  brand: "text-primary",
};

/** Hover-border accent for a row/card whose severity is this tone. */
export const TONE_BORDER: Record<Tone, string> = {
  neutral: "hover:border-muted-foreground/40",
  info: "hover:border-sky-500/40",
  success: "hover:border-emerald-500/40",
  warning: "hover:border-amber-500/40",
  danger: "hover:border-destructive/40",
  brand: "hover:border-primary/40",
};

/** Static (non-hover) border for a tinted pill/badge — pairs with TONE_CLASS. */
export const TONE_BADGE_BORDER: Record<Tone, string> = {
  neutral: "border-border",
  info: "border-sky-500/20",
  success: "border-emerald-500/20",
  warning: "border-amber-500/20",
  danger: "border-destructive/20",
  brand: "border-primary/20",
};

/** Tinted background + border for a small stat/summary card — pair with TONE_TEXT for its label/value. */
export const TONE_STAT_CARD: Record<Tone, string> = {
  neutral: "bg-muted/40 dark:bg-muted/20 ",
  info: "bg-sky-500/10 dark:bg-sky-900/20 ",
  success: "bg-emerald-500/10 dark:bg-emerald-900/20 ",
  warning: "bg-amber-500/10 dark:bg-amber-900/20 ",
  danger: "bg-destructive/10 dark:bg-destructive/20 ",
  brand: "bg-primary/10 dark:bg-primary/20 ",
};

export function percentTone(percent: number): Tone {
  if (percent >= 90) return "success";
  if (percent >= 60) return "info";
  if (percent >= 30) return "warning";
  return "danger";
}
