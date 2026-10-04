"use client";

import { useState, useTransition } from "react";
import { Bookmark, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { SAVED_VIEW_NAME_MAX, type SavedView } from "@/lib/inbox/saved-views";
import type { InboxView } from "@/lib/inbox/views";

import { deleteSavedViewAction, listSavedViewsAction, saveViewAction, type SavedViewsResult } from "../actions";

/**
 * "Saved views": the person's own shortcuts to a queue plus a search. Opening one switches queue and fills the search box;
 * "Save this view" stores what they are looking at now under a name. The list is read the first time the menu opens, and a
 * failure (for example the feature not being set up yet) shows a plain sentence instead of breaking the list.
 */
export function SavedViewsMenu({
  activeView,
  currentSearch,
  onApply,
}: {
  activeView: InboxView;
  /** The normalised text currently in the search box, or null when there is none. */
  currentSearch: string | null;
  onApply: (view: InboxView, search: string | null) => void;
}) {
  const [views, setViews] = useState<SavedView[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();
  const canSave = currentSearch !== null || activeView !== "all";

  function take(result: SavedViewsResult) {
    if (result.ok) {
      setViews(result.views);
      setMessage(null);
      return true;
    }
    setMessage(result.error);
    return false;
  }

  function opened(open: boolean) {
    if (!open) {
      setNaming(false);
      return;
    }
    if (views) return;
    startTransition(async () => {
      take(await listSavedViewsAction());
    });
  }

  function save() {
    startTransition(async () => {
      if (take(await saveViewAction({ name, view: activeView, search: currentSearch }))) {
        setNaming(false);
        setName("");
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      take(await deleteSavedViewAction({ id }));
    });
  }

  return (
    <DropdownMenu onOpenChange={opened}>
      <DropdownMenuTrigger
        render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Saved views" title="Saved views" />}
      >
        <Bookmark aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {message && (
          <p role="alert" className="px-2 py-1.5 text-xs text-muted-foreground">
            {message}
          </p>
        )}
        {!views && !message && <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</p>}
        {views?.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">No saved views yet.</p>}
        {views?.map((saved) => (
          <div key={saved.id} className="flex items-center gap-1">
            <DropdownMenuItem className="min-w-0 flex-1 flex-col items-start gap-0" onClick={() => onApply(saved.view, saved.search)}>
              <span className="w-full truncate text-sm">{saved.name}</span>
              {saved.search && <span className="w-full truncate text-xs text-muted-foreground">Search: {saved.search}</span>}
            </DropdownMenuItem>
            <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove saved view ${saved.name}`} disabled={isPending} onClick={() => remove(saved.id)}>
              <X />
            </Button>
          </div>
        ))}
        {canSave && (
          <div className="border-t p-2">
            {naming ? (
              <div className="space-y-2" onKeyDown={(event) => event.stopPropagation()}>
                <InputGroup>
                  <InputGroupAddon align="block-start">
                    <InputGroupText>Name this view</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput value={name} maxLength={SAVED_VIEW_NAME_MAX} onChange={(event) => setName(event.target.value)} aria-label="Name this view" autoFocus />
                </InputGroup>
                <div className="flex gap-2">
                  <Button type="button" size="sm" disabled={isPending || !name.trim()} onClick={save}>
                    Save
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => setNaming(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" size="sm" variant="secondary" className="w-full" onClick={() => setNaming(true)}>
                Save this view
              </Button>
            )}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
