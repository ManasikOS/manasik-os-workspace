"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { ToneBadge, ProgressBar, EmptyState } from "@/components/ui/tone-badge";
import { SuccessPulse } from "@/components/ui/success-pulse";
import type { Tone } from "@/lib/ui/tone";
import { Sparkles, Inbox } from "lucide-react";

function SuccessPulseDemo() {
  const [key, setKey] = useState(0);
  return (
    <button
      type="button"
      onClick={() => setKey((k) => k + 1)}
      className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
      aria-label="Replay success pulse"
    >
      <SuccessPulse key={key} />
    </button>
  );
}

const BUTTON_VARIANTS = [
  "default",
  "bg_primary_gradient",
  "outline_without_border",
  "outline",
  "secondary",
  "ghost",
  "destructive",
  "link",
] as const;

const BUTTON_SIZES = ["default", "xs", "sm", "lg"] as const;

const BADGE_VARIANTS = [
  "default",
  "secondary",
  "destructive",
  "outline",
  "ghost",
  "link",
] as const;

const TONES: Tone[] = ["neutral", "info", "success", "warning", "danger", "brand"];

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground tracking-tight">{title}</h2>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * A single page rendering every core UI primitive and variant side by side —
 * the fastest way to catch a mismatched brand color or a broken variant
 * before it ships to a real page. Not linked from the app nav; visit
 * /dev/components directly. Not gated behind auth (lives outside the
 * (main) route group), matching /legal's pattern for standalone routes.
 */
export default function ComponentGalleryPage() {
  const [selectValue, setSelectValue] = useState("umrah");
  const [switchOn, setSwitchOn] = useState(true);
  const [checked, setChecked] = useState(true);

  return (
    <div className="min-h-screen bg-background px-8 py-10">
      <div className="max-w-5xl mx-auto flex flex-col gap-12">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Component Gallery
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every core primitive, every variant. Dev-only — not linked from the app.
          </p>
        </div>

        <Section title="Buttons">
          <div className="flex flex-col gap-3">
            {BUTTON_VARIANTS.map((variant) => (
              <div key={variant} className="flex items-center gap-3 flex-wrap">
                <span className="w-44 shrink-0 text-xs font-mono text-muted-foreground">
                  {variant}
                </span>
                {BUTTON_SIZES.map((size) => (
                  <Button key={size} variant={variant} size={size}>
                    Button
                  </Button>
                ))}
              </div>
            ))}
          </div>
        </Section>

        <Section title="Badges">
          <div className="flex items-center gap-2 flex-wrap">
            {BADGE_VARIANTS.map((variant) => (
              <Badge key={variant} variant={variant}>
                {variant}
              </Badge>
            ))}
          </div>
        </Section>

        <Section
          title="Tone system"
          description="Every status color in the app is one of these six tones — nothing else should be hand-rolled."
        >
          <div className="flex items-center gap-2 flex-wrap">
            {TONES.map((tone) => (
              <ToneBadge key={tone} tone={tone} label={tone} />
            ))}
          </div>
          <div className="flex flex-col gap-2 max-w-sm">
            {TONES.map((tone) => (
              <div key={tone} className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-xs font-mono text-muted-foreground">
                  {tone}
                </span>
                <ProgressBar percent={70} tone={tone} />
              </div>
            ))}
          </div>
        </Section>

        <Section title="Cards">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Default card</CardTitle>
                <CardDescription>Standard padding, soft shadow.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  bg-card token, rounded-md, single hairline border.
                </p>
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardTitle>Compact card</CardTitle>
                <CardDescription>size=&quot;sm&quot; variant.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">Tighter gaps and padding.</p>
              </CardContent>
            </Card>
          </div>
        </Section>

        <Section title="Form controls">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-foreground">Input</label>
              <Input placeholder="Type something…" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-foreground">Select</label>
              <Select
                value={selectValue}
                onValueChange={(value) => value && setSelectValue(value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="umrah">Umrah</SelectItem>
                  <SelectItem value="hajj">Hajj</SelectItem>
                  <SelectItem value="early_registration">Early Registration</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label className="text-xs font-medium text-foreground">Textarea</label>
              <Textarea placeholder="Notes…" rows={3} />
            </div>
            <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer select-none">
              <Checkbox checked={checked} onCheckedChange={(v) => setChecked(v === true)} />
              Checkbox
            </label>
            <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer select-none">
              <Switch checked={switchOn} onCheckedChange={setSwitchOn} />
              Switch
            </label>
          </div>
        </Section>

        <Section title="Dialog">
          <Dialog>
            <DialogTrigger render={<Button variant="outline" />}>
              Open dialog
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Dialog title</DialogTitle>
                <DialogDescription>
                  Standard dialog chrome — backdrop blur, rounded-md, bg-card token.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline">Cancel</Button>
                <Button>Confirm</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Section>

        <Section title="Skeleton">
          <div className="flex flex-col gap-2 max-w-sm">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-8 w-52" />
            <Skeleton className="h-24 w-full" />
          </div>
        </Section>

        <Section
          title="Motion"
          description="The route-loader's brand language (conic gradient, cubic-bezier(0.22,1,0.36,1) easing) resolved into a couple more moments instead of staying the only elaborate one."
        >
          <div className="flex items-center gap-8 flex-wrap">
            <div className="flex flex-col items-center gap-2">
              <SuccessPulseDemo />
              <span className="text-xs text-muted-foreground">Success pulse (click to replay)</span>
            </div>
          </div>
        </Section>

        <Section title="Empty state">
          <Card className="p-0">
            <EmptyState
              icon={<Inbox className="size-8" />}
              title="Nothing here yet"
              description="This is the shared empty-state pattern used across every module."
              action={
                <Button size="sm">
                  <Sparkles className="size-3.5" />
                  Take an action
                </Button>
              }
            />
          </Card>
        </Section>
      </div>
    </div>
  );
}
