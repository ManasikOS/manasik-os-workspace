"use client";

import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  capabilitiesFor,
  ROLE_LABELS,
  type StaffRole,
} from "@/lib/access/departure-groups-access";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  BadgeCheck,
  Ban,
  ExternalLink,
  Loader2,
  Upload,
  XCircle,
} from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useState, useTransition } from "react";

import {
  DocumentStatusBadge,
  ProgressBar,
  VisaStatusBadge,
} from "../../components/status-badges";
import {
  rejectDocumentAction,
  submitDocumentAction,
  updatePilgrimRecordAction,
  verifyDocumentAction,
  waiveDocumentAction,
} from "../../actions";
import {
  createDocumentDownloadUrl,
  createDocumentUploadUrl,
} from "../../document-storage";
import type { DepartureGroupManifestRow, PilgrimDocument } from "../../types";
import { DOCUMENT_STAGE_LABELS, formatDate } from "../../utils";
import { Card } from "@/components/ui/card";
import SectionHeading from "@/components/section-heading";
import { DatePicker, DateTimePicker } from "@/components/date-time-picker";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";

interface PilgrimDocumentsDrawerProps {
  row: DepartureGroupManifestRow | null;
  departureGroupId: string;
  role: StaffRole;
  open: boolean;
  onClose: () => void;
}

/**
 * One traveller's actual document checklist.
 *
 * This is the screen the module was missing. The Documents & Visa tab used to
 * show "4 / 8" and two icon buttons — one that marked all eight verified at
 * once and one that decremented the count by one — so the two questions an
 * operator actually has ("which one is missing?" and "why did this come
 * back?") had no answer anywhere in the product. Every document here carries
 * its own status, the stage it blocks, the role that signs it off, the file it
 * was proved with and, when refused, the reason.
 */
const PilgrimDocumentsDrawer = ({
  row,
  departureGroupId,
  role,
  open,
  onClose,
}: PilgrimDocumentsDrawerProps) => {
  const can = capabilitiesFor(role);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PilgrimDocument | null>(null);
  const [reason, setReason] = useState("");
  const [waiving, setWaiving] = useState(false);

  const [passportExpiry, setPassportExpiry] = useState(
    row?.passportExpiry ?? "",
  );
  const [contactName, setContactName] = useState(
    row?.emergencyContactName ?? "",
  );
  const [contactPhone, setContactPhone] = useState(
    row?.emergencyContactPhone ?? "",
  );

  // Keyed on the traveller, not on the `row` object: every action in here
  // refreshes the group, which hands down a fresh `row` with the same id, and
  // re-syncing on that would throw away a next-of-kin the operator had typed
  // but not yet saved.
  useResetOnOpen(open, row?.id ?? "", () => {
    setBusyId(null);
    setRejecting(null);
    setReason("");
    setWaiving(false);
    setPassportExpiry(row?.passportExpiry ?? "");
    setContactName(row?.emergencyContactName ?? "");
    setContactPhone(row?.emergencyContactPhone ?? "");
  });

  const run = (
    id: string,
    work: () => Promise<{ ok: true } | { ok: false; error: string }>,
    successTitle: string,
  ) => {
    setBusyId(id);
    startTransition(async () => {
      try {
        const result = await work();
        if (!result.ok) {
          toast.add({ title: "Could not update", description: result.error });
          return;
        }
        toast.add({ title: successTitle, description: row?.fullName });
        router.refresh();
      } catch {
        // A dropped connection must not leave the row spinning with no way back.
        toast.add({
          title: "Could not update",
          description: "The change did not reach the server. Try again.",
        });
      } finally {
        setBusyId(null);
      }
    });
  };

  /**
   * Uploads straight to the private bucket with a one-shot signed URL, then
   * records the resulting object path. The file never passes through a Server
   * Action body, so a 10 MB passport scan is not serialised through the app.
   */
  const upload = (document: PilgrimDocument, file: File) => {
    if (!row) return;
    setBusyId(document.id);
    startTransition(async () => {
      try {
        const signed = await createDocumentUploadUrl({
          departureGroupId,
          pilgrimId: row.id,
          documentId: document.id,
          contentType: file.type,
          sizeBytes: file.size,
        });
        if (!signed.ok) {
          toast.add({ title: "Upload refused", description: signed.error });
          return;
        }

        const endpoint = `/storage/v1/object/upload/sign/pilgrim-documents/${signed.path}?token=${encodeURIComponent(signed.token)}`;
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}${endpoint}`,
          {
            method: "PUT",
            headers: { "Content-Type": file.type },
            body: file,
          },
        );

        if (!response.ok) {
          toast.add({
            title: "Upload failed",
            description: "The file could not be stored. Try again.",
          });
          return;
        }

        const recorded = await submitDocumentAction({
          documentId: document.id,
          departureGroupId,
          filePath: signed.path,
          fileName: signed.fileName,
          fileSizeBytes: file.size,
        });

        if (!recorded.ok) {
          toast.add({ title: "Could not record", description: recorded.error });
          return;
        }
        toast.add({
          title: "Document received",
          description: `${document.name} — awaiting ${ROLE_LABELS[document.verifiedByRole as StaffRole] ?? document.verifiedByRole} verification.`,
        });
        router.refresh();
      } catch {
        // The PUT to storage is a plain fetch: a dropped connection rejects here
        // rather than returning, and would otherwise leave the row spinning.
        toast.add({
          title: "Upload failed",
          description: "The file could not be stored. Try again.",
        });
      } finally {
        setBusyId(null);
      }
    });
  };

  const openFile = (document: PilgrimDocument) => {
    const path = document.filePath;
    if (!path) return;
    // The tab is claimed synchronously, inside the click, because the signed
    // link takes a server round trip to mint and a `window.open` after an await
    // is no longer attributed to the gesture — every popup blocker swallows it.
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    startTransition(async () => {
      try {
        const link = await createDocumentDownloadUrl(path);
        if (!link.ok) {
          tab?.close();
          toast.add({ title: "Could not open", description: link.error });
          return;
        }
        if (tab) tab.location.replace(link.url);
        else window.open(link.url, "_blank", "noopener,noreferrer");
      } catch {
        tab?.close();
        toast.add({
          title: "Could not open",
          description: "That document could not be reached. Try again.",
        });
      }
    });
  };

  const confirmRejection = () => {
    if (!rejecting) return;
    const document = rejecting;
    const text = reason.trim();
    run(
      document.id,
      async () => {
        const result = waiving
          ? await waiveDocumentAction({
              documentId: document.id,
              departureGroupId,
              reason: text,
            })
          : await rejectDocumentAction({
              documentId: document.id,
              departureGroupId,
              reason: text,
            });
        if (result.ok) {
          setRejecting(null);
          setReason("");
          setWaiving(false);
        }
        return result;
      },
      waiving ? "Requirement waived" : "Document rejected",
    );
  };

  const saveRecord = () => {
    if (!row) return;
    run(
      "record",
      () =>
        updatePilgrimRecordAction({
          id: row.id,
          departureGroupId,
          passportExpiry: passportExpiry || null,
          emergencyContactName: contactName || null,
          emergencyContactPhone: contactPhone || null,
        }),
      "Traveller record updated",
    );
  };

  // Grouped by the gate they block, because that is the order the work
  // actually happens in — and the reason a visa stage arrives or does not.
  const stages = [
    "ON_BOOKING",
    "BEFORE_VISA_SUBMISSION",
    "BEFORE_FINAL_PAYMENT",
    "BEFORE_DEPARTURE",
  ] as const;

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
        <DialogContent className="max-w-3xl!">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5">
              {row?.fullName}
              {row && <VisaStatusBadge value={row.visaStatus} />}
            </DialogTitle>
            <DialogDescription>
              {row?.bookingReference} · {row?.documentsCompleted} of{" "}
              {row?.documentsRequired} requirements verified
            </DialogDescription>
          </DialogHeader>

          {row && (
            <div className="flex flex-col gap-4 max-h-[70vh] overflow-y-auto custom-scroll pr-1">
              <ProgressBar percent={row.documentCompletionPercent} />

              {row.passportValidityIssue && (
                <div className="flex items-start gap-2.5 rounded-md bg-destructive/10 p-3">
                  <AlertTriangle className="size-4 shrink-0 text-destructive mt-0.5" />
                  <p className="text-xs text-destructive">
                    {row.passportValidityIssue}
                  </p>
                </div>
              )}

              {/* The traveller facts three of the requirements are checked
                against. Filling these in clears those requirements rather than
                asking anyone to assert them. */}
              {can.viewSensitiveTravellerData && can.manageDocumentsAndVisa && (
                <Card className="min-h-fit bg-transparent   flex flex-col gap-3">
                  <SectionHeading title=" Traveller record" />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <DatePicker
                      label={"Passport expiry"}
                      value={passportExpiry}
                      onChange={setPassportExpiry}
                    />

                    <InputGroup>
                      <InputGroupAddon align={"block-start"}>
                        <InputGroupText>Contact Name</InputGroupText>
                      </InputGroupAddon>
                      <InputGroupInput
                        id="contact-name"
                        value={contactName}
                        onChange={(e) => setContactName(e.target.value)}
                        placeholder="Mohamed"
                      />
                    </InputGroup>

                    <InputGroup>
                      <InputGroupAddon align={"block-start"}>
                        <InputGroupText>Contact Phone</InputGroupText>
                      </InputGroupAddon>
                      <InputGroupInput
                        id="contact-phone"
                        value={contactPhone}
                        onChange={(e) => setContactPhone(e.target.value)}
                        placeholder="+94 …"
                      />
                    </InputGroup>
                  </div>
                  <div className="justify-end w-full flex">
                    <Button
                      variant="secondary"
                      onClick={saveRecord}
                      disabled={isPending && busyId === "record"}
                    >
                      {isPending && busyId === "record" && (
                        <Loader2 className="animate-spin" />
                      )}
                      Save traveller record
                    </Button>
                  </div>
                </Card>
              )}

              {row.documents.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No document checklist was copied for this traveller&apos;s
                  group.
                </p>
              ) : (
                stages.map((stage) => {
                  const documents = row.documents.filter(
                    (d) => d.requiredByStage === stage,
                  );
                  if (documents.length === 0) return null;

                  return (
                    <div key={stage} className="flex flex-col gap-2">
                      <SectionHeading title={DOCUMENT_STAGE_LABELS[stage]} />
                      {documents.map((document) => (
                        <DocumentRow
                          key={document.id}
                          document={document}
                          role={role}
                          busy={isPending && busyId === document.id}
                          onUpload={(file) => upload(document, file)}
                          onOpen={() => openFile(document)}
                          onVerify={() =>
                            run(
                              document.id,
                              () =>
                                verifyDocumentAction({
                                  documentId: document.id,
                                  departureGroupId,
                                }),
                              "Document verified",
                            )
                          }
                          onReject={() => {
                            setWaiving(false);
                            setReason("");
                            setRejecting(document);
                          }}
                          onWaive={() => {
                            setWaiving(true);
                            setReason("");
                            setRejecting(document);
                          }}
                        />
                      ))}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={rejecting !== null}
        onOpenChange={(next) => {
          if (!next) {
            setRejecting(null);
            setReason("");
            setWaiving(false);
          }
        }}
      >
        <DialogContent className="max-w-md!">
          <DialogHeader>
            <DialogTitle>
              {waiving ? "Waive requirement" : "Reject document"}
            </DialogTitle>
            <DialogDescription>
              {rejecting?.name}
              {waiving
                ? " — say why it does not apply to this traveller."
                : " — the traveller sees this reason, so name the actual problem."}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder={
              waiving
                ? "Infant — no NIC issued."
                : "Scan is cropped; the full bio-page must be visible."
            }
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setRejecting(null);
                setReason("");
                setWaiving(false);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant={waiving ? "secondary" : "destructive"}
              onClick={confirmRejection}
              disabled={reason.trim().length < 3 || isPending}
            >
              {isPending && <Loader2 className="animate-spin" />}
              {waiving ? "Waive" : "Reject"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

function DocumentRow({
  document,
  role,
  busy,
  onUpload,
  onOpen,
  onVerify,
  onReject,
  onWaive,
}: {
  document: PilgrimDocument;
  role: StaffRole;
  busy: boolean;
  onUpload: (file: File) => void;
  onOpen: () => void;
  onVerify: () => void;
  onReject: () => void;
  onWaive: () => void;
}) {
  const can = capabilitiesFor(role);
  // The template names the role that signs each requirement off; Admin may
  // always act, because somebody has to be able to unblock a group.
  const mayVerify =
    can.manageDocumentsAndVisa &&
    (role === "ADMIN" || role === document.verifiedByRole);

  return (
    <Card
      className={cn(
        "flex flex-row shadow-xs bg-transparent items-center gap-3 rounded-md border border-border/40 px-4 py-3",
        document.status === "REJECTED" && "border-destructive/40",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground truncate">{document.name}</p>
        <p className="text-[11px] text-muted-foreground">
          {document.category} · verified by{" "}
          {ROLE_LABELS[document.verifiedByRole as StaffRole] ??
            document.verifiedByRole}
          {document.verifiedAt && document.status === "VERIFIED"
            ? ` · ${document.verifiedByName ?? "Staff"} on ${formatDate(document.verifiedAt)}`
            : ""}
        </p>
        {document.status === "REJECTED" && document.rejectionReason && (
          <p className="text-[11px] text-destructive mt-0.5">
            {document.rejectionReason}
          </p>
        )}
        {document.status === "NOT_APPLICABLE" && document.notes && (
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {document.notes}
          </p>
        )}
      </div>

      <DocumentStatusBadge value={document.status} />

      <div className="flex items-center gap-1">
        {document.filePath && can.viewSensitiveTravellerData && (
          <Button variant="ghost" size="xs" title="Open file" onClick={onOpen}>
            <ExternalLink />
          </Button>
        )}

        {can.manageDocumentsAndVisa &&
          can.viewSensitiveTravellerData &&
          document.status !== "NOT_APPLICABLE" && (
            <label
              className={cn(
                "inline-flex items-center justify-center rounded-md px-2 h-7 cursor-pointer hover:bg-muted/60",
                busy && "pointer-events-none opacity-50",
              )}
              title="Upload file"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              <input
                type="file"
                className="sr-only"
                accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // Reset so re-picking the same file fires change again.
                  e.target.value = "";
                  if (file) onUpload(file);
                }}
              />
            </label>
          )}

        {mayVerify && document.status !== "VERIFIED" && (
          <Button
            variant="ghost"
            size="xs"
            title="Verify"
            disabled={busy}
            onClick={onVerify}
          >
            <BadgeCheck />
          </Button>
        )}
        {mayVerify &&
          document.status !== "NOT_SUBMITTED" &&
          document.status !== "NOT_APPLICABLE" && (
            <Button
              variant="ghost"
              size="xs"
              title="Reject"
              disabled={busy}
              onClick={onReject}
            >
              <XCircle />
            </Button>
          )}
        {mayVerify && document.status !== "NOT_APPLICABLE" && (
          <Button
            variant="ghost"
            size="xs"
            title="Not applicable"
            disabled={busy}
            onClick={onWaive}
          >
            <Ban />
          </Button>
        )}
      </div>
    </Card>
  );
}

export default PilgrimDocumentsDrawer;
