"use client";

import React from "react";
import {
  Ban,
  ChevronRight,
  Eye,
  MessageSquare,
  PhoneCall,
  UserCheck,
} from "lucide-react";

import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import type { StaffRow } from "@/lib/types/leads";
import type { LeadListItem } from "../types";
import { STAGE_LABELS, nextStage, whatsappLink } from "../utils";
import type { LeadRowActions } from "./leads-columns";

/**
 * Slot components that let the same menu body render inside either a
 * `DropdownMenuContent` (the row's "⋯" button) or a `ContextMenuContent`
 * (right-click on the row), so both menus always offer the same actions.
 */
export interface MenuSlots {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  MenuItem: React.ElementType<any>;
  MenuSeparator: React.ElementType<any>;
  MenuLabel: React.ElementType<any>;
  MenuSub: React.ElementType<any>;
  MenuSubTrigger: React.ElementType<any>;
  MenuSubContent: React.ElementType<any>;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** `ContextMenuLabel` needs a Group parent, so use a plain div styled the same. */
function ContextMenuPlainLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-1.5 py-1 text-xs font-medium text-muted-foreground">
      {children}
    </div>
  );
}

export const DROPDOWN_SLOTS: MenuSlots = {
  MenuItem: DropdownMenuItem,
  MenuSeparator: DropdownMenuSeparator,
  MenuLabel: DropdownMenuLabel,
  MenuSub: DropdownMenuSub,
  MenuSubTrigger: DropdownMenuSubTrigger,
  MenuSubContent: DropdownMenuSubContent,
};

export const CONTEXT_MENU_SLOTS: MenuSlots = {
  MenuItem: ContextMenuItem,
  MenuSeparator: ContextMenuSeparator,
  MenuLabel: ContextMenuPlainLabel,
  MenuSub: ContextMenuSub,
  MenuSubTrigger: ContextMenuSubTrigger,
  MenuSubContent: ContextMenuSubContent,
};

interface LeadActionMenuItemsProps {
  lead: LeadListItem;
  actions: LeadRowActions;
  staffOptions: StaffRow[];
  slots: MenuSlots;
}

export function LeadActionMenuItems({
  lead,
  actions,
  staffOptions,
  slots,
}: LeadActionMenuItemsProps) {
  const {
    MenuItem,
    MenuSeparator,
    MenuLabel,
    MenuSub,
    MenuSubTrigger,
    MenuSubContent,
  } = slots;
  const advance = nextStage(lead.stage);

  return (
    <>
      <MenuLabel>{lead.reference}</MenuLabel>
      <MenuItem onClick={() => actions.onOpen(lead)}>
        <Eye /> Open Lead
      </MenuItem>
      <MenuItem onClick={() => actions.onLogContact(lead)}>
        <MessageSquare /> Log Contact…
      </MenuItem>

      {/* No number yet (Messenger/Instagram lead): nothing to call or open on WhatsApp. */}
      {lead.mobileRaw && (
        <>
          <MenuSeparator />
          <MenuItem render={<a href={`tel:+94${lead.mobileRaw}`} />}>
            <PhoneCall /> Call {lead.mobile}
          </MenuItem>
          <MenuItem
            render={
              <a
                href={whatsappLink(lead.mobileRaw)}
                target="_blank"
                rel="noreferrer noopener"
              />
            }
          >
            <MessageSquare /> Open WhatsApp
          </MenuItem>
        </>
      )}

      <MenuSeparator />
      {advance && (
        <MenuItem onClick={() => actions.onChangeStage(lead, advance)}>
          <ChevronRight /> Advance to {STAGE_LABELS[advance]}
        </MenuItem>
      )}
      <MenuSub>
        <MenuSubTrigger>
          <UserCheck /> Reassign
        </MenuSubTrigger>
        <MenuSubContent>
          {staffOptions.map((staff) => (
            <MenuItem
              key={staff.id}
              disabled={staff.id === lead.assignedToId}
              onClick={() => actions.onAssign(lead, staff.id)}
            >
              {staff.name}
            </MenuItem>
          ))}
        </MenuSubContent>
      </MenuSub>

      {!lead.isClosed && (
        <>
          <MenuSeparator />
          <MenuItem variant="destructive" onClick={() => actions.onMarkLost(lead)}>
            <Ban /> Mark as Lost…
          </MenuItem>
        </>
      )}
    </>
  );
}
