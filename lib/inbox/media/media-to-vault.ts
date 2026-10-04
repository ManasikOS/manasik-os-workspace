/**
 * Saves a customer's brochure or other file from an Inbox conversation into the Document Vault (MED-04). It is an
 * explicit, staff-triggered copy: it never sends the file to a customer or publishes it, and the destination is
 * re-derived on the server from the file's own kind, so a crafted request cannot push a passport or receipt into the
 * vault that every staff role can read. Concurrent or repeated saves converge on one document.
 */
import "server-only";

import { randomUUID } from "node:crypto";

import { vaultInboxMediaPath } from "@/lib/content/vault-storage";
import { INBOX_MEDIA_VAULT_MAX_BYTES, mediaRoutingOptions, type MediaRoutingDestination, type MediaRoutingKind } from "./routing";

export type InboxMediaVaultDestination = Extract<MediaRoutingDestination, "PROPOSAL_COLLATERAL" | "DOCUMENTS">;

export interface InboxMediaVaultSource {
  attachmentId: string;
  conversationId: string;
  kind: MediaRoutingKind;
  storagePath: string | null;
  filename: string | null;
  mimeType: string;
  promotedDocumentId: string | null;
}

export interface InboxMediaVaultDocumentRow {
  id: string;
  agencyId: string;
  category: string;
  title: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  sourceDepartureGroupId: string | null;
  uploadedByName: string;
}

export interface InboxMediaVaultDependencies {
  loadSource(agencyId: string, attachmentId: string): Promise<InboxMediaVaultSource | null>;
  loadDepartureGroupId(agencyId: string, conversationId: string): Promise<string | null>;
  download(storagePath: string): Promise<Uint8Array | null>;
  upload(path: string, bytes: Uint8Array, mimeType: string): Promise<{ ok: boolean }>;
  createDocument(row: InboxMediaVaultDocumentRow): Promise<void>;
  /** Marks the attachment saved only if nothing has claimed it yet. False when another save won. */
  claim(agencyId: string, attachmentId: string, documentId: string): Promise<boolean>;
  currentPromoted(agencyId: string, attachmentId: string): Promise<string | null>;
  removeDocument(documentId: string): Promise<void>;
  removeObject(path: string): Promise<void>;
}

export type InboxMediaVaultResult =
  | { ok: true; documentId: string; alreadySaved: boolean; linkedDepartureGroup: boolean }
  | { ok: false; code: "FORBIDDEN" | "NOT_FOUND" | "NOT_ALLOWED" | "FAILED"; error: string };

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

const NOT_ALLOWED = "This file cannot be saved to Documents.";

function safeFileName(filename: string | null, extension: string): string {
  const cleaned = (filename ?? "").replace(/[^a-zA-Z0-9._ -]+/g, "-").trim().slice(0, 120);
  return cleaned || `file.${extension}`;
}

function titleFor(filename: string | null): string {
  const withoutExtension = (filename ?? "").replace(/\.[a-zA-Z0-9]{1,5}$/, "").replace(/[^a-zA-Z0-9._ -]+/g, " ").trim().slice(0, 200);
  return withoutExtension || "Customer file";
}

export function createInboxMediaVaultSaver(dependencies: InboxMediaVaultDependencies) {
  return {
    async save(input: {
      agencyId: string;
      attachmentId: string;
      destination: InboxMediaVaultDestination;
      canSaveToVault: boolean;
      uploadedByName: string;
    }): Promise<InboxMediaVaultResult> {
      if (!input.canSaveToVault) return { ok: false, code: "FORBIDDEN", error: "Your role cannot save files to Documents." };

      const source = await dependencies.loadSource(input.agencyId, input.attachmentId);
      if (!source) return { ok: false, code: "NOT_FOUND", error: "That attachment could not be found." };
      if (source.promotedDocumentId) {
        return { ok: true, documentId: source.promotedDocumentId, alreadySaved: true, linkedDepartureGroup: false };
      }

      // The same table the screen uses decides what is allowed, evaluated for the file's own kind.
      const decision = mediaRoutingOptions({
        kind: source.kind,
        mimeType: source.mimeType,
        byteSize: INBOX_MEDIA_VAULT_MAX_BYTES,
        hasOriginal: source.storagePath !== null,
        savedDocumentId: null,
        can: { saveToVault: true, openFinanceReview: false, saveToTravellerDocuments: false },
      });
      if (decision.options.find((option) => option.destination === input.destination)?.availability !== "AVAILABLE") {
        return { ok: false, code: "NOT_ALLOWED", error: NOT_ALLOWED };
      }

      const bytes = source.storagePath ? await dependencies.download(source.storagePath) : null;
      if (!bytes) return { ok: false, code: "NOT_ALLOWED", error: "The Inbox copy of this file is no longer available." };
      if (bytes.byteLength < 1 || bytes.byteLength > INBOX_MEDIA_VAULT_MAX_BYTES) {
        return { ok: false, code: "NOT_ALLOWED", error: "This file is too large to save to Documents (10 MB limit)." };
      }

      const extension = EXTENSIONS[source.mimeType.split(";", 1)[0].trim().toLowerCase()];
      if (!extension) return { ok: false, code: "NOT_ALLOWED", error: NOT_ALLOWED };

      const documentId = randomUUID();
      const path = vaultInboxMediaPath({ agencyId: input.agencyId, documentId, extension });
      const departureGroupId = await dependencies.loadDepartureGroupId(input.agencyId, source.conversationId);

      const uploaded = await dependencies.upload(path, bytes, source.mimeType);
      if (!uploaded.ok) return { ok: false, code: "FAILED", error: "The file could not be saved. Try again." };

      try {
        await dependencies.createDocument({
          id: documentId,
          agencyId: input.agencyId,
          category: input.destination === "PROPOSAL_COLLATERAL" ? "Brochure" : "Other",
          title: titleFor(source.filename),
          storagePath: path,
          fileName: safeFileName(source.filename, extension),
          mimeType: source.mimeType.split(";", 1)[0].trim().toLowerCase(),
          fileSizeBytes: bytes.byteLength,
          sourceDepartureGroupId: departureGroupId,
          uploadedByName: input.uploadedByName,
        });
      } catch (cause) {
        console.error("Saving Inbox media to the vault failed:", cause instanceof Error ? cause.name : "unknown");
        await dependencies.removeObject(path).catch(() => undefined);
        return { ok: false, code: "FAILED", error: "The file could not be saved. Try again." };
      }

      if (!(await dependencies.claim(input.agencyId, input.attachmentId, documentId))) {
        // Another save already claimed this attachment: drop our copy and return theirs.
        await dependencies.removeDocument(documentId).catch(() => undefined);
        await dependencies.removeObject(path).catch(() => undefined);
        const winner = await dependencies.currentPromoted(input.agencyId, input.attachmentId);
        return winner
          ? { ok: true, documentId: winner, alreadySaved: true, linkedDepartureGroup: false }
          : { ok: false, code: "FAILED", error: "The file could not be saved. Try again." };
      }
      return { ok: true, documentId, alreadySaved: false, linkedDepartureGroup: departureGroupId !== null };
    },
  };
}
