"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { groupInboxShortcutsForHelp } from "@/lib/inbox/keyboard-shortcuts";

/**
 * Every Inbox keyboard shortcut and what it does, opened with ?. It is built from the registry, so it can only list
 * shortcuts that exist. Escape closes it and focus returns to where it was.
 */
export function InboxShortcutHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const groups = groupInboxShortcutsForHelp();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg! gap-4">
        <DialogHeader className="gap-2">
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Shortcuts work when you are not typing in a box. Some are unavailable until a conversation is open or your role
            allows the action; you will be told why.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
          {groups.map((group) => (
            <section key={group.group} aria-labelledby={`inbox-shortcut-group-${group.group}`} className="space-y-2">
              <h3 id={`inbox-shortcut-group-${group.group}`} className="text-xs font-medium uppercase text-muted-foreground">
                {group.group}
              </h3>
              <dl className="grid gap-2">
                {group.items.map((item) => (
                  <div key={item.id} className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <dt className="text-sm font-medium">{item.label}</dt>
                      <dd className="text-xs text-muted-foreground">{item.description}</dd>
                    </div>
                    <kbd className="shrink-0 rounded border bg-muted px-2 py-0.5 text-xs font-medium" aria-label={`Shortcut: ${item.keysLabel}`}>
                      {item.keysLabel}
                    </kbd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
