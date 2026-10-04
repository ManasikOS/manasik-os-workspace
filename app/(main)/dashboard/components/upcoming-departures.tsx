"use client";

import React from "react";
import SectionHeading from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ArrowRight,
  Plane,
  Users,
  FileCheck,
  ShieldCheck,
  CreditCard,
  Building,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { UpcomingDepartureGroup } from "@/lib/types/dashboard";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  TONE_BADGE_BORDER,
  TONE_BAR,
  TONE_CLASS,
  TONE_TEXT,
  type Tone,
} from "@/lib/ui/tone";

interface UpcomingDeparturesProps {
  groups: UpcomingDepartureGroup[];
}

const READINESS_TONE: Record<UpcomingDepartureGroup["readinessState"], Tone> = {
  Ready: "success",
  "Needs Attention": "warning",
  "At Risk": "danger",
  Selling: "info",
};

export default function UpcomingDepartures({
  groups,
}: UpcomingDeparturesProps) {
  const getReadinessBadgeStyle = (
    state: UpcomingDepartureGroup["readinessState"],
  ) => {
    const tone = READINESS_TONE[state] ?? "neutral";
    return cn(TONE_CLASS[tone], TONE_BADGE_BORDER[tone]);
  };

  const getProgressBarColor = (
    state: UpcomingDepartureGroup["readinessState"],
  ) => TONE_BAR[READINESS_TONE[state] ?? "brand"];

  return (
    <Card className=" flex flex-col gap-4 h-full">
      <div>
        <SectionHeading
          title="Upcoming Departures"
          act={
            <div className="flex items-center gap-3">
              <span className="font-arabic text-sm text-primary font-normal">
                الأفواج القادمة
              </span>
              <Button
                variant="link"
                size="sm"
                className="h-5 p-0 text-xs font-medium gap-1"
                render={<Link href="/departure-groups" />}
              >
                <span>View all groups</span>
                <ArrowRight className="size-3.5" />
              </Button>
            </div>
          }
        />
        <p className="text-xs text-muted-foreground mt-0.5">
          Real-time Group readiness and operational progress.
        </p>
      </div>

      <div className="flex flex-col gap-8">
        {groups.map((group) => {
          const badgeStyle = getReadinessBadgeStyle(group.readinessState);
          const progressColor = getProgressBarColor(group.readinessState);

          return (
            <Card
              key={group.id}
              className="  bg-card/50!  hover:bg-primary/20 transition-all flex flex-col gap-3"
            >
              {/* Top Header */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className=" items-center gap-2">
                  <h4 className="font-medium text-lg text-foreground tracking-tight">
                    {group.name}
                  </h4>
                  <div className="flex gap-2 items-center mt-1">
                    {/* eslint-disable no-restricted-syntax -- fixed Hajj/Umrah
                        category tag, not a status/severity signal */}
                    <Badge
                      className={`px-2 py-0.5 ${
                        group.category === "Hajj"
                          ? "bg-amber-500/20 text-amber-800 dark:text-amber-300"
                          : "bg-emerald-500/20 text-emerald-800 dark:text-emerald-300"
                      }`}
                    >
                      {group.category}
                    </Badge>
                    {/* eslint-enable no-restricted-syntax */}
                    <Badge
                      variant={"outline"}
                      className="font-number text-muted-foreground"
                    >
                      {group.code}
                    </Badge>
                    <Badge className={cn("px-2 py-0.5 border font-medium", badgeStyle)}>
                      {group.readinessState}
                    </Badge>
                    <Badge
                      variant={"destructive"}
                      className={`text-xs font-medium px-2 py-0.5 border `}
                    >
                      {group.countdownLabel}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Group Meta Info */}
              <div className="flex flex-wrap items-center mt-3 justify-between text-xs text-muted-foreground gap-y-1 gap-x-4  border-border/40 pb-2">
                <div className="flex items-center gap-1.5">
                  <Plane className="size-3.5 text-primary" />
                  <span>{group.routeAndDates}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <Users className="size-3.5" />
                    <strong className="font-number text-foreground">
                      {group.pilgrimCount}
                    </strong>{" "}
                    / <span className="font-number">{group.totalCapacity}</span>{" "}
                    pilgrims
                  </span>
                  <span className="text-foreground/80 font-medium">
                    Guide: {group.guideName}{" "}
                    <span className="font-arabic text-[11px] text-muted-foreground">
                      ({group.guideArabic})
                    </span>
                  </span>
                </div>
              </div>

              {/* Readiness Mini Grid — a fixed 4-way category legend
                  (Docs/Visa/Payments/Operations), not a status/severity
                  signal, so it keeps its own distinct hues rather than
                  routing through the tone system. */}
              {/* eslint-disable no-restricted-syntax */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs py-1">
                <div className="p-3 shadow-none! bg-transparent! flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground flex items-center gap-1 font-medium">
                    <FileCheck className="size-4 text-sky-500" /> Docs
                  </span>
                  <span className="font-number text-lg font-semibold text-foreground">
                    {group.readiness.documents.completed} /{" "}
                    {group.readiness.documents.total}
                  </span>
                </div>

                <div className="p-3 flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground flex items-center gap-1 font-medium">
                    <ShieldCheck className="size-4 text-emerald-500" /> Visa
                  </span>
                  <span className="font-number text-lg font-semibold text-foreground">
                    {group.readiness.visas.completed} /{" "}
                    {group.readiness.visas.total}
                  </span>
                </div>

                <div className="p-3 flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground flex items-center gap-1 font-medium">
                    <CreditCard className="size-4 text-amber-500" /> Payments
                  </span>
                  <span className="font-number text-lg font-semibold text-foreground">
                    {group.readiness.payments.completed} /{" "}
                    {group.readiness.payments.total}
                  </span>
                </div>

                <div className="p-3 flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground flex items-center gap-1 font-medium">
                    <Building className="size-4 text-purple-500" /> Operations
                  </span>
                  <span className="font-medium text-lg text-foreground truncate ">
                    {group.readiness.operationsStatus}
                  </span>
                </div>
              </div>
              {/* eslint-enable no-restricted-syntax */}

              {/* Progress & Bottom Actions */}
              <div className="flex flex-col gap-1.5 pt-1">
                <div className="flex justify-between items-center text-xs">
                  <div className="flex items-center gap-1.5">
                    {group.readinessState === "At Risk" ? (
                      <AlertTriangle className="size-3.5 text-destructive" />
                    ) : (
                      <CheckCircle2 className={cn("size-3.5", TONE_TEXT.success)} />
                    )}
                    <span className="font-semibold text-foreground">
                      {group.progressPercentage}% · {group.readinessState}
                    </span>
                    <span className="text-muted-foreground text-[11px] hidden sm:inline">
                      — {group.riskReason}
                    </span>
                  </div>

                  <Link href={group.destination}>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="h-6 text-xs text-primary font-medium hover:underline"
                    >
                      Open group
                    </Button>
                  </Link>
                </div>

                {/* Progress Bar Container */}
                <div className="w-full bg-muted h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 rounded-full ${progressColor}`}
                    style={{ width: `${group.progressPercentage}%` }}
                  />
                </div>
              </div>

              {/* Seat fill — the commercial half of the story, alongside readiness */}
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between items-center text-xs text-muted-foreground">
                  <span>
                    Seats filled: <strong className="font-number text-foreground">{group.pilgrimCount}</strong> / {group.totalCapacity}
                  </span>
                  <span className="font-number">
                    {group.totalCapacity > 0 ? Math.round((group.pilgrimCount / group.totalCapacity) * 100) : 0}%
                  </span>
                </div>
                <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full transition-all duration-500"
                    style={{
                      width: `${group.totalCapacity > 0 ? Math.min(100, Math.round((group.pilgrimCount / group.totalCapacity) * 100)) : 0}%`,
                    }}
                  />
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </Card>
  );
}
