"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CalendarCheck,
  CornerDownLeft,
  FileText,
  Handshake,
  Loader2,
  MessageSquare,
  Package,
  PlaneTakeoff,
  Search,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import { searchEverythingInHeaderAction } from "@/lib/search/global-search-actions";
import {
  GLOBAL_SEARCH_GROUP_LABELS,
  GLOBAL_SEARCH_GROUPS,
  type GlobalSearchGroup,
  type GlobalSearchHit,
  type GlobalSearchPage,
} from "@/lib/search/global-search-types";
import { GLOBAL_SEARCH_MIN_CHARS } from "@/lib/validations/global-search";

const SEARCH_TYPING_PAUSE_MS = 250;

const GROUP_ICONS: Record<GlobalSearchGroup, LucideIcon> = {
  lead: MessageSquare,
  pilgrim: UserRound,
  booking: CalendarCheck,
  departure_group: PlaneTakeoff,
  package: Package,
  supplier: Handshake,
  invoice: Wallet,
  team_member: Users,
};

/** One selectable row, whether it is a page or a record. */
interface SearchRow {
  key: string;
  href: string;
  title: string;
  subtitle: string;
  Icon: LucideIcon;
}

interface SearchSection {
  heading: string;
  rows: SearchRow[];
}

function pageRowFor(page: GlobalSearchPage): SearchRow {
  return {
    key: `page:${page.href}`,
    href: page.href,
    title: page.title,
    subtitle: "Open page",
    Icon: FileText,
  };
}

function hitRowFor(hit: GlobalSearchHit): SearchRow {
  return {
    key: `${hit.group}:${hit.id}`,
    href: hit.href,
    title: hit.title,
    subtitle: hit.subtitle,
    Icon: GROUP_ICONS[hit.group],
  };
}

/**
 * Header search that looks across leads, pilgrims, bookings, departure
 * groups, packages, suppliers, invoices and team members, plus the pages the
 * person can open. Choosing a result goes straight to that record.
 * Opens with the button or Ctrl/⌘ + K.
 */
export function HeaderGlobalSearch({
  searchablePages,
}: {
  searchablePages: GlobalSearchPage[];
}) {
  const router = useRouter();
  const listboxId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [typedText, setTypedText] = useState("");
  const [recordHits, setRecordHits] = useState<GlobalSearchHit[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const latestRequestRef = useRef(0);
  const highlightedRowRef = useRef<HTMLButtonElement | null>(null);

  const trimmedText = typedText.trim();
  const canSearchRecords = trimmedText.length >= GLOBAL_SEARCH_MIN_CHARS;

  const closeAndReset = useCallback(() => {
    setIsOpen(false);
    setTypedText("");
    setRecordHits([]);
    setIsSearching(false);
    setSearchFailed(false);
    setHighlightedIndex(0);
    latestRequestRef.current += 1;
  }, []);

  // Ctrl/⌘ + K from anywhere in the app.
  useEffect(() => {
    function openOnShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsOpen((wasOpen) => !wasOpen);
      }
    }
    window.addEventListener("keydown", openOnShortcut);
    return () => window.removeEventListener("keydown", openOnShortcut);
  }, []);

  // Look up records after the person pauses typing; a slower, older answer never overwrites a newer one.
  useEffect(() => {
    if (!isOpen || !canSearchRecords) return;
    const requestNumber = ++latestRequestRef.current;
    const pause = setTimeout(async () => {
      setIsSearching(true);
      setSearchFailed(false);
      try {
        const result = await searchEverythingInHeaderAction({
          query: trimmedText,
        });
        if (requestNumber !== latestRequestRef.current) return;
        if (result.ok) setRecordHits(result.data);
        else setSearchFailed(true);
      } catch {
        if (requestNumber === latestRequestRef.current) setSearchFailed(true);
      } finally {
        if (requestNumber === latestRequestRef.current) setIsSearching(false);
      }
    }, SEARCH_TYPING_PAUSE_MS);
    return () => clearTimeout(pause);
  }, [isOpen, canSearchRecords, trimmedText]);

  const sections = useMemo<SearchSection[]>(() => {
    const lowered = trimmedText.toLowerCase();
    const matchingPages = lowered
      ? searchablePages.filter((page) =>
          `${page.title} ${page.keywords}`.toLowerCase().includes(lowered),
        )
      : searchablePages;

    const result: SearchSection[] = [];
    if (canSearchRecords) {
      for (const group of GLOBAL_SEARCH_GROUPS) {
        const rows = recordHits
          .filter((hit) => hit.group === group)
          .map(hitRowFor);
        if (rows.length > 0)
          result.push({ heading: GLOBAL_SEARCH_GROUP_LABELS[group], rows });
      }
    }
    if (matchingPages.length > 0) {
      result.push({
        heading: lowered ? "Pages" : "Jump to a page",
        rows: matchingPages.slice(0, lowered ? 5 : 8).map(pageRowFor),
      });
    }
    return result;
  }, [trimmedText, canSearchRecords, recordHits, searchablePages]);

  const flatRows = useMemo(
    () => sections.flatMap((section) => section.rows),
    [sections],
  );
  const activeIndex = Math.min(
    highlightedIndex,
    Math.max(flatRows.length - 1, 0),
  );
  const activeRow = flatRows[activeIndex];

  useEffect(() => {
    highlightedRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, flatRows]);

  function openRow(row: SearchRow) {
    closeAndReset();
    router.push(row.href);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (flatRows.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((activeIndex + 1) % flatRows.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex(
        (activeIndex - 1 + flatRows.length) % flatRows.length,
      );
    } else if (event.key === "Enter" && activeRow) {
      event.preventDefault();
      openRow(activeRow);
    }
  }

  const showNothingFound =
    canSearchRecords && !isSearching && !searchFailed && flatRows.length === 0;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setIsOpen(true)}
        aria-label="Search everything"
        aria-keyshortcuts="Control+K Meta+K"
        className="h-9 w-full  max-w-md justify-start gap-2 rounded-sm bg-card/50 px-3 font-normal text-muted-foreground hover:text-foreground"
      >
        <Search className="size-4 shrink-0" />
        <span className="truncate hidden md:block">
          Search leads, pilgrims, bookings…
        </span>
        <kbd className="ml-auto hidden rounded-sm border border-border/60 bg-muted/50 px-1.5 py-0.5 font-sans text-xs text-muted-foreground md:inline">
          Ctrl K
        </kbd>
      </Button>

      <Dialog
        open={isOpen}
        onOpenChange={(nextOpen) =>
          nextOpen ? setIsOpen(true) : closeAndReset()
        }
      >
        <DialogContent
          showCloseButton={false}
          className="top-[20%] gap-0 p-0 sm:max-w-xl translate-y-0"
        >
          <DialogTitle className="sr-only">Search everything</DialogTitle>
          <DialogDescription className="sr-only">
            Search leads, pilgrims, bookings, departure groups, packages,
            suppliers, invoices, team members and pages.
          </DialogDescription>

          <div className="border-b border-muted-foreground/10 p-3">
            <InputGroup className="">
              <InputGroupAddon align="block-start">
                <InputGroupText>Search everything</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                autoFocus
                value={typedText}
                onChange={(event) => {
                  setTypedText(event.target.value);
                  setHighlightedIndex(0);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Name, phone, reference, code or invoice number"
                role="combobox"
                aria-expanded="true"
                aria-controls={listboxId}
                aria-activedescendant={
                  activeRow ? `${listboxId}-${activeIndex}` : undefined
                }
                autoComplete="on"
                className="h-10"
              />
            </InputGroup>
          </div>

          <div
            id={listboxId}
            role="listbox"
            aria-label="Search results"
            className="custom-scroll max-h-96 overflow-y-auto p-2"
          >
            {sections.map((section) => (
              <div
                key={section.heading}
                role="group"
                aria-label={section.heading}
                className="pb-1"
              >
                <p className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                  {section.heading}
                </p>
                {section.rows.map((row) => {
                  const rowIndex = flatRows.indexOf(row);
                  const isActive = rowIndex === activeIndex;
                  return (
                    <button
                      key={row.key}
                      type="button"
                      role="option"
                      id={`${listboxId}-${rowIndex}`}
                      aria-selected={isActive}
                      ref={isActive ? highlightedRowRef : undefined}
                      onMouseMove={() => setHighlightedIndex(rowIndex)}
                      onClick={() => openRow(row)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left outline-none transition-colors",
                        isActive ? "bg-muted" : "hover:bg-muted/60",
                      )}
                    >
                      <row.Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {row.title}
                        </span>
                        {row.subtitle && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {row.subtitle}
                          </span>
                        )}
                      </span>
                      {isActive && (
                        <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))}

            {isSearching && (
              <p
                className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground"
                role="status"
              >
                <Loader2 className="size-4 animate-spin" /> Searching…
              </p>
            )}
            {searchFailed && (
              <p className="px-2 py-3 text-sm text-destructive" role="alert">
                Search could not finish. Check your connection and try again.
              </p>
            )}
            {showNothingFound && (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                No records match “{trimmedText}”. Try a name, phone number or
                reference.
              </p>
            )}
            {!canSearchRecords && trimmedText.length > 0 && (
              <p className="px-2 py-2 text-xs text-muted-foreground">
                Type at least {GLOBAL_SEARCH_MIN_CHARS} characters to search
                records.
              </p>
            )}
          </div>

          <div className="flex items-center gap-4 border-t border-muted-foreground/10 px-4 py-2 text-xs text-muted-foreground">
            <span>↑ ↓ to move</span>
            <span>Enter to open</span>
            <span>Esc to close</span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
