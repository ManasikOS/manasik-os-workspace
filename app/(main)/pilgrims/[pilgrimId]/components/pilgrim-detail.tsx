"use client";

import PageHeader from "@/components/page-header";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/animate/tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProgressBar, ToneBadge } from "@/components/ui/tone-badge";
import { toast } from "@/components/ui/toast";
import { percentTone } from "@/lib/ui/tone";
import type { PilgrimCapabilities } from "@/lib/access/pilgrims-access";
import type { PilgrimTabId } from "@/lib/access/pilgrims-access";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import type { DepartureGroupPilgrimDocumentRow } from "@/lib/types/departure-groups";
import {
  CalendarDays,
  MessageCircle,
  MoreVertical,
  StickyNote,
} from "lucide-react";
import React, { useState } from "react";

import type { PilgrimProfile } from "../../types";
import { addPilgrimNoteAction } from "../../actions";
import {
  JOURNEY_STATUS_LABELS,
  JOURNEY_STATUS_TONES,
  JOURNEY_TYPE_LABELS,
  PAYMENT_STATUS_TONES,
  VISA_STATUS_LABELS,
  VISA_STATUS_TONES,
  daysRemainingLabel,
  formatExactLKR,
  whatsappLink,
} from "../../utils";
import OverviewTab from "./tabs/overview-tab";
import PersonalTab from "./tabs/personal-tab";
import DocumentsTab from "./tabs/documents-tab";
import VisaTab from "./tabs/visa-tab";
import PaymentsTab from "./tabs/payments-tab";
import TravelTab from "./tabs/travel-tab";
import SupportTab from "./tabs/support-tab";
import ActivityTab from "./tabs/activity-tab";

const TAB_LABELS: Record<PilgrimTabId, string> = {
  overview: "Overview",
  personal: "Personal & Contact",
  documents: "Documents",
  visa: "Visa",
  payments: "Payments",
  travel: "Travel & Rooming",
  support: "Support & Medical",
  activity: "Activity",
};

interface PilgrimDetailViewProps {
  profile: PilgrimProfile;
  documents: DepartureGroupPilgrimDocumentRow[];
  role: StaffRole;
  can: PilgrimCapabilities;
  visibleTabs: PilgrimTabId[];
  initialTab: PilgrimTabId;
}

const PilgrimDetailView = ({
  profile,
  documents,
  can,
  visibleTabs,
  initialTab,
}: PilgrimDetailViewProps) => {
  const { person, activeJourney } = profile;
  const [tab, setTab] = useState<PilgrimTabId>(initialTab);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const goToTab = (next: PilgrimTabId) => {
    setTab(next);
    if (typeof window !== "undefined")
      window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveNote = async () => {
    if (!note.trim()) return;
    setSavingNote(true);
    const result = await addPilgrimNoteAction({ pilgrimId: person.id, note });
    setSavingNote(false);
    if (!result.ok) {
      toast.add({ title: "Could not save note", description: result.error });
      return;
    }
    toast.add({ title: "Note added" });
    setNote("");
    setNoteOpen(false);
  };

  const renderTab = () => {
    switch (tab) {
      case "overview":
        return <OverviewTab profile={profile} onNavigate={goToTab} />;
      case "personal":
        return <PersonalTab person={person} can={can} />;
      case "documents":
        return (
          <DocumentsTab profile={profile} documents={documents} can={can} />
        );
      case "visa":
        return <VisaTab profile={profile} can={can} />;
      case "payments":
        return <PaymentsTab profile={profile} can={can} />;
      case "travel":
        return <TravelTab profile={profile} />;
      case "support":
        return <SupportTab profile={profile} can={can} />;
      case "activity":
        return <ActivityTab profile={profile} />;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={[
          { title: "Home", link: "/dashboard" },
          { title: "Pilgrims", link: "/pilgrims" },
          { title: person.full_name, link: `/pilgrims/${person.id}` },
        ]}
        title={person.full_name}
        subTitle={person.reference}
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="outline_without_border"
              onClick={() =>
                window.open(whatsappLink(person.whatsapp_number), "_blank")
              }
            >
              <MessageCircle /> Send WhatsApp
            </Button>
            <Button
              variant="outline_without_border"
              onClick={() => setNoteOpen((v) => !v)}
            >
              <StickyNote /> Add Note
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline_without_border">
                    <MoreVertical />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled>
                  Move to another group (soon)
                </DropdownMenuItem>
                <DropdownMenuItem disabled>
                  Replace pilgrim (soon)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {noteOpen && (
        <Card className="gap-3">
          <textarea
            className="w-full min-h-20 rounded-md border border-border bg-transparent p-2.5 text-sm outline-none focus:ring-1 focus:ring-primary"
            placeholder="Add an internal note…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setNoteOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={saveNote}
              disabled={savingNote || !note.trim()}
            >
              Save Note
            </Button>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <ToneBadge
          tone="brand"
          label={
            activeJourney
              ? (JOURNEY_TYPE_LABELS[activeJourney.journeyType] ??
                activeJourney.journeyType)
              : "—"
          }
        />
        {activeJourney && (
          <ToneBadge
            tone={JOURNEY_STATUS_TONES[activeJourney.journeyStatus]}
            label={JOURNEY_STATUS_LABELS[activeJourney.journeyStatus]}
          />
        )}
        {activeJourney && (
          <ToneBadge
            tone={VISA_STATUS_TONES[activeJourney.visaStatus] ?? "neutral"}
            label={
              VISA_STATUS_LABELS[activeJourney.visaStatus] ??
              activeJourney.visaStatus
            }
          />
        )}
        {activeJourney && activeJourney.outstandingBalance > 0 && (
          <ToneBadge
            tone={
              PAYMENT_STATUS_TONES[activeJourney.paymentStatus] ?? "warning"
            }
            label="Payment Attention"
          />
        )}
      </div>

      {activeJourney ? (
        <Card className="gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-col gap-1">
              <span className="text-base font-semibold text-foreground">
                {activeJourney.groupName}
              </span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarDays className="size-3.5" />{" "}
                {activeJourney.departureDate} ·{" "}
                {daysRemainingLabel(activeJourney.daysToDeparture)}
              </span>
            </div>
            <div className="flex flex-col gap-1 text-right">
              <span className="text-sm text-foreground">
                Booking: {activeJourney.bookingReference}
              </span>
              <span className="text-xs text-muted-foreground">
                Primary Contact: {activeJourney.primaryContactName}
              </span>
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-muted-foreground">
            This person is not yet enrolled on a departure group.
          </p>
        </Card>
      )}

      {activeJourney && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="gap-1">
            <span className="text-xs text-muted-foreground">Documents</span>
            <span className="text-lg font-semibold text-foreground">
              {activeJourney.documentsCompleted} /{" "}
              {activeJourney.documentsRequired}
            </span>
            <ProgressBar
              percent={activeJourney.documentPercent}
              tone={percentTone(activeJourney.documentPercent)}
            />
          </Card>
          <Card className="gap-1">
            <span className="text-xs text-muted-foreground">Visa</span>
            <ToneBadge
              tone={VISA_STATUS_TONES[activeJourney.visaStatus] ?? "neutral"}
              label={
                VISA_STATUS_LABELS[activeJourney.visaStatus] ??
                activeJourney.visaStatus
              }
              className="w-fit"
            />
          </Card>
          <Card className="gap-1">
            <span className="text-xs text-muted-foreground">Payments</span>
            <span className="text-sm font-semibold text-foreground">
              {activeJourney.outstandingBalance > 0
                ? `${formatExactLKR(activeJourney.outstandingBalance)} due`
                : "Paid in full"}
            </span>
          </Card>
          <Card className="gap-1">
            <span className="text-xs text-muted-foreground">Travel Setup</span>
            <span className="text-sm text-foreground">
              {activeJourney.roomAssignmentStatus === "UNASSIGNED"
                ? "Room pending"
                : "Room assigned"}{" "}
              ·{" "}
              {activeJourney.flightStatus === "TICKETED"
                ? "Ticketed"
                : "Flight pending"}
            </span>
          </Card>
        </div>
      )}

      <div>
        <Tabs
          value={tab}
          onValueChange={(next) => goToTab(next as PilgrimTabId)}
        >
          <TabsList className="flex-wrap h-auto">
            {visibleTabs.map((id) => (
              <TabsTrigger key={id} value={id}>
                {TAB_LABELS[id]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="min-h-100 mt-5">{renderTab()}</div>
      </div>
    </div>
  );
};

export default PilgrimDetailView;
