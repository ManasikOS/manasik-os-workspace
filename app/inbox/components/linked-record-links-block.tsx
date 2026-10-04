"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  linkedRecordLinks,
  type LinkedRecordInput,
} from "@/lib/inbox/linked-record-links";

/**
 * Plain links from the conversation to its lead, booking and departure group. Only the ones the person's role may open
 * and that actually exist are shown. The e, b and g then d shortcuts press these same links.
 */
export function LinkedRecordLinksBlock({
  record,
}: {
  record: LinkedRecordInput;
}) {
  const links = linkedRecordLinks(record);
  if (links.length === 0) return null;

  return (
    <nav aria-label="Linked records" className="flex flex-wrap gap-2">
      {links.map((link) => (
        <Button
          key={link.id}
          size="sm"
          variant="outline_without_border"
          nativeButton={false}
          render={<Link href={link.href} />}
          data-inbox-shortcut-trigger={link.id}
          aria-keyshortcuts={link.shortcutKey}
          title={`Shortcut: ${link.shortcutKey}`}
        >
          {link.label}
        </Button>
      ))}
    </nav>
  );
}
