import type React from "react";

/**
 * Every settings section renders inside one of these: a title, an optional
 * description, its own content, and — per D3 — its own Save footer. There is
 * deliberately no page-level `[Save Changes]` button; a layout-level button
 * cannot observe ten independent forms' dirty state.
 *
 * The dialog owns scrolling. Keeping the section itself out of the scroll
 * business prevents nested scroll regions when several settings blocks share
 * one tab. The optional footer is sticky, but remains in document flow so it
 * never covers the final field.
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
    <section className="flex min-h-full flex-col">
      <div className="flex flex-col gap-6 px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-medium text-foreground">
            {title}
          </h2>
          {description && (
            <p className="max-w-4xl text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-5">{children}</div>
      </div>

      {footer && (
        <div className="sticky bottom-0 z-10 mt-auto flex min-h-14 shrink-0 items-center justify-end gap-3 border-t border-border/40 bg-background/95 px-4 py-3 backdrop-blur-sm sm:px-6">
          {footer}
        </div>
      )}
    </section>
  );
}
