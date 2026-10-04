"use client";

import { useCallback, useSyncExternalStore, type ReactNode } from "react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  parseOpenCustomerPanelSections,
  serializeOpenCustomerPanelSections,
  type CustomerPanelSectionId,
} from "@/lib/inbox/customer-panel-sections";

const OPEN_SECTIONS_KEY = "inbox:customer-panel-sections";
const OPEN_SECTIONS_CHANGED_EVENT = "inbox-customer-panel-sections-changed";

/** Storage can be blocked; the panel must still open and close without it. */
function readStoredSections(): string | null {
  try {
    return window.localStorage.getItem(OPEN_SECTIONS_KEY);
  } catch {
    return null;
  }
}

function subscribeToStoredSections(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(OPEN_SECTIONS_CHANGED_EVENT, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(OPEN_SECTIONS_CHANGED_EVENT, notify);
  };
}

export interface CustomerContextSection {
  id: CustomerPanelSectionId;
  title: string;
  /** One quiet line shown beside the title while the section is closed, e.g. "Due in 2 days". */
  summary?: string | null;
  content: ReactNode;
}

/**
 * The customer panel's collapsible sections. Which ones are open is remembered per browser. Closed sections stay mounted,
 * so a half-written Copilot draft or a loading history is not lost when someone folds the section.
 */
export function CustomerContextAccordion({
  sections,
}: {
  sections: CustomerContextSection[];
}) {
  const stored = useSyncExternalStore(
    subscribeToStoredSections,
    readStoredSections,
    () => null,
  );
  const openSections = parseOpenCustomerPanelSections(stored);
  const handleOpenChange = useCallback((next: unknown[]) => {
    try {
      window.localStorage.setItem(
        OPEN_SECTIONS_KEY,
        serializeOpenCustomerPanelSections(next.map(String)),
      );
    } catch {
      // The choice then lasts only until reload.
    }
    window.dispatchEvent(new Event(OPEN_SECTIONS_CHANGED_EVENT));
  }, []);

  return (
    <Accordion
      multiple
      value={openSections}
      onValueChange={handleOpenChange}
      className="px-0"
    >
      {sections.map((section) => (
        <AccordionItem key={section.id} value={section.id}>
          <AccordionTrigger className="items-center rounded-none px-4 py-3 hover:no-underline">
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="text-sm font-medium">{section.title}</span>
              {section.summary && (
                <span className="min-w-0 truncate text-xs font-normal text-muted-foreground">
                  {section.summary}
                </span>
              )}
            </span>
          </AccordionTrigger>
          <AccordionContent keepMounted className="space-y-3 px-4 pb-4">
            {section.content}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
