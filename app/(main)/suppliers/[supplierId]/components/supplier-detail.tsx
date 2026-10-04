"use client";

import PageHeader from "@/components/page-header";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/animate/tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProgressBar, ToneBadge } from "@/components/ui/tone-badge";
import {
  Phone,
  MessageCircle,
  MoreVertical,
  Plus,
  Users,
  Check,
  List,
  DollarSign,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import React, { useState } from "react";

import type { StaffRole } from "@/lib/access/departure-groups-access";
import type { SupplierTabId } from "@/lib/access/suppliers-access";
import {
  RELIABILITY_LABELS,
  SUPPLIER_TYPE_LABELS,
} from "@/lib/data/suppliers-copy";
import { reliabilityTone } from "@/lib/data/suppliers";
import { formatMoney, whatsappLink } from "../../utils";
import type { GroupPickerOption } from "../../suppliers-store";
import type { SupplierCapabilities, SupplierProfile } from "../../types";

import OverviewTab from "./tabs/overview-tab";
import CommitmentsTab from "./tabs/commitments-tab";
import ServicesRatesTab from "./tabs/services-rates-tab";
import ContactsTab from "./tabs/contacts-tab";
import PaymentsTab from "./tabs/payments-tab";
import ActivityTab from "./tabs/activity-tab";
import CreateCommitmentSheet from "../../components/create-commitment-sheet";
import SetReliabilityDialog from "../../components/set-reliability-dialog";
import { KpiCard } from "@/components/data-table/kpi-card";

const TAB_LABELS: Record<SupplierTabId, string> = {
  overview: "Overview",
  commitments: "Commitments",
  services: "Services & Rates",
  contacts: "Contacts",
  payments: "Payments",
  activity: "Notes & Activity",
};

interface SupplierDetailViewProps {
  profile: SupplierProfile;
  nowIso: string;
  currentStaffName: string | null;
  role: StaffRole;
  can: SupplierCapabilities;
  groupOptions: GroupPickerOption[];
  visibleTabs: SupplierTabId[];
  initialTab: SupplierTabId;
}

const SupplierDetailView = ({
  profile,
  nowIso,
  can,
  groupOptions,
  visibleTabs,
  initialTab,
}: SupplierDetailViewProps) => {
  const { supplier } = profile;
  const [tab, setTab] = useState<SupplierTabId>(initialTab);
  const [commitmentSheetOpen, setCommitmentSheetOpen] = useState(false);
  const [reliabilityOpen, setReliabilityOpen] = useState(false);

  const primaryContact =
    profile.contacts.find((c) => c.is_primary) ?? profile.contacts[0] ?? null;

  const goToTab = (next: SupplierTabId) => {
    setTab(next);
    if (typeof window !== "undefined")
      window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const renderTab = () => {
    switch (tab) {
      case "overview":
        return (
          <OverviewTab
            profile={profile}
            nowIso={nowIso}
            can={can}
            onNavigate={goToTab}
          />
        );
      case "commitments":
        return <CommitmentsTab profile={profile} nowIso={nowIso} can={can} />;
      case "services":
        return <ServicesRatesTab profile={profile} can={can} />;
      case "contacts":
        return <ContactsTab profile={profile} can={can} />;
      case "payments":
        return <PaymentsTab profile={profile} nowIso={nowIso} />;
      case "activity":
        return <ActivityTab profile={profile} can={can} />;
      default:
        return null;
    }
  };

  const paymentDueEntries = Object.entries(profile.stats.paymentDueByCurrency);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={[
          { title: "Home", link: "/dashboard" },
          { title: "Operations", link: "/operations" },
          { title: "Suppliers", link: "/suppliers" },
          {
            title: supplier.name,
            link: `/suppliers/${supplier.id}`,
          },
        ]}
        title={supplier.name}
        subTitle={supplier.supplier_code}
        action={
          <div className="flex items-center gap-2">
            {primaryContact?.whatsapp_number && (
              <Button
                variant="outline_without_border"
                onClick={() =>
                  window.open(
                    whatsappLink(primaryContact.whatsapp_number!),
                    "_blank",
                  )
                }
              >
                <MessageCircle /> WhatsApp
              </Button>
            )}
            {primaryContact?.phone_number && (
              <Button
                variant="outline_without_border"
                onClick={() =>
                  window.open(`tel:${primaryContact.phone_number}`, "_blank")
                }
              >
                <Phone /> Call
              </Button>
            )}
            {can.createCommitment && (
              <Button
                variant="secondary"
                onClick={() => setCommitmentSheetOpen(true)}
              >
                <Plus /> Add Commitment
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline_without_border">
                    <MoreVertical />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                {can.setReliability && (
                  <DropdownMenuItem onClick={() => setReliabilityOpen(true)}>
                    Set Reliability
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <ToneBadge
          tone="brand"
          label={
            SUPPLIER_TYPE_LABELS[supplier.supplier_type] ??
            supplier.supplier_type
          }
        />
        <ToneBadge
          tone="neutral"
          label={
            [supplier.city, supplier.country].filter(Boolean).join(", ") ||
            "No location set"
          }
        />
        <ToneBadge
          tone={supplier.status === "ACTIVE" ? "success" : "neutral"}
          label={supplier.status === "ACTIVE" ? "Active" : "Inactive"}
        />
        <ToneBadge
          tone={reliabilityTone(supplier.reliability)}
          label={
            RELIABILITY_LABELS[supplier.reliability] ?? supplier.reliability
          }
        />
      </div>

      <Card className="gap-2 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col gap-1">
            {primaryContact ? (
              <>
                <span className="text-lg font-medium text-foreground">
                  {primaryContact.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {primaryContact.whatsapp_number
                    ? `WhatsApp: ${primaryContact.whatsapp_number}`
                    : "No WhatsApp on file"}
                </span>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">
                No contacts on file yet.
              </span>
            )}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard
          title={"Active Groups"}
          value={profile.stats.activeGroups.toString()}
          icon={<Users className="size-4 text-muted-foreground" />}
        />
        <KpiCard
          title={"Services Confirmed"}
          value={`${profile.stats.servicesConfirmed} / ${profile.stats.servicesTotal}`}
          icon={<Check className="size-4 text-muted-foreground" />}
          desc={
            <ProgressBar
              percent={
                profile.stats.servicesTotal === 0
                  ? 0
                  : Math.round(
                      (profile.stats.servicesConfirmed /
                        profile.stats.servicesTotal) *
                        100,
                    )
              }
            />
          }
        />
        <KpiCard
          title={"Pending Confirmations"}
          value={profile.stats.pendingConfirmations.toString()}
          icon={<List className="size-4 text-muted-foreground" />}
        />

        {can.viewCosts && (
          <KpiCard
            title={"Payment Due"}
            value={
              paymentDueEntries.length === 0
                ? "Nothing due"
                : paymentDueEntries
                    .map(([currency, amount]) => formatMoney(amount, currency))
                    .join(" · ")
            }
            icon={<DollarSign className="size-4 text-muted-foreground" />}
          />
        )}
      </div>

      <div>
        <Tabs
          value={tab}
          onValueChange={(next) => goToTab(next as SupplierTabId)}
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

      <CreateCommitmentSheet
        supplier={{
          id: supplier.id,
          name: supplier.name,
          currency: supplier.currency,
        }}
        groupOptions={groupOptions}
        canViewCosts={can.viewCosts}
        open={commitmentSheetOpen}
        onClose={() => setCommitmentSheetOpen(false)}
      />
      <SetReliabilityDialog
        supplier={{
          id: supplier.id,
          name: supplier.name,
          reliability: supplier.reliability,
        }}
        open={reliabilityOpen}
        onClose={() => setReliabilityOpen(false)}
      />
    </div>
  );
};

export default SupplierDetailView;
