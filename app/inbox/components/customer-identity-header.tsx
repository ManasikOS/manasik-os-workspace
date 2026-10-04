import { Badge } from "@/components/ui/badge";

/**
 * Who this customer is, pinned to the top of the customer panel so it stays visible while the sections below scroll.
 * It is deliberately small: a name, the reference, and two badges. Contact details sit just under it.
 */
export function CustomerIdentityHeader({
  fullName,
  reference,
  stage,
  preferredLanguage,
}: {
  fullName: string;
  reference: string;
  stage: string;
  preferredLanguage: string | null;
}) {
  return (
    <header className="sticky top-0 z-10 space-y-1.5 bg-card px-4 pb-3 pt-4">
      <div className="min-w-0">
        <h2 className="truncate text-base font-medium">{fullName}</h2>
        <p className="text-xs text-muted-foreground">{reference}</p>
      </div>
      <div className="flex flex-wrap gap-1">
        <Badge variant="outline">{stage.replaceAll("_", " ")}</Badge>
        {preferredLanguage && (
          <Badge variant="outline">{preferredLanguage}</Badge>
        )}
      </div>
    </header>
  );
}
