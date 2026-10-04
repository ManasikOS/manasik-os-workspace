/**
 * Group task mutation logic, kept pure and store-passing so it can be
 * unit-tested without the Next server runtime (mirroring
 * `departure-groups-readiness.ts`). The thin wrappers in `departure-groups.ts`
 * supply the live store.
 */

import { newId } from "@/lib/data/departure-groups-ids";
import type {
  GroupActor,
  TaskCategory,
  TaskStatus,
  DepartureGroupStore,
} from "@/lib/types/departure-groups";

export interface CreateGroupTaskInput {
  departureGroupId: string;
  title: string;
  description?: string | null;
  ownerName: string;
  /**
   * The `staff_profiles.id` behind `ownerName`, when the caller was able to
   * resolve one. `owner_id` was written as `null` unconditionally until this
   * field existed — see the Team build plan's finding on
   * `departure_group_tasks.owner_id` never being populated.
   */
  ownerId?: string | null;
  dueAt: string;
  category: TaskCategory;
  linkedReadinessItemId?: string | null;
}

export type CreateGroupTaskOutcome =
  | { ok: true; result: { taskId: string; title: string } }
  | { ok: false; error: string };

/**
 * Creates a task against a group.
 *
 * `status` is not an input: a brand-new task is OPEN, or OVERDUE when it is
 * created with a due date that has already passed — which happens whenever
 * someone writes up work that should have been done last week.
 */
export function createGroupTaskInStore(
  data: DepartureGroupStore,
  input: CreateGroupTaskInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): CreateGroupTaskOutcome {
  const group = data.groups.find((g) => g.id === input.departureGroupId);
  if (!group) {
    return { ok: false, error: "That departure group no longer exists." };
  }

  if (
    input.linkedReadinessItemId &&
    !data.readinessItems.some(
      (item) =>
        item.id === input.linkedReadinessItemId &&
        item.departure_group_id === input.departureGroupId,
    )
  ) {
    return {
      ok: false,
      error: "That readiness requirement is not on this group.",
    };
  }

  const taskId = newId();
  const status: TaskStatus =
    Date.parse(input.dueAt) < Date.parse(now) ? "OVERDUE" : "OPEN";

  data.tasks.push({
    id: taskId,
    departure_group_id: input.departureGroupId,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    owner_id: input.ownerId ?? null,
    owner_name: input.ownerName.trim(),
    due_at: input.dueAt,
    status,
    category: input.category,
    linked_readiness_item_id: input.linkedReadinessItemId ?? null,
  });

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "TASK_CREATED",
    entity_type: "TASK",
    entity_id: taskId,
    before_value: null,
    after_value: {
      title: input.title.trim(),
      owner_name: input.ownerName.trim(),
      due_at: input.dueAt,
      status,
    },
    message: `Task "${input.title.trim()}" created for ${input.ownerName.trim()}.`,
    is_system: false,
    is_high_impact: false,
    created_at: now,
  });

  return { ok: true, result: { taskId, title: input.title.trim() } };
}

export type UpdateGroupTaskStatusOutcome =
  | { ok: true; result: { title: string; status: TaskStatus } }
  | { ok: false; error: string };

/**
 * Moves a task through its lifecycle ("Complete" / reopen).
 *
 * Reopening resolves to OVERDUE rather than OPEN when the due date has already
 * passed, so a task that is reopened late does not read as comfortably on time.
 */
export function updateGroupTaskStatusInStore(
  data: DepartureGroupStore,
  input: { id: string; departureGroupId: string; status: TaskStatus },
  actor: GroupActor,
  now: string = new Date().toISOString(),
): UpdateGroupTaskStatusOutcome {
  const task = data.tasks.find(
    (row) =>
      row.id === input.id && row.departure_group_id === input.departureGroupId,
  );
  if (!task) {
    return { ok: false, error: "That task is no longer on this group." };
  }

  const next: TaskStatus =
    input.status !== "COMPLETE" &&
    input.status !== "IN_PROGRESS" &&
    Date.parse(task.due_at) < Date.parse(now)
      ? "OVERDUE"
      : input.status;

  if (task.status === next) {
    return { ok: false, error: `"${task.title}" is already ${next.toLowerCase().replace(/_/g, " ")}.` };
  }

  const before = task.status;
  task.status = next;

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "TASK_STATUS_CHANGED",
    entity_type: "TASK",
    entity_id: task.id,
    before_value: { status: before },
    after_value: { status: task.status },
    message:
      task.status === "COMPLETE"
        ? `Task "${task.title}" completed.`
        : `Task "${task.title}" reopened.`,
    is_system: false,
    is_high_impact: false,
    created_at: now,
  });

  return { ok: true, result: { title: task.title, status: task.status } };
}

export interface ReassignGroupTaskInput {
  id: string;
  departureGroupId: string;
  ownerName: string;
  /** See `CreateGroupTaskInput.ownerId`. */
  ownerId?: string | null;
}

export type ReassignGroupTaskOutcome =
  | { ok: true; result: { title: string; ownerName: string | null } }
  | { ok: false; error: string };

/**
 * Changes who owns a task, including clearing it back to unassigned — an
 * empty string is stored, mirroring the column's existing `''` default,
 * rather than persisting `null` (the column has no such migration yet).
 */
export function reassignGroupTaskInStore(
  data: DepartureGroupStore,
  input: ReassignGroupTaskInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): ReassignGroupTaskOutcome {
  const task = data.tasks.find(
    (row) => row.id === input.id && row.departure_group_id === input.departureGroupId,
  );
  if (!task) {
    return { ok: false, error: "That task is no longer on this group." };
  }

  const before = task.owner_name;
  const next = input.ownerName.trim();
  task.owner_name = next;
  task.owner_id = next ? (input.ownerId ?? null) : null;

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "TASK_REASSIGNED",
    entity_type: "TASK",
    entity_id: task.id,
    before_value: { owner_name: before },
    after_value: { owner_name: next },
    message: next
      ? `Task "${task.title}" reassigned to ${next}.`
      : `Task "${task.title}" unassigned.`,
    is_system: false,
    is_high_impact: false,
    created_at: now,
  });

  return { ok: true, result: { title: task.title, ownerName: next || null } };
}

export interface BulkUpdateGroupTasksInput {
  taskRefs: { id: string; departureGroupId: string }[];
  status?: Exclude<TaskStatus, "OVERDUE">;
  ownerName?: string;
  /** See `CreateGroupTaskInput.ownerId`. */
  ownerId?: string | null;
}

export type BulkUpdateGroupTasksOutcome =
  | { ok: true; result: { updated: number } }
  | { ok: false; error: string };

/** Applies a status and/or owner change to many tasks in one pass — the
 *  Operational Tasks table's "Bulk Assign" / "Bulk Update". */
export function bulkUpdateGroupTasksInStore(
  data: DepartureGroupStore,
  input: BulkUpdateGroupTasksInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): BulkUpdateGroupTasksOutcome {
  if (!input.status && input.ownerName === undefined) {
    return { ok: false, error: "Nothing to update." };
  }

  let updated = 0;
  for (const ref of input.taskRefs) {
    if (input.status) {
      updateGroupTaskStatusInStore(data, { ...ref, status: input.status }, actor, now);
    }
    if (input.ownerName !== undefined) {
      reassignGroupTaskInStore(data, { ...ref, ownerName: input.ownerName, ownerId: input.ownerId }, actor, now);
    }
    updated++;
  }

  return { ok: true, result: { updated } };
}
