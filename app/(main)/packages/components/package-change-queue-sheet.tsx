"use client";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { PackageCapabilities } from "@/lib/access/packages-access";
import type { PackageChangeRequest } from "@/lib/data/packages-repository";

import PackageChangeRequestsPanel from "./package-change-requests-panel";

interface PackageChangeQueueSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requests: PackageChangeRequest[];
  can: Pick<PackageCapabilities, "approvePackageChanges" | "editPackage">;
  currentUserId: string | null;
}

/**
 * Every change to a package that is on sale and is waiting for an administrator's approval, across all packages the person can read (TASK-043).
 * An approver works through this list without opening each package; the requester sees their own requests here too and can withdraw them.
 */
export default function PackageChangeQueueSheet({ open, onOpenChange, requests, can, currentUserId }: PackageChangeQueueSheetProps) {
  const mine = requests.filter((request) => request.requestedBy === currentUserId).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Changes awaiting approval</SheetTitle>
          <SheetDescription>
            {requests.length === 0
              ? "Nothing is waiting."
              : `${requests.length} change${requests.length === 1 ? " is" : "s are"} waiting${mine > 0 ? `, ${mine} asked for by you` : ""}. A change takes effect only when someone else approves it.`}
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-6">
          <PackageChangeRequestsPanel requests={requests} can={can} currentUserId={currentUserId} showPackageName />
        </div>
      </SheetContent>
    </Sheet>
  );
}
