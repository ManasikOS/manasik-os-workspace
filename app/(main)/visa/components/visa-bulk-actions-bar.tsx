"use client";

import { CalendarCheck, Download, UserPlus } from "lucide-react";
import React, { useState } from "react";

import { Button } from "@/components/ui/button";

import { visaApplicationsToManifestCsv, downloadTextFile, timestampedFilename } from "../csv";
import type { VisaCapabilities, VisaListItem } from "../types";
import AssignOfficerDialog from "./assign-officer-dialog";
import StatusCheckDialog from "./status-check-dialog";

interface VisaBulkActionsBarProps {
  selected: VisaListItem[];
  clear: () => void;
  can: VisaCapabilities;
}

const VisaBulkActionsBar = ({ selected, clear, can }: VisaBulkActionsBarProps) => {
  const [assignOpen, setAssignOpen] = useState(false);
  const [statusCheckOpen, setStatusCheckOpen] = useState(false);

  const ids = selected.map((s) => s.journeyId);

  const exportManifest = () => {
    downloadTextFile(timestampedFilename("visa-applicant-manifest"), visaApplicationsToManifestCsv(selected));
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {can.assignOfficer && (
        <Button variant="outline_without_border" size="sm" onClick={() => setAssignOpen(true)}>
          <UserPlus /> Assign Officer
        </Button>
      )}
      {can.recordStatusCheck && (
        <Button variant="outline_without_border" size="sm" onClick={() => setStatusCheckOpen(true)}>
          <CalendarCheck /> Record Status Check
        </Button>
      )}
      {can.exportSubmissionPack && (
        <Button variant="ghost" size="sm" onClick={exportManifest}>
          <Download /> Export Manifest
        </Button>
      )}

      <AssignOfficerDialog
        journeyIds={ids}
        itemsLabel={`${ids.length} application(s) selected`}
        open={assignOpen}
        onClose={() => {
          setAssignOpen(false);
          clear();
        }}
      />
      <StatusCheckDialog
        journeyIds={ids}
        itemsLabel={`${ids.length} application(s) selected`}
        open={statusCheckOpen}
        onClose={() => {
          setStatusCheckOpen(false);
          clear();
        }}
      />
    </div>
  );
};

export default VisaBulkActionsBar;
