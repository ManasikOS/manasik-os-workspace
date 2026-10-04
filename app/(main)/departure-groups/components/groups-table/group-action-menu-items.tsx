"use client";

import React from "react";
import {
  Archive,
  Ban,
  Eye,
  GitCompare,
  Lock,
  Pencil,
  Plus,
} from "lucide-react";
import type { DepartureGroupCapabilities } from "@/lib/access/departure-groups-access";
import type { DepartureGroupListItem } from "../../types";
import type { GroupRowActions } from "./groups-columns";
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";

/**
 * Slot components that let the same menu body render inside either a
 * `DropdownMenuContent` or a `ContextMenuContent`.  Each consumer passes
 * the correct wrapper implementations for its menu system.
 *
 * The types are intentionally wide (`React.ElementType`) because the real
 * components (DropdownMenuItem, ContextMenuItem, etc.) accept many more
 * props than what we use here and strict `ComponentType<{...}>` would
 * refuse the assignment.
 */
export interface MenuSlots {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  MenuItem: React.ElementType<any>;
  MenuSeparator: React.ElementType<any>;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** Context-menu-flavoured slots for `GroupActionMenuItems`. */
export const CONTEXT_MENU_SLOTS: MenuSlots = {
  MenuItem: ContextMenuItem,
  MenuSeparator: ContextMenuSeparator,
};

interface GroupActionMenuItemsProps {
  group: DepartureGroupListItem;
  can: DepartureGroupCapabilities;
  actions: GroupRowActions;
  slots: MenuSlots;
}

/**
 * The shared set of row-level actions for a single Departure Group.
 *
 * Render this inside *any* menu wrapper — it only outputs `Item`, `Label` and
 * `Separator` elements through the `slots` prop so the caller decides whether
 * those come from `DropdownMenu*` or `ContextMenu*`.
 *
 * The label is rendered as a plain `<div>` because `ContextMenuLabel` (which
 * wraps `ContextMenuPrimitive.GroupLabel`) requires a `<ContextMenu.Group>`
 * parent that we don't have here, while `DropdownMenuLabel` is already just a
 * `<div>`. Using a plain `<div>` with the same classes works in both contexts.
 */
export function GroupActionMenuItems({
  group,
  can,
  actions,
  slots,
}: GroupActionMenuItemsProps) {
  const { MenuItem, MenuSeparator } = slots;

  return (
    <>
      {/* Plain div — DropdownMenuLabel is already a <div>, and
          ContextMenuLabel requires a Group parent we can't provide. */}
      <div className="px-1.5 py-1 text-xs font-medium text-muted-foreground">
        {group.groupCode}
      </div>
      <MenuItem onClick={() => actions.onOpen(group)}>
        <Eye /> Open Group
      </MenuItem>
      {can.editGroupDetails && (
        <MenuItem onClick={() => actions.onEdit(group)}>
          <Pencil /> Edit Group Details
        </MenuItem>
      )}
      {can.addBookings && (
        <MenuItem onClick={() => actions.onAddBooking(group)}>
          <Plus /> Add Booking
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuItem onClick={() => actions.onCompareTemplate(group)}>
        <GitCompare /> Compare With Package Template
      </MenuItem>
      {can.editGroupDetails &&
        group.salesStatus !== "SALES_CLOSED" &&
        group.salesStatus !== "CANCELLED" && (
          <>
            <MenuSeparator />
            <MenuItem onClick={() => actions.onCloseSales(group)}>
              <Lock /> Close Sales
            </MenuItem>
          </>
        )}
      {can.cancelOrArchiveGroup && (
        <>
          <MenuSeparator />
          {group.groupStatus !== "CANCELLED" && (
            <MenuItem
              variant="destructive"
              onClick={() => actions.onCancel(group)}
            >
              <Ban /> Cancel Group
            </MenuItem>
          )}
          <MenuItem onClick={() => actions.onArchive(group)}>
            <Archive /> Archive Group
          </MenuItem>
        </>
      )}
    </>
  );
}
