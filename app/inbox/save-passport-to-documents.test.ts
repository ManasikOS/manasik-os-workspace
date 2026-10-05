import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BUG-4 (docs/progress/2026-10-05-inbox-security-and-bug-audit.md): two overlapping "Save to Documents" requests used to upload to the same path;
 * the second one's failed submit then removed that path, deleting the file the first had just saved. One request now owns the save, and a failed
 * save never deletes a file the checklist item points at.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ME = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ATTACHMENT = "11111111-1111-4111-8111-111111111111";
const MESSAGE = "22222222-2222-4222-8222-222222222222";
const PILGRIM = "33333333-3333-4333-8333-333333333333";
const GROUP = "44444444-4444-4444-8444-444444444444";
const ITEM = "55555555-5555-4555-8555-555555555555";

vi.mock("@/lib/dal", () => ({ requireUser: async () => ({ id: ME }) }));
const submitGroupPilgrimDocument = vi.fn();
vi.mock("@/lib/data/departure-groups", () => ({
  getCurrentStaffRole: async () => ({ role: "ADMIN", agencyId: AGENCY, staffId: ME, name: "Me" }),
  createGroupBooking: vi.fn(),
  updateGroupPilgrimRecord: vi.fn(),
  submitGroupPilgrimDocument: (...args: unknown[]) => submitGroupPilgrimDocument(...args),
}));
vi.mock("@/lib/data/documents-repository", () => ({ insertReviewEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/inbox/media/context", () => ({ loadInboxMediaContext: async () => ({ travellers: [{ id: PILGRIM }], departureGroupId: GROUP }) }));
vi.mock("@/utils/supabase/server", () => ({ createClient: () => ({}) }));

interface Attachment { id: string; message_id: string; storage_path: string; mime_type: string; promoted_document_id: string | null; expires_at: string | null }
let attachment: Attachment;
let itemFilePath: string | null;
let downloadFails = false;
const uploads: string[] = [];
const removals: string[] = [];

/** A chainable query that remembers its filters and settles to `result(filters)`. */
function query(result: (filters: Record<string, unknown>) => unknown) {
  const filters: Record<string, unknown> = {};
  const q: Record<string, unknown> = {};
  for (const method of ["eq", "is", "or", "select"]) {
    q[method] = (column?: string, value?: unknown) => {
      if (method === "eq" || method === "is") filters[String(column)] = value ?? null;
      if (method === "or") filters.or = column;
      return q;
    };
  }
  q.maybeSingle = async () => result(filters);
  q.then = (resolve: (value: unknown) => unknown) => resolve(result(filters));
  return q;
}

vi.mock("@/utils/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      switch (table) {
        case "message_attachments":
          return {
            select: () => query(() => ({ data: attachment, error: null })),
            update: (patch: Record<string, unknown>) =>
              query((filters) => {
                // The claim, the release and the final mark are conditional updates; only a row matching the filters changes.
                const wantsEmpty = "promoted_document_id" in filters && filters.promoted_document_id === null;
                const wantsOwn = typeof filters.promoted_document_id === "string" && attachment.promoted_document_id === filters.promoted_document_id;
                const ownOrEmpty = typeof filters.or === "string" && (attachment.promoted_document_id === null || String(filters.or).includes(String(attachment.promoted_document_id)));
                if ((wantsEmpty && attachment.promoted_document_id === null) || wantsOwn || ownOrEmpty) {
                  Object.assign(attachment, patch);
                  return { data: [{ id: attachment.id }], error: null };
                }
                return { data: [], error: null };
              }),
          };
        case "message_media_analyses":
          return { select: () => query(() => ({ data: { kind: "PASSPORT", selected_traveller_id: PILGRIM, candidate_traveller_ids: [PILGRIM] }, error: null })) };
        case "conversation_messages":
          return { select: () => query(() => ({ data: { conversation_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }, error: null })) };
        case "departure_group_pilgrims":
          return { select: () => query(() => ({ data: { id: PILGRIM, departure_group_id: GROUP }, error: null })) };
        case "departure_group_pilgrim_documents":
          return {
            select: (columns: string) =>
              query(() =>
                columns === "file_path"
                  ? { data: { file_path: itemFilePath }, error: null }
                  : { data: [{ id: ITEM, status: "NOT_SUBMITTED", document_type: "PASSPORT_BIO" }], error: null },
              ),
          };
        default:
          throw new Error(`Unexpected table ${table}`);
      }
    },
    storage: {
      from: (bucket: string) => ({
        download: async () => (downloadFails ? { data: null, error: { message: "gone" } } : { data: new Blob([new Uint8Array(2048)]), error: null }),
        upload: async (path: string) => {
          uploads.push(`${bucket}/${path}`);
          return { error: null };
        },
        remove: async (paths: string[]) => {
          removals.push(...paths.map((path) => `${bucket}/${path}`));
          return { error: null };
        },
      }),
    },
  }),
}));

import { savePassportToDocumentsAction } from "./actions";

beforeEach(() => {
  attachment = { id: ATTACHMENT, message_id: MESSAGE, storage_path: `${AGENCY}/inbound/passport.jpg`, mime_type: "image/jpeg", promoted_document_id: null, expires_at: "2027-01-01T00:00:00Z" };
  itemFilePath = null;
  downloadFails = false;
  uploads.length = 0;
  removals.length = 0;
  submitGroupPilgrimDocument.mockReset();
  submitGroupPilgrimDocument.mockResolvedValue({ ok: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("savePassportToDocumentsAction", () => {
  it("saves once and marks the attachment saved, clearing its expiry", async () => {
    expect(await savePassportToDocumentsAction({ attachmentId: ATTACHMENT })).toEqual({ ok: true });
    expect(uploads).toHaveLength(1);
    expect(attachment).toMatchObject({ promoted_document_id: ITEM, expires_at: null });
  });

  it("lets only one of two overlapping requests copy the file, and never deletes it", async () => {
    // The second request's submit would fail (the item is already submitted) and, before the fix, remove the first request's file.
    submitGroupPilgrimDocument.mockResolvedValueOnce({ ok: true }).mockResolvedValue({ ok: false, error: "Already submitted." });
    const results = await Promise.all([savePassportToDocumentsAction({ attachmentId: ATTACHMENT }), savePassportToDocumentsAction({ attachmentId: ATTACHMENT })]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ error: expect.stringContaining("already being saved") });
    expect(uploads).toHaveLength(1);
    expect(submitGroupPilgrimDocument).toHaveBeenCalledTimes(1);
    expect(removals).toHaveLength(0);
    expect(attachment.promoted_document_id).toBe(ITEM);
  });

  it("removes its own copy and gives the attachment back when the submit fails and nothing points at the file", async () => {
    submitGroupPilgrimDocument.mockResolvedValue({ ok: false, error: "Could not submit." });
    expect(await savePassportToDocumentsAction({ attachmentId: ATTACHMENT })).toMatchObject({ ok: false });
    expect(removals).toEqual(uploads);
    expect(attachment.promoted_document_id).toBeNull();
  });

  it("keeps the file when the submit fails but the checklist item already points at that very path (another save owns it)", async () => {
    submitGroupPilgrimDocument.mockImplementation(async (input: { filePath: string }) => {
      itemFilePath = input.filePath;
      return { ok: false, error: "Already submitted." };
    });
    expect(await savePassportToDocumentsAction({ attachmentId: ATTACHMENT })).toMatchObject({ ok: false });
    expect(removals).toHaveLength(0);
    expect(attachment.promoted_document_id).toBeNull();
  });

  it("gives the attachment back when the Inbox copy cannot be read, so it can be saved again", async () => {
    downloadFails = true;
    expect(await savePassportToDocumentsAction({ attachmentId: ATTACHMENT })).toMatchObject({ ok: false });
    expect(attachment.promoted_document_id).toBeNull();
    expect(uploads).toHaveLength(0);
  });

  it("treats an attachment that is already saved as done, without copying again", async () => {
    attachment.promoted_document_id = ITEM;
    expect(await savePassportToDocumentsAction({ attachmentId: ATTACHMENT })).toEqual({ ok: true });
    expect(uploads).toHaveLength(0);
  });
});
