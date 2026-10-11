"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
/**
 * SaaS-style settings dialog — sidebar + content inside a `Dialog`, same
 * large-dialog shell as `AddNewLead`. Plain local
 * `open` state, exactly like it — no route, no navigation, no
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PermissionDenied } from "@/components/ui/tone-badge";
import { cn } from "@/lib/utils";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import {
  SETTINGS_SECTION_LABELS,
  visibleSettingsSections,
  type SettingsSectionId,
} from "@/lib/access/settings-access";

import { SectionShell } from "./section-shell";
import { getEmailSectionData } from "../email/actions";
import type { MetaPageChannelCardProps } from "../integrations/meta-page-channel-card";
import type { WhatsAppConnectCardProps } from "../integrations/whatsapp-connect-card";

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

const SECTION_DESCRIPTIONS: Record<SettingsSectionId, string> = {
  organisation: "Agency identity, locale and contact details used across customer-facing documents.",
  branches: "Office locations, branch ownership and cross-branch operating rules.",
  branding: "Brand assets and the information pilgrims can see in their portal.",
  operations: "Default rules for groups, documents, readiness and inbox handling.",
  "service-addons": "Optional services that can be added to bookings and packages.",
  communications: "Reusable customer messages for routine booking and travel updates.",
  finance: "Default currency, payment terms, invoice details and receiving accounts.",
  integrations: "Connected channels and services available to this agency.",
  email: "Outgoing and incoming email delivery, templates and connection checks.",
  "whatsapp-templates": "Meta-approved messages used outside the customer service window.",
  "whatsapp-billing": "WhatsApp usage, attributed costs, budgets and alerts.",
  security: "Account protection, access defaults and active staff sessions.",
  data: "Audit history, imports, exports and record retention.",
  danger: "High-impact agency actions that always require explicit confirmation.",
};

type SettingsPageChannelProps = Omit<MetaPageChannelCardProps, "channel" | "canEdit">;

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

const OrganisationForm = lazy(() =>
  import("../organisation/organisation-form").then((module) => ({ default: module.OrganisationForm })),
);
const BranchList = lazy(() =>
  import("../branches/branch-list").then((module) => ({ default: module.BranchList })),
);
const BranchRulesCard = lazy(() =>
  import("../branches/branch-rules-card").then((module) => ({ default: module.BranchRulesCard })),
);
const BrandingForm = lazy(() =>
  import("../branding/branding-form").then((module) => ({ default: module.BrandingForm })),
);
const OperationalDefaultsForm = lazy(() =>
  import("../operations/operational-defaults-form").then((module) => ({ default: module.OperationalDefaultsForm })),
);
const ServiceAddonsManager = lazy(() => import("../service-addons/service-addons-manager"));
const TemplateList = lazy(() =>
  import("../communications/template-list").then((module) => ({ default: module.TemplateList })),
);
const FinanceDefaultsForm = lazy(() =>
  import("../finance/finance-defaults-form").then((module) => ({ default: module.FinanceDefaultsForm })),
);
const IntegrationCard = lazy(() =>
  import("../integrations/integration-card").then((module) => ({ default: module.IntegrationCard })),
);
const MetaPageChannelCard = lazy(() =>
  import("../integrations/meta-page-channel-card").then((module) => ({ default: module.MetaPageChannelCard })),
);
const WhatsAppConnectCard = lazy(() =>
  import("../integrations/whatsapp-connect-card").then((module) => ({ default: module.WhatsAppConnectCard })),
);
const TemplateManager = lazy(() =>
  import("../whatsapp-templates/template-manager").then((module) => ({ default: module.TemplateManager })),
);
const BillingDashboard = lazy(() =>
  import("../whatsapp-billing/billing-dashboard").then((module) => ({ default: module.BillingDashboard })),
);
const SecurityForm = lazy(() =>
  import("../security/security-form").then((module) => ({ default: module.SecurityForm })),
);
const SessionsCard = lazy(() =>
  import("../security/sessions-card").then((module) => ({ default: module.SessionsCard })),
);
const AuditLogTable = lazy(() =>
  import("../data/audit-log-table").then((module) => ({ default: module.AuditLogTable })),
);
const ExportCard = lazy(() =>
  import("../data/export-card").then((module) => ({ default: module.ExportCard })),
);
const ImportCard = lazy(() =>
  import("../data/import-card").then((module) => ({ default: module.ImportCard })),
);
const RetentionCard = lazy(() =>
  import("../data/retention-card").then((module) => ({ default: module.RetentionCard })),
);
const DangerActions = lazy(() =>
  import("../danger/danger-actions").then((module) => ({ default: module.DangerActions })),
);
const EmailSettings = lazy(() =>
  import("../email/email-settings").then((module) => ({ default: module.EmailSettings })),
);

const SECTION_CODE_LOADERS: Record<SettingsSectionId, () => Promise<unknown>> = {
  organisation: () => import("../organisation/organisation-form"),
  branches: () => Promise.all([import("../branches/branch-list"), import("../branches/branch-rules-card")]),
  branding: () => import("../branding/branding-form"),
  operations: () => import("../operations/operational-defaults-form"),
  "service-addons": () => import("../service-addons/service-addons-manager"),
  communications: () => import("../communications/template-list"),
  finance: () => import("../finance/finance-defaults-form"),
  integrations: () => Promise.all([
    import("../integrations/integration-card"),
    import("../integrations/meta-page-channel-card"),
    import("../integrations/whatsapp-connect-card"),
  ]),
  email: () => import("../email/email-settings"),
  "whatsapp-templates": () => import("../whatsapp-templates/template-manager"),
  "whatsapp-billing": () => import("../whatsapp-billing/billing-dashboard"),
  security: () => Promise.all([import("../security/security-form"), import("../security/sessions-card")]),
  data: () => Promise.all([
    import("../data/audit-log-table"),
    import("../data/export-card"),
    import("../data/import-card"),
    import("../data/retention-card"),
  ]),
  danger: () => import("../danger/danger-actions"),
};

type SectionEntry =
  | { status: "denied" }
  | { status: "error" }
  | { status: "ready"; data: Record<string, unknown> };

function SettingsSectionSkeleton({ section }: { section: SettingsSectionId }) {
  return (
    <SectionShell title={SETTINGS_SECTION_LABELS[section]} description={SECTION_DESCRIPTIONS[section]}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-label="Loading settings">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </SectionShell>
  );
}

function preloadSettingsSectionCode(section: SettingsSectionId) {
  void SECTION_CODE_LOADERS[section]().catch(() => undefined);
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
        <div className="flex flex-col [&>section]:min-h-0 [&>section]:shrink-0">
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
      const whatsapp = data.whatsapp as WhatsAppConnectCardProps;
      const otherIntegrations = data.otherIntegrations as { id: string }[];
      return (
        <SectionShell
          title="Integrations"
          description="Only the integrations the agency can actually use today. Never shows a full API key after saving."
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <WhatsAppConnectCard {...whatsapp} />
            {/* Each Meta channel has its own card and its own sign-in, exactly as on the Integrations page. */}
            <MetaPageChannelCard channel="MESSENGER" {...(data.messenger as SettingsPageChannelProps)} canEdit={data.canEdit as boolean} />
            <MetaPageChannelCard channel="INSTAGRAM" {...(data.instagram as SettingsPageChannelProps)} canEdit={data.canEdit as boolean} />
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
        <div className="flex flex-col [&>section]:min-h-0 [&>section]:shrink-0">
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
    preloadSettingsSectionCode(activeSection);
    SECTION_LOADERS[activeSection]()
      .then((result) => {
        setEntries((prev) => ({
          ...prev,
          [activeSection]: result.ok
            ? { status: "ready", data: result }
            : { status: "denied" },
        }));
      })
      .catch(() => {
        setEntries((prev) => ({
          ...prev,
          [activeSection]: { status: "error" },
        }));
      })
      .finally(() => {
        inFlight.current.delete(activeSection);
      });
  }, [open, activeSection, entries]);

  function retryActiveSettingsSection() {
    if (!activeSection) return;
    setEntries((previousEntries) => {
      const nextEntries = { ...previousEntries };
      delete nextEntries[activeSection];
      return nextEntries;
    });
  }

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
          <aside className="hidden w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border/50 bg-card px-3 py-4 custom-scroll md:flex lg:w-64">
            <div className="mb-4 px-1">
              <h2 className="font-heading text-base font-medium leading-tight lg:text-xl">
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
                    onPointerEnter={() => preloadSettingsSectionCode(id)}
                    onFocus={() => preloadSettingsSectionCode(id)}
                    aria-current={isActive ? "page" : undefined}
                    title={SETTINGS_SECTION_LABELS[id]}
                    className={cn(
                      "flex items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-sm transition-colors text-left",
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
                    <span className="min-w-0 leading-snug">
                      {SETTINGS_SECTION_LABELS[id]}
                    </span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <div className="flex flex-1 min-w-0 flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-border/50 bg-muted/30 px-4 py-3 md:hidden">
              <div>
                <h2 className="font-heading text-base font-medium leading-tight">
                  Settings
                </h2>
                <p className="text-[11px] text-muted-foreground">
                  Agency, operations & security
                </p>
              </div>
            </div>

            <div className="border-b border-border/50 px-4 py-3 md:hidden">
              <label htmlFor="mobile-settings-section" className="sr-only">
                Settings section
              </label>
              <Select
                value={activeSection}
                onValueChange={(value) => {
                  if (!value) return;
                  setActiveSection(value as SettingsSectionId);
                }}
              >
                <SelectTrigger id="mobile-settings-section" className="w-full">
                  <SelectValue>{SETTINGS_SECTION_LABELS[activeSection]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {sections.map((id) => (
                    <SelectItem key={id} value={id}>
                      {SETTINGS_SECTION_LABELS[id]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto custom-scroll">
              {!entry ? (
                <SettingsSectionSkeleton section={activeSection} />
              ) : entry.status === "denied" ? (
                <SectionShell title={SETTINGS_SECTION_LABELS[activeSection]} description={SECTION_DESCRIPTIONS[activeSection]}>
                  <PermissionDenied
                    what={SETTINGS_SECTION_LABELS[activeSection]}
                  />
                </SectionShell>
              ) : entry.status === "error" ? (
                <SectionShell title={SETTINGS_SECTION_LABELS[activeSection]} description={SECTION_DESCRIPTIONS[activeSection]}>
                  <div className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-sm border border-dashed px-4 py-8 text-center">
                    <p className="text-sm font-medium">This settings section could not be loaded.</p>
                    <p className="text-xs text-muted-foreground">Check your connection, then try again.</p>
                    <Button variant="outline" size="sm" onClick={retryActiveSettingsSection}>
                      Try again
                    </Button>
                  </div>
                </SectionShell>
              ) : (
                <Suspense
                  fallback={
                    <SettingsSectionSkeleton section={activeSection} />
                  }
                >
                  {renderSection(activeSection, entry.data)}
                </Suspense>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
