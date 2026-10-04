import type React from "react";

/**
 * Every settings section renders inside one of these: a title, an optional
 * description, its own content, and — per D3 — its own Save footer. There is
 * deliberately no page-level `[Save Changes]` button; a layout-level button
 * cannot observe ten independent forms' dirty state.
 *
 * Layout: fills the full height of its container (`h-full flex flex-col`).
 * The scrollable content area grows to take remaining space (`flex-1
 * overflow-y-auto`). The footer, when present, is a true sibling *outside*
 * the scroll area — it is always visible at the bottom of the dialog,
 * regardless of how much content the section has.
 */
export function SectionShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scroll px-4 sm:px-6 py-5 flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h3 className="text-xl font-semibold tracking-tight text-foreground">
            {title}
          </h3>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        <div className="flex flex-col gap-5 overflow-y-auto custom-scroll">
          {children}
        </div>
      </div>

      {/* Fixed footer — always at the bottom, never inside the scroll area */}
      {footer && (
        <div className="shrink-0 flex items-center justify-end gap-3 px-4 sm:px-6 py-3 border-t border-border/40 bg-card">
          {footer}
        </div>
      )}
    </div>
  );
}
