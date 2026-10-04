import { describe, expect, it } from "vitest";

import { emptyPilgrimStore } from "./pilgrims-repository";
import {
  addSupportCaseAttachmentInStore,
  addSupportCaseCommentInStore,
  createSupportRequestInStore,
  escalateSupportRequestInStore,
  linkSupportCaseSupplierInStore,
  removeSupportCaseAttachmentInStore,
  updateSupportRequestStatusInStore,
} from "./pilgrims";
import type { PilgrimRow } from "@/lib/types/pilgrims";

const NOW = "2026-09-01T00:00:00.000Z";

function fixtureStore() {
  const store = emptyPilgrimStore();
  store.pilgrims.push({ id: "pilgrim-1" } as PilgrimRow);
  return store;
}

describe("createSupportRequestInStore", () => {
  it("derives an SLA due date from priority", () => {
    const store = fixtureStore();
    const outcome = createSupportRequestInStore(
      store,
      {
        pilgrimId: "pilgrim-1",
        fields: {
          departureGroupId: null,
          title: "Wheelchair at airport",
          detail: "",
          category: "MOBILITY",
          priority: "URGENT",
          assignedRole: "OPERATIONS",
        },
        actorName: "Staff",
      },
      NOW,
    );
    expect(outcome.ok).toBe(true);
    const request = store.support[0];
    expect(request.sla_due_at).toBe("2026-09-01T04:00:00.000Z"); // URGENT: +4h
    expect(request.escalated_at).toBeNull();
    expect(request.supplier_id).toBeNull();
  });

  it("rejects a request with no title", () => {
    const store = fixtureStore();
    const outcome = createSupportRequestInStore(
      store,
      {
        pilgrimId: "pilgrim-1",
        fields: {
          departureGroupId: null,
          title: "   ",
          detail: "",
          category: "OTHER",
          priority: "NORMAL",
          assignedRole: "OPERATIONS",
        },
        actorName: "Staff",
      },
      NOW,
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("updateSupportRequestStatusInStore", () => {
  it("records a STATUS_CHANGE case event and clears resolved_at on reopen", () => {
    const store = fixtureStore();
    createSupportRequestInStore(
      store,
      {
        pilgrimId: "pilgrim-1",
        fields: { departureGroupId: null, title: "Case", detail: "", category: "OTHER", priority: "NORMAL", assignedRole: "OPERATIONS" },
        actorName: "Staff",
      },
      NOW,
    );
    const requestId = store.support[0].id;

    updateSupportRequestStatusInStore(store, { requestId, status: "RESOLVED", actorName: "Staff" }, NOW);
    expect(store.support[0].resolved_at).toBe(NOW);
    expect(store.caseEvents.at(-1)?.event_type).toBe("STATUS_CHANGE");

    updateSupportRequestStatusInStore(store, { requestId, status: "OPEN", actorName: "Staff" }, NOW);
    expect(store.support[0].resolved_at).toBeNull();
    expect(store.caseEvents.at(-1)?.event_type).toBe("REOPENED");
  });
});

describe("escalateSupportRequestInStore", () => {
  it("bumps priority to HIGH, reassigns, and records an ESCALATED event", () => {
    const store = fixtureStore();
    createSupportRequestInStore(
      store,
      {
        pilgrimId: "pilgrim-1",
        fields: { departureGroupId: null, title: "Case", detail: "", category: "OTHER", priority: "LOW", assignedRole: "OPERATIONS" },
        actorName: "Staff",
      },
      NOW,
    );
    const requestId = store.support[0].id;

    const outcome = escalateSupportRequestInStore(
      store,
      { requestId, toRole: "ADMIN", reason: "Needs finance sign-off", actorName: "Staff" },
      NOW,
    );
    expect(outcome.ok).toBe(true);
    const request = store.support[0];
    expect(request.priority).toBe("HIGH");
    expect(request.escalated_to_role).toBe("ADMIN");
    expect(request.assigned_role).toBe("ADMIN");
    expect(store.caseEvents.some((e) => e.event_type === "ESCALATED")).toBe(true);
  });

  it("never downgrades an already-URGENT case", () => {
    const store = fixtureStore();
    createSupportRequestInStore(
      store,
      {
        pilgrimId: "pilgrim-1",
        fields: { departureGroupId: null, title: "Case", detail: "", category: "OTHER", priority: "URGENT", assignedRole: "OPERATIONS" },
        actorName: "Staff",
      },
      NOW,
    );
    const requestId = store.support[0].id;
    escalateSupportRequestInStore(store, { requestId, toRole: "ADMIN", reason: "x", actorName: "Staff" }, NOW);
    expect(store.support[0].priority).toBe("URGENT");
  });

  it("refuses to escalate a closed case", () => {
    const store = fixtureStore();
    createSupportRequestInStore(
      store,
      {
        pilgrimId: "pilgrim-1",
        fields: { departureGroupId: null, title: "Case", detail: "", category: "OTHER", priority: "NORMAL", assignedRole: "OPERATIONS" },
        actorName: "Staff",
      },
      NOW,
    );
    const requestId = store.support[0].id;
    updateSupportRequestStatusInStore(store, { requestId, status: "RESOLVED", actorName: "Staff" }, NOW);
    const outcome = escalateSupportRequestInStore(store, { requestId, toRole: "ADMIN", reason: "x", actorName: "Staff" }, NOW);
    expect(outcome.ok).toBe(false);
  });
});

describe("addSupportCaseCommentInStore", () => {
  it("adds a COMMENT event without changing status", () => {
    const store = fixtureStore();
    createSupportRequestInStore(
      store,
      {
        pilgrimId: "pilgrim-1",
        fields: { departureGroupId: null, title: "Case", detail: "", category: "OTHER", priority: "NORMAL", assignedRole: "OPERATIONS" },
        actorName: "Staff",
      },
      NOW,
    );
    const requestId = store.support[0].id;
    const outcome = addSupportCaseCommentInStore(store, { requestId, message: "Called the hotel.", actorName: "Staff" }, NOW);
    expect(outcome.ok).toBe(true);
    expect(store.support[0].status).toBe("OPEN");
    expect(store.caseEvents[0]).toMatchObject({ event_type: "COMMENT", message: "Called the hotel." });
  });

  it("rejects an empty comment", () => {
    const store = fixtureStore();
    createSupportRequestInStore(
      store,
      {
        pilgrimId: "pilgrim-1",
        fields: { departureGroupId: null, title: "Case", detail: "", category: "OTHER", priority: "NORMAL", assignedRole: "OPERATIONS" },
        actorName: "Staff",
      },
      NOW,
    );
    const requestId = store.support[0].id;
    const outcome = addSupportCaseCommentInStore(store, { requestId, message: "   ", actorName: "Staff" }, NOW);
    expect(outcome.ok).toBe(false);
  });
});

describe("linkSupportCaseSupplierInStore", () => {
  it("links and clears a supplier, recording a SUPPLIER_LINKED event each time", () => {
    const store = fixtureStore();
    createSupportRequestInStore(
      store,
      {
        pilgrimId: "pilgrim-1",
        fields: { departureGroupId: null, title: "Case", detail: "", category: "OTHER", priority: "NORMAL", assignedRole: "OPERATIONS" },
        actorName: "Staff",
      },
      NOW,
    );
    const requestId = store.support[0].id;

    linkSupportCaseSupplierInStore(store, { requestId, supplierId: "sup-1", supplierName: "ABC Hotels", actorName: "Staff" }, NOW);
    expect(store.support[0].supplier_id).toBe("sup-1");

    linkSupportCaseSupplierInStore(store, { requestId, supplierId: null, supplierName: null, actorName: "Staff" }, NOW);
    expect(store.support[0].supplier_id).toBeNull();
    expect(store.caseEvents.filter((e) => e.event_type === "SUPPLIER_LINKED")).toHaveLength(2);
  });
});

describe("addSupportCaseAttachmentInStore / removeSupportCaseAttachmentInStore", () => {
  it("records an attachment and logs an ATTACHMENT_ADDED event", () => {
    const store = fixtureStore();
    createSupportRequestInStore(
      store,
      {
        pilgrimId: "pilgrim-1",
        fields: { departureGroupId: null, title: "Case", detail: "", category: "OTHER", priority: "NORMAL", assignedRole: "OPERATIONS" },
        actorName: "Staff",
      },
      NOW,
    );
    const requestId = store.support[0].id;

    const outcome = addSupportCaseAttachmentInStore(
      store,
      {
        requestId,
        filePath: "agency-1/support-cases/pilgrim-1/req-1/file.pdf",
        fileName: "hotel-email.pdf",
        contentType: "application/pdf",
        sizeBytes: 1024,
        actorName: "Staff",
      },
      NOW,
    );
    expect(outcome.ok).toBe(true);
    expect(store.caseAttachments).toHaveLength(1);
    expect(store.caseAttachments[0]).toMatchObject({ file_name: "hotel-email.pdf", pilgrim_id: "pilgrim-1" });
    expect(store.caseEvents.some((e) => e.event_type === "ATTACHMENT_ADDED")).toBe(true);
  });

  it("fails to attach a file to a request that does not exist", () => {
    const store = fixtureStore();
    const outcome = addSupportCaseAttachmentInStore(
      store,
      { requestId: "nope", filePath: "x", fileName: "x.pdf", contentType: "application/pdf", sizeBytes: 1, actorName: "Staff" },
      NOW,
    );
    expect(outcome.ok).toBe(false);
  });

  it("removes an attachment, returns its filePath, and logs an ATTACHMENT_REMOVED event", () => {
    const store = fixtureStore();
    createSupportRequestInStore(
      store,
      {
        pilgrimId: "pilgrim-1",
        fields: { departureGroupId: null, title: "Case", detail: "", category: "OTHER", priority: "NORMAL", assignedRole: "OPERATIONS" },
        actorName: "Staff",
      },
      NOW,
    );
    const requestId = store.support[0].id;
    const added = addSupportCaseAttachmentInStore(
      store,
      { requestId, filePath: "path/to/file.pdf", fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 10, actorName: "Staff" },
      NOW,
    );
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    const removed = removeSupportCaseAttachmentInStore(store, { attachmentId: added.result.id, requestId, actorName: "Staff" }, NOW);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.filePath).toBe("path/to/file.pdf");
    expect(store.caseAttachments).toHaveLength(0);
    expect(store.caseEvents.some((e) => e.event_type === "ATTACHMENT_REMOVED")).toBe(true);
  });

  it("fails to remove an attachment that does not exist", () => {
    const store = fixtureStore();
    const outcome = removeSupportCaseAttachmentInStore(store, { attachmentId: "nope", requestId: "nope", actorName: "Staff" }, NOW);
    expect(outcome.ok).toBe(false);
  });
});
