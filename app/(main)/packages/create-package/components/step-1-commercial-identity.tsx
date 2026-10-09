"use client";

import React, { useState, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToneBadge } from "@/components/ui/tone-badge";
import { PackageFormData, JourneyType, PackageCategory } from "../types";
import type { PackageFieldErrors } from "../schemas";
import {
  checkPackageCodeAction,
  getNextPackageCodeAction,
  type PackageCodeCheckResult,
} from "../../actions";

interface StepCommercialIdentityProps {
  formData: PackageFormData;
  setFormData: React.Dispatch<React.SetStateAction<PackageFormData>>;
  /** Row id once the draft exists, so the package's own code is not reported as already used. */
  currentPackageId?: string | null;
  /** Messages for this step's fields; only passed once the step has been visited and left. */
  fieldErrors?: PackageFieldErrors | null;
}

const CATEGORIES: PackageCategory[] = [
  "Economy",
  "Standard",
  "Premium",
  "VIP",
  "Custom",
];
const JOURNEY_TYPES: JourneyType[] = ["Umrah", "Hajj", "Early Registration"];

export const StepCommercialIdentity: React.FC<StepCommercialIdentityProps> = ({
  formData,
  setFormData,
  currentPackageId = null,
  fieldErrors = null,
}) => {
  // Kept with the code it was checked for, so a stale answer is never shown for a newer code.
  const [packageCodeCheck, setPackageCodeCheck] = useState<{
    code: string;
    result: PackageCodeCheckResult;
  } | null>(null);
  const typedPackageCode = formData.internalCode.trim();

  // A new package starts with no code: fetch the next unused one for the read-only field.
  const needsGeneratedPackageCode = !typedPackageCode;
  const [packageCodeError, setPackageCodeError] = useState<string | null>(null);
  const [packageCodeRetry, setPackageCodeRetry] = useState(0);
  useEffect(() => {
    if (!needsGeneratedPackageCode) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await getNextPackageCodeAction();
        if (cancelled) return;
        if (!result.ok) {
          setPackageCodeError(result.error);
          return;
        }
        setPackageCodeError(null);
        setFormData((prev) =>
          prev.internalCode.trim()
            ? prev
            : { ...prev, internalCode: result.code },
        );
      } catch (error) {
        if (cancelled) return;
        console.error("Could not generate a package code", error);
        setPackageCodeError(
          "Could not generate a package code. Check your connection and try again.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needsGeneratedPackageCode, packageCodeRetry, setFormData]);

  // Asks the server whether the code is still free, half a second after it changes.
  useEffect(() => {
    if (!typedPackageCode) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await checkPackageCodeAction({
          code: typedPackageCode,
          packageId: currentPackageId,
        });
        if (!cancelled) setPackageCodeCheck({ code: typedPackageCode, result });
      } catch {
        // Offline or a rotated action id: the save itself still reports a clash.
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [typedPackageCode, currentPackageId]);

  const shownPackageCodeCheck =
    packageCodeCheck && packageCodeCheck.code === typedPackageCode
      ? packageCodeCheck.result
      : null;
  const packageCodeSuggestion =
    shownPackageCodeCheck &&
    shownPackageCodeCheck.ok &&
    !shownPackageCodeCheck.available
      ? shownPackageCodeCheck.suggestion
      : null;

  const updateField = <K extends keyof PackageFormData>(
    field: K,
    value: PackageFormData[K],
  ) => {
    setFormData((prev) => {
      const next = { ...prev, [field]: value };
      // Sync journeyType & category
      if (field === "journeyType") {
        next.category = value === "Hajj" ? "Hajj" : "Umrah";
      }
      // If status is changed from Open for Sale, uncheck featured
      if (field === "status" && value !== "Open for Sale") {
        next.featured = false;
      }
      return next;
    });
  };

  const firstError = (field: keyof PackageFormData) =>
    fieldErrors?.[field]?.[0];

  return (
    <div className="flex flex-col gap-5">
      {/* GROUP 1: what the package is called and how it is described */}
      <Card variant="md-shadow" className="px-5 py-5">
        <CardHeader>
          <CardTitle>Package identity</CardTitle>
          <CardDescription>
            The name, code and overview sales staff and customers see.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 md:flex-row">
            <div className="flex flex-2 flex-col gap-1.5">
              <InputGroup>
                <InputGroupAddon align="block-start">
                  <InputGroupText>
                    Package Name <span className="text-destructive">*</span>
                  </InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  placeholder="e.g. 14-Day Standard Umrah Package 2026"
                  value={formData.title}
                  aria-invalid={firstError("title") ? true : undefined}
                  onChange={(e) => updateField("title", e.target.value)}
                />
              </InputGroup>
              {firstError("title") ? (
                <p className="text-xs text-destructive">
                  {firstError("title")}
                </p>
              ) : null}
            </div>

            <div className="flex flex-1 flex-col gap-1.5">
              <InputGroup>
                <InputGroupAddon align="block-start">
                  <InputGroupText>
                    Package Code <span className="text-destructive">*</span>
                  </InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  readOnly
                  placeholder="Generating package code…"
                  value={formData.internalCode}
                  className="cursor-not-allowed"
                  aria-invalid={packageCodeSuggestion ? true : undefined}
                />
              </InputGroup>
              {packageCodeError && !typedPackageCode ? (
            <p className="text-xs text-destructive">
              {packageCodeError}{" "}
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto cursor-pointer p-0 text-xs"
                onClick={() => setPackageCodeRetry((count) => count + 1)}
              >
                Try again
              </Button>
            </p>
          ) : null}
          {packageCodeSuggestion ? (
                <p className="text-xs text-destructive">
                  Another package already uses this code. Each package needs its
                  own code.{" "}
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto cursor-pointer p-0 text-xs"
                    onClick={() =>
                      updateField("internalCode", packageCodeSuggestion)
                    }
                  >
                    Use {packageCodeSuggestion}
                  </Button>
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <InputGroup className="gap-0">
              <InputGroupAddon align="block-start">
                <InputGroupText>
                  Short Package Overview{" "}
                  <span className="text-destructive">*</span>
                </InputGroupText>
              </InputGroupAddon>
              <InputGroupTextarea
                rows={4}
                placeholder="Provide a clear commercial summary detailing what this package offers..."
                value={formData.description}
                aria-invalid={firstError("description") ? true : undefined}
                onChange={(e) => updateField("description", e.target.value)}
                className="text-sm"
              />
            </InputGroup>
            {firstError("description") ? (
              <p className="text-xs text-destructive">
                {firstError("description")}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* GROUP 2: journey type, length and category */}
      <Card variant="md-shadow" className="px-5 py-5">
        <CardHeader>
          <CardTitle>Journey &amp; classification</CardTitle>
          <CardDescription>
            The type and length of the journey. A template&apos;s length is
            reusable across every departure.
          </CardDescription>
          <CardAction>
            {/* Status is deliberately NOT editable here. It used to be a
                dropdown that wrote straight to the row through draft
                autosave, which let anyone who can edit a package publish,
                close sales on, or archive it — bypassing the publish
                completeness check and the `publishPackage` /
                `archiveOrRestorePackage` capabilities entirely. Lifecycle
                changes now only happen through the dedicated actions on the
                package list and detail screens, which re-check capability
                and re-run validation server-side. See
                docs/modules/packages-production-readiness-plan.md, finding A1. */}
            <ToneBadge
              tone={formData.status === "Draft" ? "neutral" : "brand"}
              label={`Status: ${formData.status}`}
            />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <DropdownMenu>
              <DropdownMenuTrigger className="w-full cursor-pointer text-start">
                <InputGroup>
                  <InputGroupAddon align="block-start">
                    <InputGroupText>Journey Type</InputGroupText>
                    <ChevronDown className="ml-auto mr-2 size-3.5 text-muted-foreground" />
                  </InputGroupAddon>
                  <InputGroupInput
                    id="journey-type"
                    readOnly
                    value={formData.journeyType}
                    className="cursor-pointer"
                  />
                </InputGroup>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {JOURNEY_TYPES.map((type) => (
                  <DropdownMenuItem
                    key={type}
                    onClick={() => updateField("journeyType", type)}
                  >
                    {type}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex flex-col gap-1.5">
              <InputGroup>
                <InputGroupAddon align="block-start">
                  <InputGroupText>
                    Days <span className="text-destructive">*</span>
                  </InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  type="number"
                  value={formData.days}
                  aria-invalid={firstError("days") ? true : undefined}
                  onChange={(e) => {
                    const d = parseInt(e.target.value) || 1;
                    const n = Math.max(0, d - 1);
                    updateField("days", d);
                    updateField("nights", n);
                    updateField("duration", `${d} Days / ${n} Nights`);
                  }}
                />
              </InputGroup>
              {firstError("days") ? (
                <p className="text-xs text-destructive">{firstError("days")}</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <InputGroup>
                <InputGroupAddon align="block-start">
                  <InputGroupText>
                    Nights <span className="text-destructive">*</span>
                  </InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  type="number"
                  value={formData.nights}
                  aria-invalid={firstError("nights") ? true : undefined}
                  onChange={(e) => {
                    const n = parseInt(e.target.value) || 0;
                    updateField("nights", n);
                    updateField(
                      "duration",
                      `${formData.days} Days / ${n} Nights`,
                    );
                  }}
                />
              </InputGroup>
              {firstError("nights") ? (
                <p className="text-xs text-destructive">
                  {firstError("nights")}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger className="w-full cursor-pointer text-start">
                <InputGroup>
                  <InputGroupAddon align="block-start">
                    <InputGroupText>
                      Package Category{" "}
                      <span className="text-destructive">*</span>
                    </InputGroupText>
                    <ChevronDown className="ml-auto mr-2 size-3.5 text-muted-foreground" />
                  </InputGroupAddon>
                  <InputGroupInput
                    readOnly
                    value={formData.package_category}
                    placeholder="Select Category"
                    aria-invalid={
                      firstError("package_category") ? true : undefined
                    }
                    className="cursor-pointer"
                  />
                </InputGroup>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                {CATEGORIES.map((cat) => (
                  <DropdownMenuItem
                    key={cat}
                    onClick={() => updateField("package_category", cat)}
                    className="cursor-pointer"
                  >
                    {cat}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {firstError("package_category") ? (
              <p className="text-xs text-destructive">
                {firstError("package_category")}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Status changes (Publish, Close Sales, Archive) happen from the
              package list or detail page, not here.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* GROUP 3: default group sizing */}
      <Card variant="md-shadow" className="px-5 py-5">
        <CardHeader>
          <CardTitle>Group capacity &amp; sizing</CardTitle>
          <CardDescription>
            Defaults copied into each Departure Group created from this package.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <InputGroup>
                <InputGroupAddon align="block-start">
                  <InputGroupText>
                    Default Group Capacity{" "}
                    <span className="text-destructive">*</span>
                  </InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  type="number"
                  placeholder="e.g. 40"
                  value={formData.defaultCapacity}
                  aria-invalid={
                    firstError("defaultCapacity") ? true : undefined
                  }
                  onChange={(e) => {
                    const val = e.target.value ? parseInt(e.target.value) : "";
                    updateField("defaultCapacity", val);
                    updateField("defaultGroupCapacity", val);
                    updateField("maxPilgrims", val);
                  }}
                />
              </InputGroup>
              {firstError("defaultCapacity") ? (
                <p className="text-xs text-destructive">
                  {firstError("defaultCapacity")}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Default target pilgrims per departure group
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <InputGroup>
                <InputGroupAddon align="block-start">
                  <InputGroupText>
                    Min Viable Group <span className="text-destructive">*</span>
                  </InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  type="number"
                  placeholder="e.g. 15"
                  value={formData.minGroupSize}
                  aria-invalid={firstError("minGroupSize") ? true : undefined}
                  onChange={(e) =>
                    updateField(
                      "minGroupSize",
                      e.target.value ? parseInt(e.target.value) : "",
                    )
                  }
                />
              </InputGroup>
              {firstError("minGroupSize") ? (
                <p className="text-xs text-destructive">
                  {firstError("minGroupSize")}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Min bookings required to operate group
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <InputGroup>
                <InputGroupAddon align="block-start">
                  <InputGroupText>Seat Hold Expiry</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  readOnly
                  value={formData.seatHoldExpiry}
                  className="cursor-not-allowed text-xs"
                />
              </InputGroup>
              <p className="text-xs text-muted-foreground">
                Auto-release unconfirmed seat reservations
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <InputGroup>
                <InputGroupAddon align="block-start">
                  <InputGroupText>Guide Ratio</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  type="number"
                  placeholder="e.g. 40"
                  value={formData.suggestedGuideRatio}
                  onChange={(e) =>
                    updateField(
                      "suggestedGuideRatio",
                      e.target.value ? parseInt(e.target.value) : "",
                    )
                  }
                />
              </InputGroup>
              <p className="text-xs text-muted-foreground">
                1 Mutawwif per {formData.suggestedGuideRatio} pilgrims
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default StepCommercialIdentity;
