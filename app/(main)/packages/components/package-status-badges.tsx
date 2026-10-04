"use client";

import React from "react";

import { ToneBadge } from "@/components/ui/tone-badge";
import type { Tone } from "@/lib/ui/tone";
import type {
  JourneyType,
  PackageCategory,
  PackageStatus,
  PackageVisibility,
} from "@/lib/types/packages";

const JOURNEY_TONE: Record<JourneyType, Tone> = {
  Umrah: "info",
  Hajj: "brand",
  "Early Registration": "neutral",
};

export function JourneyTypeBadge({ value }: { value: JourneyType }) {
  return <ToneBadge tone={JOURNEY_TONE[value]} label={value} />;
}

const STATUS_TONE: Record<PackageStatus, Tone> = {
  Draft: "warning",
  "Open for Sale": "success",
  "Sales Closed": "neutral",
  Archived: "neutral",
};

export function PackageStatusBadge({ value }: { value: PackageStatus }) {
  return <ToneBadge tone={STATUS_TONE[value]} label={value} />;
}

const VISIBILITY_TONE: Record<PackageVisibility, Tone> = {
  "Internal Only": "neutral",
  "Pilgrim Portal": "info",
  "Website & Portal": "brand",
};

export function VisibilityBadge({ value }: { value: PackageVisibility }) {
  return <ToneBadge tone={VISIBILITY_TONE[value]} label={value} />;
}

export function PackageCategoryBadge({ value }: { value: PackageCategory }) {
  return <ToneBadge tone="neutral" label={value} />;
}
