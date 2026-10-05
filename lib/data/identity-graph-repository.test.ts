import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { confirmIdentityLink, loadProposalsForConversation, recordIdentityKeptSeparate, recordProposals, rejectIdentityLinks, restoreRejectedIdentityLinks, unlinkIdentityLink } = await import("./identity-graph-repository");

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_AGENCY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACTOR = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

type Row = Record<string, unknown>;

/** A tiny in-memory stand-in for the tables the graph touches, honouring `eq` filters, upsert-ignore-duplicates and a write log. */
function fakeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  const writes: Array<{ table: string; op: string; payload: unknown }> = [];
  let counter = 0;

  function from(table: string) {
    const rows = (tables[table] ??= []);
    const filters: Array<[string, unknown]> = [];
    let op: "select" | "update" | "insert" | "upsert" = "select";
    let payload: Row | Row[] = {};
    let ignoreDuplicates = false;
    let onConflict: string[] = [];
    let wantsRows = false;
    let single: "one" | "maybe" | null = null;

    const matching = () => rows.filter((row) => filters.every(([column, value]) => (Array.isArray(value) ? value.includes(row[column]) : row[column] === value)));

    function run(): { data: unknown; error: null } {
      if (op === "select") return { data: single ? (matching()[0] ?? null) : matching(), error: null };
      if (op === "update") {
        writes.push({ table, op, payload });
        const changed = matching();
        for (const row of changed) Object.assign(row, payload);
        return { data: wantsRows ? changed : null, error: null };
      }
      const incoming: Row[] = (Array.isArray(payload) ? payload : [payload]).map((row) => ({ id: `${table}-${++counter}`, ...row }));
      const created: Row[] = [];
      for (const row of incoming) {
        const existing = onConflict.length ? rows.find((candidate) => onConflict.every((column) => candidate[column] === row[column])) : undefined;
        if (existing) {
          if (op === "upsert" && !ignoreDuplicates) Object.assign(existing, row, { id: existing.id });
          if (single) created.push(existing);
          continue;
        }
        rows.push(row);
        created.push(row);
      }
      writes.push({ table, op, payload });
      return { data: single ? (created[0] ?? null) : created, error: null };
    }

    const builder: Record<string, unknown> = {
      select: () => {
        wantsRows = true;
        return builder;
      },
      eq: (column: string, value: unknown) => (filters.push([column, value]), builder),
      in: (column: string, value: unknown[]) => (filters.push([column, value]), builder),
      order: () => builder,
      limit: () => builder,
      or: () => builder,
      update: (patch: Row) => ((op = "update"), (payload = patch), builder),
      insert: (rowsIn: Row | Row[]) => ((op = "insert"), (payload = rowsIn), builder),
      upsert: (rowsIn: Row | Row[], options: { onConflict?: string; ignoreDuplicates?: boolean } = {}) => {
        op = "upsert";
        payload = rowsIn;
        ignoreDuplicates = options.ignoreDuplicates ?? false;
        onConflict = (options.onConflict ?? "").split(",").filter(Boolean);
        return builder;
      },
      maybeSingle: () => ((single = "maybe"), builder),
      single: () => ((single = "one"), builder),
      then: (resolve: (value: unknown) => unknown) => resolve(run()),
    };
    return builder;
  }

  return { db: { from } as never, tables, writes };
}

const seed = () => ({
  conversations: [{ id: "conv-1", agency_id: AGENCY, lead_id: null, channel: "WHATSAPP", external_conversation_id: "94712223333" }],
  contact_identities: [{ id: "ident-1", agency_id: AGENCY, provider: "WHATSAPP", external_subject_id: "94712223333", lead_id: null, match_confidence: "UNRESOLVED" }],
  leads: [
    { id: "lead-ig", agency_id: AGENCY, reference: "LD-1", full_name: "Fathima Rizvi", mobile: "", stage: "NEW_LEAD" },
    { id: "lead-other", agency_id: AGENCY, reference: "LD-2", full_name: "Fathima R", mobile: "", stage: "NEW_LEAD" },
  ],
  contact_identity_links: [] as Row[],
  identity_match_events: [] as Row[],
});

const candidate = (leadId: string, score = 0.7) => ({ leadId, score, band: "MEDIUM" as const, signals: ["NAME_EXACT" as const], reasons: ["Same full name."], autoConfirm: false });

describe("recordProposals", () => {
  it("writes PROPOSED edges and an audit event, and creates or changes no lead", async () => {
    const { db, tables, writes } = fakeDb(seed());
    expect(await recordProposals(db, { agencyId: AGENCY, subjectIdentityId: "ident-1", candidates: [candidate("lead-ig")] })).toBe(1);
    expect(tables.contact_identity_links[0]).toMatchObject({ agency_id: AGENCY, subject_identity_id: "ident-1", candidate_lead_id: "lead-ig", status: "PROPOSED", proposed_by: "SYSTEM" });
    expect(tables.identity_match_events[0]).toMatchObject({ action: "AMBIGUOUS", next_lead_id: "lead-ig" });
    expect(writes.filter((write) => write.table === "leads")).toEqual([]);
  });

  it("is idempotent: the next message proposes nothing new", async () => {
    const { db, tables } = fakeDb(seed());
    await recordProposals(db, { agencyId: AGENCY, subjectIdentityId: "ident-1", candidates: [candidate("lead-ig")] });
    expect(await recordProposals(db, { agencyId: AGENCY, subjectIdentityId: "ident-1", candidates: [candidate("lead-ig")] })).toBe(0);
    expect(tables.contact_identity_links).toHaveLength(1);
    expect(tables.identity_match_events).toHaveLength(1);
  });

  it("only exact matches may auto-confirm, so an autoConfirm candidate is never written as a proposal", async () => {
    const { db, tables } = fakeDb(seed());
    expect(await recordProposals(db, { agencyId: AGENCY, subjectIdentityId: "ident-1", candidates: [{ ...candidate("lead-ig"), autoConfirm: true }] })).toBe(0);
    expect(tables.contact_identity_links).toEqual([]);
  });
});

describe("confirming a link links identities and never merges leads", () => {
  async function proposed() {
    const fake = fakeDb(seed());
    await recordProposals(fake.db, { agencyId: AGENCY, subjectIdentityId: "ident-1", candidates: [candidate("lead-ig"), candidate("lead-other", 0.55)] });
    const [first] = fake.tables.contact_identity_links;
    return { ...fake, linkId: first.id as string };
  }

  it("points the identity and the conversation at the lead, records who and what came before, and audits it", async () => {
    const { db, tables, linkId, writes } = await proposed();
    expect(await confirmIdentityLink(db, { agencyId: AGENCY, linkId, conversationId: "conv-1", actorId: ACTOR })).toEqual({ ok: true });
    expect(tables.contact_identities[0]).toMatchObject({ lead_id: "lead-ig", match_confidence: "STAFF_CONFIRMED" });
    expect(tables.conversations[0].lead_id).toBe("lead-ig");
    expect(tables.contact_identity_links.find((link) => link.id === linkId)).toMatchObject({ status: "CONFIRMED", previous_lead_id: null, decided_by: ACTOR });
    expect(tables.identity_match_events.at(-1)).toMatchObject({ action: "LINKED", previous_lead_id: null, next_lead_id: "lead-ig", actor_id: ACTOR });
    // The lead records are untouched: identities were linked, nothing was merged.
    expect(writes.filter((write) => write.table === "leads")).toEqual([]);
    expect(tables.leads).toEqual(seed().leads);
  });

  it("closes the other suggestions for the same contact", async () => {
    const { db, tables, linkId } = await proposed();
    await confirmIdentityLink(db, { agencyId: AGENCY, linkId, conversationId: "conv-1", actorId: ACTOR });
    expect(tables.contact_identity_links.map((link) => link.status).sort()).toEqual(["CONFIRMED", "REJECTED"]);
  });

  it("refuses a suggestion that belongs to another conversation, and one already decided", async () => {
    const { db, linkId } = await proposed();
    const elsewhere = fakeDb({ ...seed(), conversations: [{ id: "conv-2", agency_id: AGENCY, lead_id: null, channel: "INSTAGRAM", external_conversation_id: "ig-9" }], contact_identities: [{ id: "ident-2", agency_id: AGENCY, provider: "INSTAGRAM", external_subject_id: "ig-9", lead_id: null }] });
    expect((await confirmIdentityLink(elsewhere.db, { agencyId: AGENCY, linkId, conversationId: "conv-2", actorId: ACTOR })).ok).toBe(false);
    await confirmIdentityLink(db, { agencyId: AGENCY, linkId, conversationId: "conv-1", actorId: ACTOR });
    expect(await confirmIdentityLink(db, { agencyId: AGENCY, linkId, conversationId: "conv-1", actorId: ACTOR })).toEqual({ ok: false, error: "That match has already been decided." });
  });

  it("a link across agencies is impossible: the other agency cannot see or decide it", async () => {
    const { db, linkId } = await proposed();
    expect(await confirmIdentityLink(db, { agencyId: OTHER_AGENCY, linkId, conversationId: "conv-1", actorId: ACTOR })).toEqual({ ok: false, error: "That conversation could not be found." });
  });
});

describe("keeping a contact separate", () => {
  async function proposedBoth() {
    const fake = fakeDb(seed());
    await recordProposals(fake.db, { agencyId: AGENCY, subjectIdentityId: "ident-1", candidates: [candidate("lead-ig"), candidate("lead-other", 0.55)] });
    return fake;
  }

  it("rejects every open suggestion and writes no history until the decision has held", async () => {
    const fake = await proposedBoth();
    const result = await rejectIdentityLinks(fake.db, { agencyId: AGENCY, conversationId: "conv-1", actorId: ACTOR });
    expect(result).toMatchObject({ ok: true, rejected: 2, identityId: "ident-1", links: [{ candidateLeadId: "lead-ig" }, { candidateLeadId: "lead-other" }] });
    expect(fake.tables.contact_identity_links.map((link) => link.status)).toEqual(["REJECTED", "REJECTED"]);
    expect(fake.tables.identity_match_events.filter((event) => event.action === "SPLIT")).toEqual([]);
  });

  it("BUG-7: records one SPLIT row per suggestion once the separate lead exists", async () => {
    const fake = await proposedBoth();
    const result = await rejectIdentityLinks(fake.db, { agencyId: AGENCY, conversationId: "conv-1", actorId: ACTOR });
    if (!result.ok) throw new Error("expected the suggestions to be rejected");
    await recordIdentityKeptSeparate(fake.db, { agencyId: AGENCY, identityId: result.identityId, links: result.links, actorId: ACTOR });
    const splits = fake.tables.identity_match_events.filter((event) => event.action === "SPLIT");
    expect(splits).toHaveLength(2);
    expect(splits[0]).toMatchObject({ contact_identity_id: "ident-1", previous_lead_id: "lead-ig", actor_id: ACTOR, evidence: { decision: "KEPT_SEPARATE" } });
  });

  it("BUG-7: puts the suggestions back as they were when the separate lead could not be created", async () => {
    const fake = await proposedBoth();
    const result = await rejectIdentityLinks(fake.db, { agencyId: AGENCY, conversationId: "conv-1", actorId: ACTOR });
    if (!result.ok) throw new Error("expected the suggestions to be rejected");
    expect(await restoreRejectedIdentityLinks(fake.db, { agencyId: AGENCY, linkIds: result.links.map((link) => link.id) })).toEqual({ ok: true });
    expect(fake.tables.contact_identity_links.map((link) => link.status)).toEqual(["PROPOSED", "PROPOSED"]);
    expect(fake.tables.contact_identity_links.every((link) => link.decided_by === null && link.decided_at === null)).toBe(true);
    expect(fake.tables.identity_match_events.filter((event) => event.action === "SPLIT")).toEqual([]);
  });

  it("BUG-7: restoring never reopens a suggestion someone decided in the meantime", async () => {
    const fake = await proposedBoth();
    const result = await rejectIdentityLinks(fake.db, { agencyId: AGENCY, conversationId: "conv-1", actorId: ACTOR });
    if (!result.ok) throw new Error("expected the suggestions to be rejected");
    fake.tables.contact_identity_links[0].status = "CONFIRMED";
    await restoreRejectedIdentityLinks(fake.db, { agencyId: AGENCY, linkIds: result.links.map((link) => link.id) });
    expect(fake.tables.contact_identity_links.map((link) => link.status)).toEqual(["CONFIRMED", "PROPOSED"]);
  });

  it("a rejected pair is never proposed again", async () => {
    const fake = await proposedBoth();
    await rejectIdentityLinks(fake.db, { agencyId: AGENCY, conversationId: "conv-1", actorId: ACTOR });
    // The next message proposes the same lead again: the existing REJECTED edge is left exactly as it is.
    expect(await recordProposals(fake.db, { agencyId: AGENCY, subjectIdentityId: "ident-1", candidates: [candidate("lead-ig")] })).toBe(0);
    expect(fake.tables.contact_identity_links.map((link) => link.status)).toEqual(["REJECTED", "REJECTED"]);
  });
});

describe("unlinking restores the prior state", () => {
  async function confirmed(previousLead: string | null) {
    const fake = fakeDb({ ...seed(), contact_identities: [{ id: "ident-1", agency_id: AGENCY, provider: "WHATSAPP", external_subject_id: "94712223333", lead_id: previousLead, match_confidence: "UNRESOLVED" }] });
    await recordProposals(fake.db, { agencyId: AGENCY, subjectIdentityId: "ident-1", candidates: [candidate("lead-ig")] });
    const linkId = fake.tables.contact_identity_links[0].id as string;
    await confirmIdentityLink(fake.db, { agencyId: AGENCY, linkId, conversationId: "conv-1", actorId: ACTOR });
    return { ...fake, linkId };
  }

  it("puts the identity and conversation back, marks the pair rejected, and audits UNLINKED", async () => {
    const { db, tables, linkId } = await confirmed(null);
    expect(await unlinkIdentityLink(db, { agencyId: AGENCY, linkId, conversationId: "conv-1", actorId: ACTOR })).toEqual({ ok: true });
    expect(tables.contact_identities[0].lead_id).toBeNull();
    expect(tables.conversations[0].lead_id).toBeNull();
    expect(tables.contact_identity_links[0].status).toBe("REJECTED");
    expect(tables.identity_match_events.at(-1)).toMatchObject({ action: "UNLINKED", previous_lead_id: "lead-ig", next_lead_id: null });
  });

  it("restores the lead the identity had BEFORE the confirm, not just null", async () => {
    const { db, tables, linkId } = await confirmed("lead-other");
    await unlinkIdentityLink(db, { agencyId: AGENCY, linkId, conversationId: "conv-1", actorId: ACTOR });
    expect(tables.contact_identities[0].lead_id).toBe("lead-other");
  });

  it("does not undo a conversation a person has since pointed elsewhere", async () => {
    const { db, tables, linkId } = await confirmed(null);
    tables.conversations[0].lead_id = "lead-other";
    await unlinkIdentityLink(db, { agencyId: AGENCY, linkId, conversationId: "conv-1", actorId: ACTOR });
    expect(tables.conversations[0].lead_id).toBe("lead-other");
  });

  it("only a confirmed link can be unlinked", async () => {
    const fake = fakeDb(seed());
    await recordProposals(fake.db, { agencyId: AGENCY, subjectIdentityId: "ident-1", candidates: [candidate("lead-ig")] });
    const linkId = fake.tables.contact_identity_links[0].id as string;
    expect(await unlinkIdentityLink(fake.db, { agencyId: AGENCY, linkId, conversationId: "conv-1", actorId: ACTOR })).toEqual({ ok: false, error: "Only a confirmed link can be undone." });
  });
});

describe("loadProposalsForConversation — what the card shows", () => {
  it("lists the open suggestions with the lead's details and the reasons, and nothing once the conversation has a lead", async () => {
    const fake = fakeDb(seed());
    await recordProposals(fake.db, { agencyId: AGENCY, subjectIdentityId: "ident-1", candidates: [candidate("lead-ig")] });
    const views = await loadProposalsForConversation(fake.db, AGENCY, "conv-1");
    expect(views).toEqual([{ linkId: expect.any(String), band: "MEDIUM", leadId: "lead-ig", leadReference: "LD-1", leadName: "Fathima Rizvi", leadMobile: "", leadStage: "NEW_LEAD", reasons: ["Same full name."] }]);

    fake.tables.conversations[0].lead_id = "lead-ig";
    expect(await loadProposalsForConversation(fake.db, AGENCY, "conv-1")).toEqual([]);
  });
});
