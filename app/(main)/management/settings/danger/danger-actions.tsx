"use client";

import { Archive, Download, ShieldOff, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { SelectDropdown } from "../components/select-dropdown";

import {
  archiveBranchConfirmAction,
  requestFullExportAction,
  resetAgencyDataAction,
  setPortalActiveAction,
} from "../actions";
import { RESET_AGENCY_DATA_PHRASE } from "@/lib/validations/settings";
import { ConfirmDangerDialog } from "./confirm-danger-dialog";

interface BranchOption {
  id: string;
  name: string;
  code: string;
}

type DangerAction =
  | "ARCHIVE_BRANCH"
  | "TOGGLE_PORTAL"
  | "EXPORT_ALL"
  | "RESET_ALL_DATA"
  | null;

export function DangerActions({
  branches,
  portalActive,
}: {
  branches: BranchOption[];
  portalActive: boolean;
}) {
  const [pending, setPending] = useState<DangerAction>(null);
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const isDev = process.env.NODE_ENV !== "production";

  const selectedBranch = branches.find((b) => b.id === branchId);

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex-row items-center justify-between gap-4 py-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground flex items-center gap-1.5">
            <Archive className="size-4" /> Archive Branch
          </span>
          <span className="text-xs text-muted-foreground">
            Stops new bookings from this branch.
          </span>
          {branches.length > 0 && (
            <div className="mt-2 max-w-xs">
              <SelectDropdown
                label=""
                value={branchId}
                onChange={setBranchId}
                options={branches.map((b) => ({
                  value: b.id,
                  label: `${b.name} (${b.code})`,
                }))}
              />
            </div>
          )}
        </div>
        <Button
          variant="destructive"
          size="sm"
          disabled={!selectedBranch}
          onClick={() => setPending("ARCHIVE_BRANCH")}
        >
          Archive Branch
        </Button>
      </Card>

      <Card className="flex-row items-center justify-between gap-4 py-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground flex items-center gap-1.5">
            <ShieldOff className="size-4" /> Deactivate Agency Portal
          </span>
          <span className="text-xs text-muted-foreground">
            {portalActive
              ? "Pilgrims cannot access the portal once this is off."
              : "The portal is currently deactivated."}
          </span>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setPending("TOGGLE_PORTAL")}
        >
          {portalActive ? "Deactivate Portal" : "Reactivate Portal"}
        </Button>
      </Card>

      <Card className="flex-row items-center justify-between gap-4 py-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground flex items-center gap-1.5">
            <Download className="size-4" /> Export All Agency Data
          </span>
          <span className="text-xs text-muted-foreground">
            Creates a full export. Requires Admin confirmation.
          </span>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setPending("EXPORT_ALL")}
        >
          Request Export
        </Button>
      </Card>

      <Card className="flex-row items-center justify-between gap-4 py-4 border-destructive/40">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground flex items-center gap-1.5">
            <Trash2 className="size-4 text-destructive" /> Reset to Factory
            State
          </span>
          <span className="text-xs text-muted-foreground max-w-md">
            {isDev
              ? "Permanently deletes every package, departure group, pilgrim, booking, payment, supplier, lead, visa record and activity log for this agency — as if the software were freshly installed. Staff logins, agency settings, branches and templates are kept. There is no undo."
              : "Only available in development or demo environments — disabled here because this is a production build."}
          </span>
        </div>
        <Button
          variant="destructive"
          size="sm"
          disabled={!isDev}
          onClick={() => setPending("RESET_ALL_DATA")}
        >
          Reset to Factory State
        </Button>
      </Card>

      {pending === "ARCHIVE_BRANCH" && selectedBranch && (
        <ConfirmDangerDialog
          open
          title={`Archive ${selectedBranch.name}?`}
          description="Stops new bookings from this branch. Blocked if the branch has active departure groups. This can be reversed by an Admin later."
          confirmLabel="Archive Branch"
          expectedText={selectedBranch.code}
          expectedHint={`Type the branch code (${selectedBranch.code}) to confirm.`}
          onClose={() => setPending(null)}
          onConfirm={async (typed) => {
            const result = await archiveBranchConfirmAction({
              branchId: selectedBranch.id,
              confirmCode: typed,
            });
            if (result.ok) {
              toast.add({ title: "Branch archived" });
            }
            return result;
          }}
        />
      )}

      {pending === "TOGGLE_PORTAL" && (
        <ConfirmDangerDialog
          open
          title={
            portalActive
              ? "Deactivate the pilgrim portal?"
              : "Reactivate the pilgrim portal?"
          }
          description={
            portalActive
              ? "Pilgrims will immediately lose access to the portal. This can be reversed at any time."
              : "Pilgrims will regain access to the portal."
          }
          confirmLabel={
            portalActive ? "Deactivate Portal" : "Reactivate Portal"
          }
          expectedText="CONFIRM"
          expectedHint="Type CONFIRM to proceed."
          onClose={() => setPending(null)}
          onConfirm={async (typed) => {
            const result = await setPortalActiveAction({
              active: !portalActive,
              confirmText: typed,
            });
            if (result.ok) {
              toast.add({
                title: portalActive
                  ? "Portal deactivated"
                  : "Portal reactivated",
              });
            }
            return result;
          }}
        />
      )}

      {pending === "RESET_ALL_DATA" && (
        <ConfirmDangerDialog
          open
          title="Reset this agency to a factory state?"
          description={`This permanently deletes every package, departure group, pilgrim, booking, payment, supplier, lead, visa record, and activity/conversation log for this agency. Staff logins, agency settings, branches and templates are kept, so you can start using it again immediately. This cannot be undone — there is no backup taken by this action.`}
          confirmLabel="Delete Everything"
          expectedText={RESET_AGENCY_DATA_PHRASE}
          expectedHint={`Type ${RESET_AGENCY_DATA_PHRASE} to confirm.`}
          onClose={() => setPending(null)}
          onConfirm={async (typed) => {
            const result = await resetAgencyDataAction({ confirmText: typed });
            if (result.ok) {
              toast.add({
                title: "Agency data reset",
                description:
                  result.totalRowsDeleted !== undefined
                    ? `${result.totalRowsDeleted} row${result.totalRowsDeleted === 1 ? "" : "s"} deleted. The agency is ready to use as new.`
                    : "The agency is ready to use as new.",
              });
            }
            return result;
          }}
        />
      )}

      {pending === "EXPORT_ALL" && (
        <ConfirmDangerDialog
          open
          title="Request a full agency data export?"
          description="Logs a request for an Admin-reviewed export of all agency data. This does not download a file immediately."
          confirmLabel="Request Export"
          expectedText="CONFIRM"
          expectedHint="Type CONFIRM to proceed."
          onClose={() => setPending(null)}
          onConfirm={async (typed) => {
            const result = await requestFullExportAction({
              confirmText: typed,
            });
            if (result.ok)
              toast.add({
                title: "Export requested",
                description: "An Admin will be notified.",
              });
            return result;
          }}
        />
      )}
    </div>
  );
}
