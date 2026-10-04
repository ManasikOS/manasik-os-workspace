"use client";

import { Building2, Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { useTransition } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { toast } from "@/components/ui/toast";
import type { AgencyMembership } from "@/lib/data/departure-groups";
import { switchAgencyAction } from "@/lib/tenancy";

/**
 * Workspace switcher — rendered only when a person has more than one active
 * agency membership (docs/architecture/multi-tenancy-implementation-plan.md Phase 3).
 * Hidden entirely for the overwhelming common case of one agency, so this
 * adds nothing to the sidebar for anyone it doesn't apply to.
 */
export function AgencySwitcher({ memberships }: { memberships: AgencyMembership[] }) {
  const [isPending, startTransition] = useTransition();

  if (memberships.length < 2) return null;

  const active = memberships.find((m) => m.isDefault) ?? memberships[0];

  const switchTo = (agencyId: string) => {
    if (agencyId === active.agencyId) return;
    startTransition(async () => {
      const result = await switchAgencyAction(agencyId);
      if (!result.ok) {
        toast.add({ title: "Could not switch workspace", description: result.error });
        return;
      }
    });
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton disabled={isPending} className="justify-between">
                <span className="flex items-center gap-2 truncate">
                  {isPending ? <Loader2 className="size-4 animate-spin" /> : <Building2 className="size-4 shrink-0" />}
                  <span className="truncate">{active.agencyName || "Workspace"}</span>
                </span>
                <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Switch workspace</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {memberships.map((m) => (
              <DropdownMenuItem key={m.agencyId} onClick={() => switchTo(m.agencyId)} className="justify-between">
                <span className="truncate">{m.agencyName || "Workspace"}</span>
                {m.agencyId === active.agencyId && <Check className="size-3.5 shrink-0" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
