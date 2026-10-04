"use client";

import { Sparkles } from "lucide-react";
import React from "react";

import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ToneBadge } from "@/components/ui/tone-badge";

interface AgentSettingsSheetProps {
  open: boolean;
  onClose: () => void;
  aiConfigured: boolean;
}

/** Read-only confidence-band reference. Never the AI's final authority — a
 *  staff member always makes the verification decision, regardless of these
 *  bands. Threshold editing lands once an agency-settings table exists. */
const AgentSettingsSheet = ({ open, onClose, aiConfigured }: AgentSettingsSheetProps) => {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="sm:max-w-md!">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="size-4" /> Copilot Settings
          </SheetTitle>
          <SheetDescription>
            The agent classifies, extracts and drafts follow-ups. A staff member always makes the
            final verification decision.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 px-1">
          <Card className="gap-2">
            <p className="text-xs font-medium text-foreground">Status</p>
            <ToneBadge tone={aiConfigured ? "success" : "neutral"} label={aiConfigured ? "Configured" : "Not configured"} />
            {!aiConfigured && (
              <p className="text-xs text-muted-foreground">
                Set <code>OPENROUTER_API_KEY</code> on the server to enable AI classification and extraction.
              </p>
            )}
          </Card>

          <Card className="gap-2">
            <p className="text-xs font-medium text-foreground">Confidence bands</p>
            <div className="flex flex-col gap-1.5 text-xs">
              <div className="flex justify-between"><span className="text-muted-foreground">High confidence</span><span>90–100%</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Needs staff review</span><span>70–89%</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Strong warning / likely rework</span><span>Below 70%</span></div>
            </div>
          </Card>

          <Card className="gap-2">
            <p className="text-xs font-medium text-foreground">Day-one extraction scope</p>
            <p className="text-xs text-muted-foreground">
              Passport bio page, passport photo, National ID, insurance and payment proof. Other
              document types are classified and quality-checked, without field extraction.
            </p>
          </Card>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default AgentSettingsSheet;
