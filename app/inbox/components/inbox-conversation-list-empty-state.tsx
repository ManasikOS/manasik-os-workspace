import { SearchX, Inbox } from "lucide-react";

import { Button } from "@/components/ui/button";
import { emptyViewCopy } from "@/lib/inbox/empty-view-copy";
import type { InboxView } from "@/lib/inbox/views";

/**
 * What the chat list says when it has no rows: for a search, which words found nothing and a way to clear them; for a
 * queue, what the queue is for and why it is empty. Never a bare "no results".
 */
export function InboxConversationListEmptyState({
  activeView,
  searchText,
  onClearSearch,
}: {
  activeView: InboxView;
  /** The words being searched, or null when the list is simply empty. */
  searchText: string | null;
  onClearSearch: () => void;
}) {
  const copy = emptyViewCopy(activeView);
  const Icon = searchText ? SearchX : Inbox;
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-2 px-6 py-12 text-center"
    >
      <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      {searchText ? (
        <>
          <p className="text-sm font-medium">
            No conversations match “{searchText}”
          </p>
          <p className="text-xs text-muted-foreground">
            Check the spelling, or search by a phone number or a lead reference.
          </p>
          <Button
            type="button"
            variant="outline_without_border"
            size="sm"
            className="mt-1"
            onClick={onClearSearch}
          >
            Clear search
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm font-medium">{copy.title}</p>
          <p className="text-xs text-muted-foreground">{copy.hint}</p>
        </>
      )}
    </div>
  );
}
