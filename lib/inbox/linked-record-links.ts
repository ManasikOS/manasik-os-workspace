/**
 * The links from a conversation to its lead, booking and departure group (PRD-02). They are visible controls first,
 * and the `e`, `b` and `g` then `d` shortcuts simply activate them, so a shortcut can never open more than a person's
 * role allows. Ids must be UUIDs before they become part of an address.
 */

import type { InboxShortcutId } from "./keyboard-shortcuts";

export interface LinkedRecordInput {
  leadId: string | null;
  bookingId: string | null;
  /** The departure group the booking belongs to, when known. */
  bookingDepartureGroupId: string | null;
  /** The departure group selected on the lead, used when there is no booking. */
  selectedDepartureGroupId: string | null;
  can: { openLead: boolean; openBooking: boolean; openDepartureGroup: boolean };
}

export interface LinkedRecordLink {
  id: Extract<InboxShortcutId, "OPEN_LEAD" | "OPEN_BOOKING" | "OPEN_DEPARTURE_GROUP">;
  label: string;
  href: string;
  /** For display and the aria-keyshortcuts value. */
  shortcutKey: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidOrNull(value: string | null): string | null {
  return value !== null && UUID_PATTERN.test(value) ? value : null;
}

export function linkedRecordLinks(input: LinkedRecordInput): LinkedRecordLink[] {
  const leadId = uuidOrNull(input.leadId);
  const bookingId = uuidOrNull(input.bookingId);
  const bookingGroupId = uuidOrNull(input.bookingDepartureGroupId);
  const groupId = bookingGroupId ?? uuidOrNull(input.selectedDepartureGroupId);

  const links: LinkedRecordLink[] = [];
  if (input.can.openLead && leadId) {
    links.push({ id: "OPEN_LEAD", label: "Open lead", href: `/leads?open=${leadId}`, shortcutKey: "e" });
  }
  if (input.can.openBooking && bookingId) {
    links.push({
      id: "OPEN_BOOKING",
      label: "Open booking",
      href: `/bookings?booking=${bookingId}`,
      shortcutKey: "b",
    });
  }
  if (input.can.openDepartureGroup && groupId) {
    links.push({ id: "OPEN_DEPARTURE_GROUP", label: "Open departure group", href: `/departure-groups/${groupId}`, shortcutKey: "g then d" });
  }
  return links;
}
