"use client";

import type { ComponentProps } from "react";
/**
 * SaaS-style settings dialog — sidebar + content inside a `Dialog`, same
 * large-dialog shell as `CreatePackageDialog` / `AddNewLead` (see
 * `app/(main)/packages/components/create-package-dialog.tsx`). Plain local
 * `open` state, exactly like those two — no route, no navigation, no
 * intercepting-route round trip per click.
 *
 * Each section's data is fetched once, lazily, via a Server Action in
 * `../dialog-actions.ts` the first time its tab is opened, then cached in
 * state for the life of the dialog — switching between already-visited
 * tabs is instant. The actual section UI (forms, tables, cards) is the same
 * client components the full-page settings routes already use; only the
 * fetch is duplicated (mirroring each page.tsx's own capability check + query).
 */

import {
  Building2,
  Mail,
  Database,
  DollarSign,
  MapPin,
  MessageCircle,
  MessageSquareText,
  Package,
  Palette,
  Plug,
  Receipt,
  Settings2,
  ShieldCheck,
  TriangleAlert,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionDenied } from "@/components/ui/tone-badge";
import { cn } from "@/lib/utils";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import {
  SETTINGS_SECTION_LABELS,
  visibleSettingsSections,
  type SettingsSectionId,
} from "@/lib/access/settings-access";

import { SectionShell } from "./section-shell";
import { OrganisationForm } from "../organisation/organisation-form";
import { BranchList } from "../branches/branch-list";
import { BranchRulesCard } from "../branches/branch-rules-card";
import { BrandingForm } from "../branding/branding-form";
import { OperationalDefaultsForm } from "../operations/operational-defaults-form";
import ServiceAddonsManager from "../service-addons/service-addons-manager";
import { TemplateList } from "../communications/template-list";
import { FinanceDefaultsForm } from "../finance/finance-defaults-form";
import { IntegrationCard } from "../integrations/integration-card";
import { MetaPageChannelCard } from "../integrations/meta-page-channel-card";
import { WhatsAppConnectCard } from "../integrations/whatsapp-connect-card";
import { TemplateManager } from "../whatsapp-templates/template-manager";
import { BillingDashboard } from "../whatsapp-billing/billing-dashboard";
import { SecurityForm } from "../security/security-form";
import { SessionsCard } from "../security/sessions-card";
import { AuditLogTable } from "../data/audit-log-table";
import { ExportCard } from "../data/export-card";
import { ImportCard } from "../data/import-card";
import { RetentionCard } from "../data/retention-card";
import { DangerActions } from "../danger/danger-actions";
import { EmailSettings } from "../email/email-settings";
import { getEmailSectionData } from "../email/actions";

import {
  getOrganisationSectionData,
  getBranchesSectionData,
  getBrandingSectionData,
  getOperationsSectionData,
  getServiceAddonsSectionData,
  getCommunicationsSectionData,
  getFinanceSectionData,
  getIntegrationsSectionData,
  getWhatsAppTemplatesSectionData,
  getWhatsAppBillingSectionData,
  getSecuritySectionData,
  getDataSectionData,
  getDangerSectionData,
} from "../dialog-actions";

const SECTION_ICONS: Record<SettingsSectionId, LucideIcon> = {
  organisation: Building2,
  branches: MapPin,
  branding: Palette,
  operations: Settings2,
  "service-addons": Package,
  communications: MessageSquareText,
  finance: DollarSign,
  integrations: Plug,
  email: Mail,
  "whatsapp-templates": MessageCircle,
  "whatsapp-billing": Receipt,
  security: ShieldCheck,
  data: Database,
  danger: TriangleAlert,
};

const SECTION_LOADERS: Record<
  SettingsSectionId,
  () => Promise<{ ok: boolean } & Record<string, unknown>>
> = {
  organisation: getOrganisationSectionData,
  branches: getBranchesSectionData,
  branding: getBrandingSectionData,
  operations: getOperationsSectionData,
  "service-addons": getServiceAddonsSectionData,
  communications: getCommunicationsSectionData,
  finance: getFinanceSectionData,
  integrations: getIntegrationsSectionData,
  email: getEmailSectionData,
  "whatsapp-templates": getWhatsAppTemplatesSectionData,
  "whatsapp-billing": getWhatsAppBillingSectionData,
  security: getSecuritySectionData,
  data: getDataSectionData,
  danger: getDangerSectionData,
};

/** What a Messenger or Instagram card needs beyond its channel and edit right — loaded by getIntegrationsSectionData. */
type PageChannelProps = Omit<ComponentProps<typeof MetaPageChannelCard>, "channel" | "canEdit">;

type SectionEntry =
  | { status: "denied" }
  | { status: "ready"; data: Record<string, unknown> };

function SectionSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-6 w-64" />
      <Skeleton className="h-4 w-96" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}

function renderSection(
  section: SettingsSectionId,
  data: Record<string, unknown>,
) {
  switch (section) {
    case "email":
      return <EmailSettings initial={data as never} />;
    case "organisation":
      return (
        <OrganisationForm
          settings={data.settings as never}
          canEdit={data.canEdit as boolean}
        />
      );
    case "branches":
      return (
        <div className="flex-1 min-h-0 overflow-y-auto custom-scroll   flex flex-col gap-8">
          <BranchList
            branches={data.branches as never}
            managers={data.managers as never}
            canEdit={data.canEdit as boolean}
          />
          <BranchRulesCard
            rules={data.branchRules as never}
            canEdit={data.canEdit as boolean}
          />
        </div>
      );
    case "branding":
      return (
        <BrandingForm
          settings={data.settings as never}
          logoUrl={data.logoUrl as string | null}
          canEdit={data.canEdit as boolean}
        />
      );
    case "operations":
      return (
        <OperationalDefaultsForm
          settings={data.settings as never}
          canEdit={data.canEdit as boolean}
        />
      );
    case "service-addons":
      return (
        <ServiceAddonsManager
          addons={data.addons as never}
          canEdit={data.canEdit as boolean}
        />
      );
    case "communications":
      return (
        <TemplateList
          templates={data.templates as never}
          canEdit={data.canEdit as boolean}
          scopedRole={data.scopedRole as never}
        />
      );
    case "finance":
      return (
        <FinanceDefaultsForm
          settings={data.settings as never}
          canEdit={data.canEdit as boolean}
        />
      );
    case "integrations": {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const whatsapp = data.whatsapp as any;
      const otherIntegrations = data.otherIntegrations as { id: string }[];
      return (
        <SectionShell
          title="Integrations"
          description="Only the integrations the agency can actually use today. Never shows a full API key after saving."
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <WhatsAppConnectCard {...whatsapp} />
            {/* Each Meta channel has its own card and its own sign-in, exactly as on the Integrations page. */}
            <MetaPageChannelCard channel="MESSENGER" {...(data.messenger as PageChannelProps)} canEdit={data.canEdit as boolean} />
            <MetaPageChannelCard channel="INSTAGRAM" {...(data.instagram as PageChannelProps)} canEdit={data.canEdit as boolean} />
            {otherIntegrations.map((integration) => (
              <IntegrationCard
                key={integration.id}
                integration={integration as never}
                canEdit={data.canEdit as boolean}
              />
            ))}
          </div>
        </SectionShell>
      );
    }
    case "whatsapp-templates":
      return (
        <SectionShell
          title="WhatsApp Templates"
          description="Message templates approved by Meta for use outside the 24-hour conversation window — marketing, order updates, and authentication codes."
        >
          <TemplateManager
            templates={data.templates as never}
            canEdit={data.canEdit as boolean}
            connected={data.connected as boolean}
          />
        </SectionShell>
      );
    case "whatsapp-billing":
      return (
        <SectionShell
          title="WhatsApp Billing"
          description="Meta bills your agency directly for WhatsApp usage — this is your spend, as Meta reports it, attributed to the leads and conversations that caused it."
        >
          <BillingDashboard
            summary={data.summary as never}
            budget={data.budget as never}
            tiers={data.tiers as never}
            canEditBudget={data.canEditBudget as boolean}
            hasData={data.hasData as boolean}
          />
        </SectionShell>
      );
    case "security":
      return (
        <div className="flex-1 min-h-0 overflow-y-auto custom-scroll px-4 sm:px-6 py-5 flex flex-col gap-8">
          <SecurityForm
            settings={data.settings as never}
            canEdit={data.canEdit as boolean}
          />
          <SessionsCard
            staff={data.staff as never}
            currentStaffId={data.currentStaffId as string | null}
            canManage={data.canEdit as boolean}
          />
        </div>
      );
    case "data":
      return (
        <SectionShell
          title="Data & Audit"
          description="Accountability and safe data handling — who changed what, and how long records are kept."
        >
          <AuditLogTable rows={data.auditRows as never} />
          <ExportCard auditLogRows={data.auditRows as never} />
          <ImportCard />
          {(data.canEditData as boolean) && (
            <RetentionCard
              settings={data.settings as never}
              canEdit={data.canEditData as boolean}
            />
          )}
        </SectionShell>
      );
    case "danger":
      return (
        <SectionShell
          title="Danger Zone"
          description="Deliberate, irreversible-feeling actions. Every one of these requires typing a confirmation phrase — there is no plain OK button here."
        >
          <DangerActions
            branches={data.archivableBranches as never}
            portalActive={data.portalActive as boolean}
          />
        </SectionShell>
      );
  }
}

export function SettingsDialog({
  open,
  onOpenChange,
  role,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: StaffRole;
}) {
  const sections = visibleSettingsSections(role);
  const [activeSection, setActiveSection] = useState<SettingsSectionId | null>(
    sections[0] ?? null,
  );
  const [entries, setEntries] = useState<
    Partial<Record<SettingsSectionId, SectionEntry>>
  >({});
  // Guards against double-fetching a section whose result hasn't landed in
  // `entries` yet — a ref rather than state, so touching it never itself
  // triggers a render (unlike calling setState synchronously inside the
  // effect body below, which React flags as cascading-render-prone).
  const inFlight = useRef<Set<SettingsSectionId>>(new Set());

  useEffect(() => {
    if (!open || !activeSection) return;
    if (entries[activeSection] || inFlight.current.has(activeSection)) return;

    inFlight.current.add(activeSection);
    SECTION_LOADERS[activeSection]().then((result) => {
      inFlight.current.delete(activeSection);
      setEntries((prev) => ({
        ...prev,
        [activeSection]: result.ok
          ? { status: "ready", data: result }
          : { status: "denied" },
      }));
    });
  }, [open, activeSection, entries]);

  if (!activeSection) return null;

  const entry = entries[activeSection];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="p-0! gap-0! w-full max-w-full! h-dvh flex flex-col overflow-hidden md:max-w-3xl! md:h-[95vh] lg:max-w-7xl!"
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Configure your agency, operational rules, integrations, and security.
        </DialogDescription>

        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-3 right-3 z-10"
          onClick={() => onOpenChange(false)}
        >
          <XIcon />
          <span className="sr-only">Close</span>
        </Button>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          <aside className="hidden bg-card md:flex w-44 lg:w-56 shrink-0 flex-col gap-0.5 border-r border-border/50 px-2 lg:px-3 py-4 overflow-y-auto custom-scroll">
            <div className="mb-4 px-1">
              <h2 className="font-heading text-base lg:text-xl font-semibold leading-tight tracking-tight">
                Settings
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground leading-snug">
                Agency, operations & security
              </p>
            </div>

            <nav
              aria-label="Settings sections"
              className="flex flex-col gap-0.5"
            >
              {sections.map((id) => {
                const Icon = SECTION_ICONS[id];
                const isActive = id === activeSection;
                const isDanger = id === "danger";

                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveSection(id)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm transition-colors text-left",
                      isActive
                        ? isDanger
                          ? "bg-destructive/15 text-destructive"
                          : "bg-primary/10 text-primary font-medium"
                        : isDanger
                          ? "text-destructive/80 hover:bg-destructive/10"
                          : "text-muted-foreground hover:bg-primary/10 hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate">
                      {SETTINGS_SECTION_LABELS[id]}
                    </span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <div className="flex flex-1 min-w-0 flex-col overflow-hidden">
            <div className="md:hidden flex items-center justify-between border-b border-border/50 bg-muted/30 px-4 py-3">
              <div>
                <h2 className="font-heading text-base font-semibold leading-tight">
                  Settings
                </h2>
                <p className="text-[11px] text-muted-foreground">
                  {SETTINGS_SECTION_LABELS[activeSection]}
                </p>
              </div>
            </div>

            <div className="md:hidden flex items-center gap-1 overflow-x-auto px-3 py-2 border-b border-border/50">
              {sections.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveSection(id)}
                  className={cn(
                    "shrink-0 rounded-full px-3 py-1 text-xs whitespace-nowrap transition-colors",
                    id === activeSection
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-primary/10",
                  )}
                >
                  {SETTINGS_SECTION_LABELS[id]}
                </button>
              ))}
            </div>

            <div className="flex-1  min-h-0 flex flex-col overflow-hidden">
              {!entry ? (
                <div className="flex-1 overflow-y-auto custom-scroll px-4 sm:px-6 py-5">
                  <SectionSkeleton />
                </div>
              ) : entry.status === "denied" ? (
                <div className="flex-1 overflow-y-auto custom-scroll px-4 sm:px-6 py-5">
                  <PermissionDenied
                    what={SETTINGS_SECTION_LABELS[activeSection]}
                  />
                </div>
              ) : (
                renderSection(activeSection, entry.data)
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
