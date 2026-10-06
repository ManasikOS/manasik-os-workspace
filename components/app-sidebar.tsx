"use client";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  BrainCircuit,
  CalendarCheck,
  ChartNoAxesCombined,
  ClipboardCheck,
  ContactRound,
  FileSignature,
  FileStack,
  FolderCheck,
  Gift,
  HandCoins,
  Handshake,
  Heart,
  LayoutDashboard,
  LucideIcon,
  Megaphone,
  MessageCircle,
  MessageSquare,
  MessageSquareWarning,
  Package,
  PlaneTakeoff,
  Receipt,
  Route,
  Scale,
  Speaker,
  Sparkles,
  Stamp,
  Undo2,
  UserCog,
  UserRound,
  Users,
  UsersRound,
  Wallet,
  ChevronsUpDown,
  Loader2Icon,
} from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/logo";
import { AgencySwitcher } from "@/components/agency-switcher";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import dynamic from "next/dynamic";

import type { AgencyMembership } from "@/lib/data/departure-groups";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import { capabilitiesFor } from "@/lib/access/departure-groups-access";
import { capabilitiesForDocuments } from "@/lib/access/documents-access";
import { capabilitiesForFinance } from "@/lib/access/finance-access";
import { capabilitiesForAiAgent } from "@/lib/access/ai-agent-access";
import { capabilitiesForLeads } from "@/lib/access/leads-access";
import { capabilitiesForOperations } from "@/lib/access/operations-access";
import { capabilitiesForPackages } from "@/lib/access/packages-access";
import { capabilitiesForPilgrims } from "@/lib/access/pilgrims-access";
import { capabilitiesForReports } from "@/lib/access/reports-access";
import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { capabilitiesForVisa } from "@/lib/access/visa-access";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Bug2, Moon, Moon3, Settings2, Sun, User } from "reicon-react";

/**
 * Every item's `visible` is the real capability check for its module, not a
 * hardcoded per-role list — same posture as `describeRoleAccess()` in
 * `lib/access/team-access.ts`. A role change that opens a module also opens
 * its sidebar entry, with nothing to keep in sync by hand.
 *
 * Grouping mirrors the target information architecture (Home / Grow / Sell /
 * Operate / Finance / Relationships / Insights). Items with no capability
 * module of their own yet (Campaigns, Quotes, Readiness Center's siblings,
 * Finance Overview and friends, Relationships portals, Analytics, AI
 * Insights, ...) are structured placeholders — see
 * `components/coming-soon-page.tsx` — and are visible to every signed-in
 * role until a real module (and capability set) is built for them.
 */
export function AppSidebar({
  role,
  memberships = [],
  name,
  staffId,
}: {
  role: StaffRole;
  memberships?: AgencyMembership[];
  name?: string | null;
  staffId?: string | null;
}) {
  const [vaultOpen, setVaultOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hasOpenedSettings, setHasOpenedSettings] = useState(false);

  const overview: NavItem = {
    title: "Dashboard",
    icon: LayoutDashboard,
    url: "/dashboard",
    visible: true,
    desc: "Manage",
  };

  const grow: NavItem[] = [
    {
      title: "Leads",
      icon: MessageSquare,
      url: "/leads",
      visible: capabilitiesForLeads(role).viewModule,
      desc: "Add, manage Leads",
    },
    {
      title: "Campaigns",
      icon: Megaphone,
      url: "/campaigns",
      visible: capabilitiesForLeads(role).viewModule,
      desc: "Manage",
    },
    {
      title: "Audiences",
      icon: UsersRound,
      url: "/audiences",
      visible: capabilitiesForLeads(role).viewModule,
      desc: "Manage",
    },
    {
      title: "Document Vault",
      icon: FileStack,
      url: "/vault",
      // Every signed-in role can browse/download the vault; upload/delete is gated inside the dialog itself.
      visible: true,
      desc: "Passports, visas, tickets, receipts, brochures",
      onClick: () => setVaultOpen(true),
    },
    {
      title: "Referrals",
      icon: Gift,
      url: "/referrals",
      visible: capabilitiesForLeads(role).viewModule,
      desc: "Manage",
    },
  ];

  const sell: NavItem[] = [
    {
      title: "Quotes",
      icon: FileSignature,
      url: "/quotes",
      visible:
        capabilitiesForLeads(role).viewModule &&
        capabilitiesForLeads(role).viewQuotes,
      desc: "Manage",
    },
    {
      title: "Bookings",
      icon: CalendarCheck,
      url: "/bookings",
      visible: capabilitiesFor(role).viewModule,
      desc: "Manage",
    },
    {
      title: "Pilgrims",
      icon: ContactRound,
      url: "/pilgrims",
      visible: capabilitiesForPilgrims(role).viewModule,
      desc: "View, create & manage pilgrims",
    },
    {
      title: "Packages",
      icon: Package,
      url: "/packages",
      visible: capabilitiesForPackages(role).viewModule,
      desc: "Create, manage packages",
    },
    {
      title: "Departure Groups",
      icon: PlaneTakeoff,
      url: "/departure-groups",
      visible: capabilitiesFor(role).viewModule,
      desc: "Create, manage departure groups",
    },
  ];

  const operate: NavItem[] = [
    {
      title: "Operations",
      icon: ClipboardCheck,
      url: "/operations",
      visible: capabilitiesForOperations(role).viewModule,
      desc: "Manage",
    },
    {
      title: "Documents",
      icon: FolderCheck,
      url: "/documents",
      visible: capabilitiesForDocuments(role).viewModule,
      desc: "Manage",
    },
    {
      title: "Visa Operations",
      icon: Stamp,
      url: "/visa",
      visible: capabilitiesForVisa(role).viewModule,
      desc: "Manage",
    },
  ];

  const finance: NavItem[] = [
    {
      title: "Finance Overview",
      icon: Wallet,
      url: "/finance",
      visible: capabilitiesForFinance(role).viewModule,
      desc: "Manage",
    },
  ];

  const insights: NavItem[] = [
    {
      title: "Reports",
      icon: ChartNoAxesCombined,
      url: "/reports",
      visible: capabilitiesForReports(role).viewModule,
      desc: "Manage",
    },
    {
      title: "Analytics",
      icon: BarChart3,
      url: "/analytics",
      visible: capabilitiesForReports(role).viewOverview,
      desc: "Manage",
    },
    {
      title: "AI Insights",
      icon: BrainCircuit,
      url: "/ai-insights",
      visible: capabilitiesForReports(role).viewOverview,
      desc: "Manage",
    },
  ];
  const adminBar = [
    { title: "Home", link: [overview] },
    { title: "Grow", link: grow },
    { title: "Sell", link: sell },
    { title: "Operate", link: operate },
    { title: "Finance", link: finance },
    { title: "Insights", link: insights },
  ]
    .map((section) => ({
      ...section,
      link: section.link.filter((item) => item.visible),
    }))
    .filter((section) => section.link.length > 0);
  return (
    <Sidebar collapsible="icon" className="gap-0 py-0 h-full">
      <SidebarHeader className="overflow-hidden">
        {/* <Logo className="w-20 h-auto group-data-[collapsible=icon]:hidden" /> */}
        <AgencySwitcher memberships={memberships} />
      </SidebarHeader>
      <SidebarContent className="gap-0 py-0">
        {adminBar.map((section, index) => (
          <SidebarGroup
            className="flex flex-col gap-0.5"
            key={index}
            title={section.title}
          >
            <SidebarGroupLabel>{section.title}</SidebarGroupLabel>
            {section.link.map((link, linkIndex) => (
              <NavItem key={linkIndex} item={link} collapsed={false} />
            ))}
          </SidebarGroup>
        ))}
        <SidebarGroup />
      </SidebarContent>
      <SidebarFooter>
        <DropdownMenu>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenuTrigger
                render={<SettingsProfileLink role={role} name={name} staffId={staffId} />}
              />
            </SidebarMenuItem>
          </SidebarMenu>
          <DropdownMenuContent>
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuItem>
              <User size={10} /> Profile
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                // relationships/announcments
              }}
            >
              <Speaker size={10} /> Announcements
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                // relationships/feedback-complaints
              }}
            >
              <MessageSquareWarning size={10} /> Feedbacks
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                // relationships/announcments
              }}
            >
              <Sparkles size={10} /> Manasik Copilot
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Users size={10} /> Team
            </DropdownMenuItem>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Moon3 size={10} /> Theme
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>
                  <Sun size={10} /> Light
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Moon size={10} /> Dark
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Sun size={10} /> System
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuItem
              onClick={() => {
                setHasOpenedSettings(true);
                setSettingsOpen(true);
              }}
            >
              <Settings2 size={10} /> Settings
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Bug2 size={10} /> Send Feedback
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {hasOpenedSettings && (
          <SettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            role={role}
          />
        )}
        {vaultOpen && (
          <VaultDialog open={vaultOpen} onOpenChange={setVaultOpen} role={role} mode="manage" />
        )}
      </SidebarFooter>
    </Sidebar>
  );
}

/**
 * The Settings dialog pulls in about twenty forms (charts, validation, tables).
 * Importing it statically put all of that in the JavaScript of every page,
 * because the sidebar is on every page. It is loaded only when Settings is
 * opened, and warmed on hover so the click still feels instant.
 */
const loadSettingsDialog = () =>
  Promise.all([
    import("@/app/(main)/management/settings/components/settings-dialog"),
    import("@/app/(main)/management/settings/organisation/organisation-form"),
  ]).then(([module]) => module.SettingsDialog);
const SettingsDialog = dynamic(loadSettingsDialog, { ssr: false });

/** Same posture as Settings: loaded only when the Document Vault is opened. */
const VaultDialog = dynamic(() => import("@/components/vault/vault-dialog"), { ssr: false });

/**
 * Sits where a "Settings" nav row used to be — clicking it opens the
 * settings dialog in place (local `open` state, same as `CreatePackageDialog`
 * / `AddNewLead`), not a page navigation. Denied roles (Guide) have no
 * Settings section at all, so it falls back to a plain link to their own
 * Team profile, mirroring `app/(main)/management/settings/page.tsx`'s
 * redirect.
 */
function SettingsProfileLink({
  role,
  name,
  staffId,
}: {
  role: StaffRole;
  name?: string | null;
  staffId?: string | null;
}) {

  const canViewSettings = capabilitiesForSettings(role).viewModule;
  const displayName = name?.trim() || "Account";
  const initials =
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?";

  const avatarRow = (
    <>
      <Avatar className="size-9 shrink-0">
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      <div className="flex justify-between items-center w-full">
        <div>
          <span className="line-clamp-1 text-[14px] font-medium">
            {/* TODO */}
            {/* {displayName} */} Mohamed Afras
          </span>
          <span className="text-muted-foreground line-clamp-1 text-xs">
            email
          </span>
        </div>
        <ChevronsUpDown size={20} className=" shrink-0 text-muted-foreground" />
      </div>
    </>
  );

  if (!canViewSettings) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            className="h-11 gap-2.5 rounded-xs transition-colors hover:bg-primary/10"
            render={
              <Link
                href={
                  staffId ? `/management/team/${staffId}` : "/management/team"
                }
                className="flex flex-row items-center gap-2.5 w-full"
              >
                {avatarRow}
              </Link>
            }
          />
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenuButton
      className={cn(
        "h-13 gap-2.5 rounded-sm transition-colors",
        "hover:bg-muted-foreground/10",
      )}
      onPointerEnter={() => void loadSettingsDialog()}
      onFocus={() => void loadSettingsDialog()}
    >
      <div className="flex flex-row items-center gap-2.5 w-full">
        {avatarRow}
      </div>
    </SidebarMenuButton>
  );
}

type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  desc: string;
  shortcut?: string;
  visible: boolean;
  /** When set, this item opens a dialog instead of navigating — `url` is still used for the active-state check, so keep it unique. */
  onClick?: () => void;
};
/**
 * Swaps the nav icon for a spinner the instant its link is clicked, until the
 * destination is ready. `useLinkStatus` only works from a child of `<Link>`.
 */
function SidebarNavItemIcon({ icon: Icon }: { icon: LucideIcon }) {
  const { pending } = useLinkStatus();
  if (pending)
    return (
      <Loader2Icon className="size-5 shrink-0 animate-spin text-primary" />
    );
  return <Icon className="size-5 shrink-0" />;
}

function NavItem({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const pathname = usePathname();
  const isActive = !item.onClick && (pathname === item.url || pathname.startsWith(`${item.url}/`));
  // useLinkStatus() only works nested under next/link's <Link> — a dialog-trigger item never navigates, so it gets a plain icon.
  const Icon = item.icon;
  const inner = (
    <div className="flex flex-row gap-2  w-full justify-between items-center">
      <div className="flex flex-row gap-2 items-center">
        <div className="flex flex-row gap-2  items-start">
          <div className="mt-1 text-xl ">
            {item.onClick ? <Icon className="size-5 shrink-0" /> : <SidebarNavItemIcon icon={item.icon} />}
          </div>

          {!collapsed && (
            <div>
              <span className="line-clamp-1 text-[16px]">{item.title}</span>
            </div>
          )}
        </div>{" "}
      </div>
    </div>
  );

  const button = item.onClick ? (
    <SidebarMenuButton
      className="h-12 gap-3 rounded-sm transition-colors hover:bg-primary/10"
      onClick={item.onClick}
    >
      <span className="flex w-full flex-row items-center justify-between gap-3 text-lg">{inner}</span>
    </SidebarMenuButton>
  ) : (
    <SidebarMenuButton
      className={cn(
        "h-12 gap-3 rounded-sm transition-colors",
        isActive ? "bg-primary/15 dark:bg-primary/5" : "hover:bg-primary/10",
      )}
      render={
        <Link
          href={item.url}
          className={cn(
            "flex w-full flex-row items-center justify-between gap-3 text-lg",
            isActive ? "text-primary" : "",
          )}
          aria-current={isActive ? "page" : undefined}
        >
          {inner}
        </Link>
      }
    ></SidebarMenuButton>
  );

  return <SidebarMenuItem>{button}</SidebarMenuItem>;
}
