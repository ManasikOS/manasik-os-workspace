"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  Package,
  Sparkles,
  Sliders,
  Users,
  FileText,
  CheckCircle2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import InputFormHeader from "@/components/ui/input-form-header";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  PackageFormData,
  JourneyType,
  PackageCategory,
  PackageVisibility,
  SeatHoldExpiry,
  DESCRIPTION_TEMPLATE,
} from "../types";
import { ChevronDown } from "lucide-react";
import { ButtonGroup } from "@/components/ui/button-group";
import { checkPackageCodeAction, type PackageCodeCheckResult } from "../../actions";

interface StepCommercialIdentityProps {
  formData: PackageFormData;
  setFormData: React.Dispatch<React.SetStateAction<PackageFormData>>;
  /** Row id once the draft exists, so the package's own code is not reported as already used. */
  currentPackageId?: string | null;
}

const BRANCHES = ["All Branches", "Colombo", "Kandy", "Galle", "Trincomalee"];
const CATEGORIES: PackageCategory[] = [
  "Economy",
  "Standard",
  "Premium",
  "VIP",
  "Custom",
];
export const StepCommercialIdentity: React.FC<StepCommercialIdentityProps> = ({
  formData,
  setFormData,
  currentPackageId = null,
}) => {
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  // Kept with the code it was checked for, so a stale answer is never shown for a newer code.
  const [packageCodeCheck, setPackageCodeCheck] = useState<{
    code: string;
    result: PackageCodeCheckResult;
  } | null>(null);
  const typedPackageCode = formData.internalCode.trim();
  const [activeTab, setActiveTab] = useState<
    "Umrah" | "Hajj" | "Early Registration"
  >("Umrah");
  const [pendingTemplateContent, setPendingTemplateContent] = useState<
    string | null
  >(null);
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false);
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const aiTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (aiTimeoutRef.current) clearTimeout(aiTimeoutRef.current);
    };
  }, []);

  // Asks the server whether the typed code is free, half a second after typing stops.
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
    packageCodeCheck && packageCodeCheck.code === typedPackageCode ? packageCodeCheck.result : null;
  const packageCodeSuggestion =
    shownPackageCodeCheck && shownPackageCodeCheck.ok && !shownPackageCodeCheck.available
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

  const handleSelectTemplate = (content: string) => {
    if (formData.description.trim().length > 0) {
      setPendingTemplateContent(content);
      setConfirmReplaceOpen(true);
    } else {
      updateField("description", content);
      setTemplateDialogOpen(false);
    }
  };

  const handleApplyTemplateChoice = (action: "replace" | "append") => {
    if (!pendingTemplateContent) return;
    if (action === "replace") {
      updateField("description", pendingTemplateContent);
    } else {
      updateField(
        "description",
        `${formData.description}\n\n${pendingTemplateContent}`,
      );
    }
    setPendingTemplateContent(null);
    setConfirmReplaceOpen(false);
    setTemplateDialogOpen(false);
  };

  const handleGenerateAi = () => {
    setIsAiGenerating(true);
    aiTimeoutRef.current = setTimeout(() => {
      // Flight routing (and so "return air tickets from Colombo" as a
      // specific promise) moved to Departure Group creation — a template
      // has no fixed origin any more, so generated copy should not name
      // one. See docs/modules/packages-production-readiness-plan.md, finding E8.
      const generated = `A premium ${formData.journeyType} package designed for pilgrims seeking complete comfort and spiritual peace. Features ${formData.package_category} standard hotel accommodation close to the Harams, luxury air-conditioned bus transfers, full-board catering, and guidance by experienced Mutawwifs.`;
      updateField("description", generated);
      setIsAiGenerating(false);
    }, 600);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col md:flex-row gap-5">
        <InputGroup className="flex-2">
          <InputGroupAddon align="block-start">
            <InputGroupText>
              Package Name <span className="text-destructive">*</span>
            </InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            placeholder="e.g. 14-Day Standard Umrah Package 2026"
            value={formData.title}
            onChange={(e) => updateField("title", e.target.value)}
          />
        </InputGroup>

        <div className="flex flex-1 flex-col gap-1.5">
          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>
                Package Code <span className="text-destructive">*</span>
              </InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              placeholder="e.g. RF-PKG-2026-UM01"
              value={formData.internalCode}
              onChange={(e) => updateField("internalCode", e.target.value)}
              aria-invalid={packageCodeSuggestion ? true : undefined}
            />
          </InputGroup>
          {packageCodeSuggestion ? (
            <p className="text-xs text-destructive">
              Another package already uses this code. Each package needs its own code.{" "}
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto cursor-pointer p-0 text-xs"
                onClick={() => updateField("internalCode", packageCodeSuggestion)}
              >
                Use {packageCodeSuggestion}
              </Button>
            </p>
          ) : null}
        </div>
      </div>

      <InputGroup className="gap-0">
        <InputGroupAddon align={"block-start"}>
          <InputGroupText> Short Package Overview</InputGroupText>
        </InputGroupAddon>
        <InputGroupTextarea
          rows={4}
          placeholder="Provide a clear commercial summary detailing what this package offers..."
          value={formData.description}
          onChange={(e) => updateField("description", e.target.value)}
          className="text-sm"
        />
        {/* <InputGroupAddon align={"block-end"} className="justify-end">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => setTemplateDialogOpen(true)}
              className=" cursor-pointer text-foreground"
            >
              <FileText className="size-3.5" />
              Use Template
            </Button>

            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={handleGenerateAi}
              disabled={isAiGenerating}
              className="cursor-pointer text-primary"
            >
              <Sparkles className="size-3.5 text-primary" />
              {isAiGenerating ? "Generating..." : "Generate with AI"}
            </Button>
          </div>
        </InputGroupAddon> */}
      </InputGroup>

      <div className="grid grid-cols-3 gap-5">
        <DropdownMenu>
          <DropdownMenuTrigger>
            <InputGroup>
              <InputGroupAddon align={"block-start"}>
                <InputGroupText>Journey Type</InputGroupText>
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
            {(["Umrah", "Hajj", "Early Registration"] as JourneyType[]).map(
              (type) => (
                <DropdownMenuItem
                  key={type}
                  onClick={() => updateField("journeyType", type)}
                >
                  {type}
                </DropdownMenuItem>
              ),
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <InputGroup>
          <InputGroupAddon align="block-start">
            <InputGroupText>Days *</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            type="number"
            value={formData.days}
            onChange={(e) => {
              const d = parseInt(e.target.value) || 1;
              const n = Math.max(0, d - 1);
              updateField("days", d);
              updateField("nights", n);
              updateField("duration", `${d} Days / ${n} Nights`);
            }}
          />
        </InputGroup>
        <InputGroup>
          <InputGroupAddon align="block-start">
            <InputGroupText>Nights *</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            type="number"
            value={formData.nights}
            onChange={(e) => {
              const n = parseInt(e.target.value) || 0;
              updateField("nights", n);
              updateField("duration", `${formData.days} Days / ${n} Nights`);
            }}
          />
        </InputGroup>
      </div>

      {/* RIGHT CARD: Package Classification */}
      <div className=" gap-5  flex flex-col">
        {/* Days / Nights — a template's length is genuinely reusable
                  across every departure, unlike its price or its season. */}

        {/* Package Category */}
        <div className="flex gap-5">
          <DropdownMenu>
            <DropdownMenuTrigger className="w-full flex-3 text-start cursor-pointer">
              <InputGroup>
                <InputGroupAddon align={"block-start"}>
                  <InputGroupText> Package Category *</InputGroupText>
                </InputGroupAddon>
                <ButtonGroup className="w-full items-center">
                  <InputGroupInput
                    readOnly
                    value={formData.package_category}
                    placeholder="Select Category"
                    className="cursor-pointer"
                  />
                </ButtonGroup>{" "}
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
          {/*
            Status is deliberately NOT editable here. It used to be a
            dropdown that wrote straight to the row through draft autosave,
            which let anyone who can edit a package publish, close sales on,
            or archive it — bypassing the publish completeness check and the
            `publishPackage`/`archiveOrRestorePackage` capabilities entirely.
            Lifecycle changes now only ever happen through the dedicated
            actions (Publish / Unpublish / Archive / Restore) on the package
            list and detail screens, which re-check capability and re-run
            validation server-side. See
            docs/modules/packages-production-readiness-plan.md, finding A1.
          */}
          <InputGroup className="flex-1">
            <InputGroupAddon align={"block-start"}>
              <InputGroupText>Status</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              readOnly
              disabled
              value={
                formData.status === "Draft"
                  ? "Draft (new packages start here)"
                  : formData.status
              }
              className="text-xs font-medium cursor-not-allowed opacity-80"
            />
          </InputGroup>
        </div>
        <p className="text-[10px] text-muted-foreground -mt-3">
          Status changes (Publish, Close Sales, Archive) happen from the
          package list or detail page, not here.
        </p>

        {/* Visibility & Status */}

        {/* Featured Checkbox */}
      </div>

      {/* BOTTOM CARD: Commercial Capacity */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="">
          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>Default Group Capacity *</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              type="number"
              placeholder="e.g. 40"
              value={formData.defaultCapacity}
              onChange={(e) => {
                const val = e.target.value ? parseInt(e.target.value) : "";
                updateField("defaultCapacity", val);
                updateField("defaultGroupCapacity", val);
                updateField("maxPilgrims", val);
              }}
            />
          </InputGroup>
          <p className="text-[10px] text-muted-foreground">
            Default target pilgrims per departure group
          </p>
        </div>

        <div className="space-y-1.5">
          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>Min Viable Group</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              type="number"
              placeholder="e.g. 15"
              value={formData.minGroupSize}
              onChange={(e) =>
                updateField(
                  "minGroupSize",
                  e.target.value ? parseInt(e.target.value) : "",
                )
              }
            />
          </InputGroup>
          <p className="text-[10px] text-muted-foreground">
            Min bookings required to operate group
          </p>
        </div>

        <div className="space-y-1.5">
          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>Seat Hold Expiry</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              readOnly
              value={formData.seatHoldExpiry}
              className="cursor-pointer text-xs"
            />
          </InputGroup>
          <p className="text-[10px] text-muted-foreground">
            Auto-release unconfirmed seat reservations
          </p>
        </div>

        <div className="space-y-1.5">
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
          <p className="text-[10px] text-muted-foreground">
            1 Mutawwif per {formData.suggestedGuideRatio} pilgrims
          </p>
        </div>
      </div>

      {/* TEMPLATE CHOOSER DIALOG */}
      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Choose Overview Template</DialogTitle>
            <DialogDescription>
              Select a pre-configured template to insert editable copy into the
              package overview.
            </DialogDescription>
          </DialogHeader>

          {/* Tabs */}
          <div className="grid grid-cols-3 gap-2 bg-muted/60 p-1 rounded-lg text-xs font-medium">
            {(["Umrah", "Hajj", "Early Registration"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`py-1.5 rounded-md transition cursor-pointer ${
                  activeTab === tab
                    ? "bg-primary text-primary-foreground font-bold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Template List */}
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {DESCRIPTION_TEMPLATE.filter((t) => t.category === activeTab).map(
              (tpl, i) => (
                <div
                  key={i}
                  onClick={() => handleSelectTemplate(tpl.content)}
                  className="p-3 border rounded-lg hover:border-primary/60 hover:bg-primary/5 cursor-pointer transition flex flex-col gap-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-foreground">
                      {tpl.template}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {tpl.best}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {tpl.content}
                  </p>
                </div>
              ),
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* CONFIRM REPLACE DIALOG */}
      <Dialog open={confirmReplaceOpen} onOpenChange={setConfirmReplaceOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Replace existing text?</DialogTitle>
            <DialogDescription>
              You already have content in your package overview. Would you like
              to replace it or append the template copy?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmReplaceOpen(false)}
            >
              Cancel
            </Button>

            <Button
              variant="outline"
              onClick={() => handleApplyTemplateChoice("append")}
            >
              Append Text
            </Button>
            <Button
              variant="default"
              onClick={() => handleApplyTemplateChoice("replace")}
            >
              Replace Entire Text
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default StepCommercialIdentity;
