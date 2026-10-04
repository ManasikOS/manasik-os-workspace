import { EmptyState } from "@/components/ui/tone-badge";
import { Bookmark } from "lucide-react";

export default function SavedTab() {
  return (
    <EmptyState
      icon={<Bookmark className="size-8" />}
      title="No saved reports yet"
      description="Reports you run repeatedly can be saved here for one-click access, sharing, and scheduling."
    />
  );
}
