"use client";

import { SavedViewBar } from "@/components/data-table/saved-view-bar";
import { FilterSelect } from "@/components/data-table/filter-select";
import { Button } from "@/components/ui/button";
import { ChevronDown, Plus, SlidersHorizontal, X } from "lucide-react";
import React, { useDeferredValue, useEffect, useMemo, useState } from "react";

import { useOperations } from "../../operations-store";
import {
  EMPTY_TASK_FILTERS,
  TASK_SAVED_VIEWS,
  type OperationsTaskItem,
  type TaskFilters,
  type TaskSavedView,
} from "../../types";
import {
  DEFAULT_TASK_SORT,
  TASK_CATEGORY_LABELS,
  TASK_STATUS_LABELS,
  activeTaskFilterCount,
  applyTaskSavedView,
  matchesTaskFilters,
  matchesTaskSearch,
  sortTasks,
  type TaskSort,
} from "../../utils";
import { buildTaskColumns } from "../../operations-table/task-columns";
import { OperationsDataTable } from "../../operations-table/operations-data-table";
import CreateTaskDialog from "../create-task-dialog";
import ReassignTaskDialog from "../reassign-task-dialog";
import TaskBulkActionsBar from "../task-bulk-actions-bar";
import TaskDrawer from "../task-drawer";
import { updateOperationsTaskStatusAction } from "../../actions";
import { toast } from "@/components/ui/toast";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";

interface TasksTabProps {
  initialView: string | null;
  onConsumeFilter: () => void;
}

const isSavedView = (value: string): value is TaskSavedView => (TASK_SAVED_VIEWS as readonly string[]).includes(value);

/** The shared work queue for Operations, Visa, Finance, Guides and Marketing
 *  handovers — cross-group, unlike the Departure Group page's own task list. */
const TasksTab = ({ initialView, onConsumeFilter }: TasksTabProps) => {
  const router = useRouter();
  const { snapshot, currentStaffName, can } = useOperations();

  const [searchInput, setSearchInput] = useState("");
  const search = useDeferredValue(searchInput);
  const [savedView, setSavedView] = useState<TaskSavedView>(
    initialView && isSavedView(initialView) ? initialView : "All",
  );
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_TASK_FILTERS);
  const [sort, setSort] = useState<TaskSort>(DEFAULT_TASK_SORT);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [drawerTask, setDrawerTask] = useState<OperationsTaskItem | null>(null);
  const [reassignTarget, setReassignTarget] = useState<OperationsTaskItem | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    onConsumeFilter();
    // Runs once on mount only — the parent remounts this tab on every switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setFilter = (key: keyof TaskFilters, value: string) => setFilters((prev) => ({ ...prev, [key]: value }));

  const groupOptions = useMemo(
    () => [...new Map(snapshot.tasks.map((t) => [t.groupId, t.groupName])).entries()].map(([value, label]) => ({ value, label })),
    [snapshot.tasks],
  );
  const ownerOptions = useMemo(
    () => [...new Set(snapshot.tasks.map((t) => t.ownerName).filter((n): n is string => !!n))].map((n) => ({ value: n, label: n })),
    [snapshot.tasks],
  );

  const filtered = useMemo(() => {
    const viewed = applyTaskSavedView(snapshot.tasks, savedView, currentStaffName, snapshot.nowIso);
    return viewed.filter((t) => matchesTaskFilters(t, filters) && matchesTaskSearch(t, search));
  }, [snapshot.tasks, savedView, filters, search, currentStaffName, snapshot.nowIso]);

  const sorted = useMemo(() => sortTasks(filtered, sort, snapshot.nowIso), [filtered, sort, snapshot.nowIso]);

  const columns = useMemo(
    () =>
      buildTaskColumns(
        sort,
        (s) => setSort(s as TaskSort),
        {
          onOpen: (item) => setDrawerTask(item),
          onComplete: async (item) => {
            const result = await updateOperationsTaskStatusAction({ id: item.id, departureGroupId: item.groupId, status: "COMPLETE" });
            if (!result.ok) {
              toast.add({ title: "Could not complete task", description: result.error });
              return;
            }
            toast.add({ title: "Task marked complete" });
          },
          onReassign: (item) => setReassignTarget(item),
        },
        snapshot.nowIso,
        can.bulkUpdateTasks,
      ),
    [sort, snapshot.nowIso, can.bulkUpdateTasks],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SavedViewBar views={["All", ...TASK_SAVED_VIEWS.filter((v) => v !== "All")] as TaskSavedView[]} active={savedView} onChange={setSavedView} />
        {can.createTask && (
          <Button variant="secondary" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus /> Create Task
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect label="Departure Group" value={filters.groupId} options={groupOptions} onChange={(v) => setFilter("groupId", v)} />
        <FilterSelect
          label="Status"
          value={filters.status}
          options={Object.entries(TASK_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
          onChange={(v) => setFilter("status", v)}
        />
        <FilterSelect
          label="Category"
          value={filters.category}
          options={Object.entries(TASK_CATEGORY_LABELS).map(([value, label]) => ({ value, label }))}
          onChange={(v) => setFilter("category", v)}
        />
        <Button
          variant="outline_without_border"
          size="sm"
          className="gap-1.5 text-muted-foreground bg-transparent dark:bg-transparent shadow-none!"
          onClick={() => setShowMoreFilters((v) => !v)}
        >
          <SlidersHorizontal className="size-3.5" /> More Filters <ChevronDown />
        </Button>
        {activeTaskFilterCount(filters) > 0 && (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setFilters(EMPTY_TASK_FILTERS)}>
            <X /> Clear filters
          </Button>
        )}
      </div>

      {showMoreFilters && (
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect label="Owner" value={filters.owner} options={ownerOptions} onChange={(v) => setFilter("owner", v)} />
        </div>
      )}

      <OperationsDataTable
        columns={columns}
        data={sorted}
        getRowId={(row) => row.id}
        search={search}
        onSearchChange={setSearchInput}
        searchPlaceholder="Search task title, owner, departure group…"
        onRowClick={(item) => setDrawerTask(item)}
        resetPageToken={`${savedView}-${search}-${JSON.stringify(filters)}`}
        sort={{ field: sort.field, direction: sort.direction }}
        sortFieldByColumnId={{ group: "group", due: "dueAt", priority: "priority" }}
        bulkBar={
          can.bulkUpdateTasks || can.reassignTask
            ? (selected, clear) => <TaskBulkActionsBar selected={selected} clear={clear} can={can} />
            : undefined
        }
      />

      <TaskDrawer task={drawerTask} open={drawerTask !== null} onClose={() => setDrawerTask(null)} can={can} />
      <ReassignTaskDialog
        taskRefs={reassignTarget ? [{ id: reassignTarget.id, departureGroupId: reassignTarget.groupId }] : []}
        itemsLabel={reassignTarget?.title ?? ""}
        currentOwnerName={reassignTarget?.ownerName}
        open={reassignTarget !== null}
        onClose={() => {
          setReassignTarget(null);
          router.refresh();
        }}
      />
      {can.createTask && <CreateTaskDialog open={createOpen} onClose={() => setCreateOpen(false)} />}
    </div>
  );
};

export default TasksTab;
