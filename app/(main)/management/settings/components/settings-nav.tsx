"use client";

/**
 * Left-side settings sub-navigation. Composed from `Link` + `usePathname()` +
 * `cn()` only — same active/hover classes as the app sidebar's `NavItem`
 * (`components/app-sidebar.tsx`). Deliberately not a new file under
 * `components/`: this nav is used by exactly one route. See the Settings
 * plan D10.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { SETTINGS_SECTION_LABELS, type SettingsSectionId } from "@/lib/access/settings-access";

export function SettingsNav({ sections }: { sections: SettingsSectionId[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-row gap-1 overflow-x-auto md:flex-col md:overflow-visible md:w-56 shrink-0">
      {sections.map((id) => {
        const href = `/management/settings/${id}`;
        const isActive = pathname === href;
        const isDanger = id === "danger";

        return (
          <Link
            key={id}
            href={href}
            className={cn(
              "shrink-0 rounded-sm px-3 py-2 text-sm transition-colors whitespace-nowrap",
              isActive
                ? isDanger
                  ? "bg-destructive/15 text-destructive"
                  : "bg-primary/20 text-primary"
                : isDanger
                  ? "text-destructive/80 hover:bg-destructive/10"
                  : "text-muted-foreground hover:bg-primary/10 hover:text-foreground",
            )}
          >
            {SETTINGS_SECTION_LABELS[id]}
          </Link>
        );
      })}
    </nav>
  );
}
