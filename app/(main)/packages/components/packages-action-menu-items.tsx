"use client";

import React from "react";
import {
  Archive,
  ArchiveRestore,
  Ban,
  Copy,
  Eye,
  GitCompare,
  Lock,
  Pencil,
  Plus,
  PlusCircle,
  Send,
  Star,
  Trash2,
} from "lucide-react";
import type { DepartureGroupCapabilities } from "@/lib/access/departure-groups-access";
import { PackageRowActions } from "./packages-table/packages-columns";
import { PackageListItem } from "@/lib/types/packages";
import { PackageCapabilities } from "@/lib/access/packages-access";

/**
 * Slot components that let the same menu body render inside either a
 * `DropdownMenuContent` or a `ContextMenuContent`.  Each consumer passes
 * the correct wrapper implementations for its menu system.
 *
 * The types are intentionally wide (`React.ElementType`) because the real
 * components (MenuItem, ContextMenuItem, etc.) accept many more
 * props than what we use here and strict `ComponentType<{...}>` would
 * refuse the assignment.
 */
export interface MenuSlots {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  MenuItem: React.ElementType<any>;
  MenuSeparator: React.ElementType<any>;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

interface PackagesActionMenuItemsProps {
  packages: PackageListItem;
  can: PackageCapabilities;
  actions: PackageRowActions;
  slots: MenuSlots;
}

export function PackagesActionMenuItems({
  packages,
  can,
  actions,
  slots,
}: PackagesActionMenuItemsProps) {
  const { MenuItem, MenuSeparator } = slots;

  return (
    <>
      {/* Plain div — DropdownMenuLabel is already a <div>, and
          ContextMenuLabel requires a Group parent we can't provide. */}
      <div className="px-1.5 py-1 text-xs font-medium text-muted-foreground">
        {packages.code}
      </div>
      <MenuItem onClick={() => actions.onOpen(packages)}>
        <Eye /> Open Package
      </MenuItem>
      {can.editPackage && (
        <MenuItem onClick={() => actions.onEdit(packages)}>
          <Pencil /> Edit Details
        </MenuItem>
      )}
      {can.duplicatePackage && (
        <MenuItem onClick={() => actions.onDuplicate(packages)}>
          <Copy /> Duplicate
        </MenuItem>
      )}
      {can.createGroupFromPackage && packages.status === "Open for Sale" && (
        <MenuItem onClick={() => actions.onCreateGroup(packages)}>
          <PlusCircle /> Create Departure Group
        </MenuItem>
      )}
      <MenuSeparator />
      {can.publishPackage && packages.status === "Draft" && (
        <MenuItem onClick={() => actions.onPublish(packages)}>
          <Send /> Publish
        </MenuItem>
      )}
      {can.publishPackage && packages.status === "Open for Sale" && (
        <MenuItem onClick={() => actions.onUnpublish(packages)}>
          <Send /> Unpublish
        </MenuItem>
      )}
      {can.publishPackage && packages.status === "Sales Closed" && (
        <MenuItem onClick={() => actions.onReopen(packages)}>
          <Send /> Reopen for Sale
        </MenuItem>
      )}
      {can.toggleFeatured && (
        <MenuItem onClick={() => actions.onToggleFeatured(packages)}>
          <Star /> {packages.featured ? "Unfeature" : "Feature"}
        </MenuItem>
      )}
      {can.archiveOrRestorePackage && (
        <>
          <MenuSeparator />
          {packages.archived ? (
            <MenuItem onClick={() => actions.onRestore(packages)}>
              <ArchiveRestore /> Restore
            </MenuItem>
          ) : (
            <MenuItem onClick={() => actions.onArchive(packages)}>
              <Archive /> Archive
            </MenuItem>
          )}
        </>
      )}
      {can.deletePackage && (
        <MenuItem
          variant="destructive"
          disabled={packages.groupCount > 0}
          onClick={() => actions.onDelete(packages)}
        >
          <Trash2 />
          {packages.groupCount > 0
            ? `Delete (used by ${packages.groupCount})`
            : "Delete Package"}
        </MenuItem>
      )}
    </>
  );
}
