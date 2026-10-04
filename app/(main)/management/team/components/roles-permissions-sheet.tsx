"use client";

import { ChevronDown, Loader2, Plus, Save, Trash2 } from "lucide-react";
import React, { useEffect, useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ToneBadge } from "@/components/ui/tone-badge";
import { toast } from "@/components/ui/toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  MODULE_CAPABILITY_KEYS,
  MODULE_LABELS,
} from "@/lib/access/module-capability-keys";
import {
  BASE_ROLES,
  type BaseRole,
  type PermissionModule,
  type StaffRoleRow,
} from "@/lib/access/role-permissions-shared";
import { ROLE_LABELS } from "@/lib/access/team-access";
import {
  createRoleAction,
  deleteRoleAction,
  getRolePermissionAction,
  listRolesAction,
  updateRoleAction,
  updateRolePermissionsAction,
} from "../role-actions";
import { Card } from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/animate/tabs";

interface RolesPermissionsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MODULES = Object.keys(MODULE_LABELS) as PermissionModule[];

/** "viewSupplierCosts" -> "View Supplier Costs". */
function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * Fully editable role & permission manager — every role (the 7 system roles
 * included, per the product decision to make them editable seed rows) can be
 * renamed, and every capability of every module can be toggled per role.
 * Custom roles can be created and deleted here too. See
 * `supabase/migrations/20260924090000_dynamic_roles_permissions.sql` for the
 * schema this reads and writes, and its header comment for why enforcement
 * of these toggles is wired for the Team module today, with the other 13
 * modules' Server Actions still reading their old hardcoded matrix — a
 * documented, scoped follow-up, not silently incomplete.
 */
const RolesPermissionsSheet = ({
  open,
  onOpenChange,
}: RolesPermissionsSheetProps) => {
  const [roles, setRoles] = useState<StaffRoleRow[] | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [selectedModule, setSelectedModule] =
    useState<PermissionModule>("team");

  const [nameDraft, setNameDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [capabilitiesDraft, setCapabilitiesDraft] = useState<Record<
    string,
    boolean
  > | null>(null);

  const [newRoleOpen, setNewRoleOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleBase, setNewRoleBase] = useState<BaseRole>("GUIDE");

  const [loadingRoles, setLoadingRoles] = useState(false);
  const [loadingModule, setLoadingModule] = useState(false);
  const [isPending, startTransition] = useTransition();

  const loadRoles = () => {
    setLoadingRoles(true);
    listRolesAction().then((result) => {
      setLoadingRoles(false);
      if (!result.ok) {
        toast.add({ title: "Could not load roles", description: result.error });
        return;
      }
      setRoles(result.roles);
      setSelectedRoleId((current) => current ?? result.roles[0]?.id ?? null);
    });
  };

  useEffect(() => {
    // Fetches from the server (an external system) whenever the sheet opens
    // with nothing loaded yet — no render-time equivalent for a Server
    // Action call.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open && roles === null) loadRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only (re)loads on open, not on every roles/selectedRoleId change
  }, [open]);

  const selectedRole = useMemo(
    () => roles?.find((r) => r.id === selectedRoleId) ?? null,
    [roles, selectedRoleId],
  );

  useEffect(() => {
    // Re-seeds the edit form whenever the selected role changes — same
    // "reset on identity change" shape as hooks/use-reset-on-open.ts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNameDraft(selectedRole?.name ?? "");
    setDescriptionDraft(selectedRole?.description ?? "");
  }, [selectedRole]);

  useEffect(() => {
    // Fetches this role's permissions for the selected module from the
    // server whenever either changes.
    if (!selectedRoleId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingModule(true);
    setCapabilitiesDraft(null);
    getRolePermissionAction(selectedRoleId, selectedModule).then((result) => {
      setLoadingModule(false);
      if (!result.ok) {
        toast.add({
          title: "Could not load permissions",
          description: result.error,
        });
        return;
      }
      const keys = MODULE_CAPABILITY_KEYS[selectedModule];
      const base: Record<string, boolean> = {};
      for (const key of keys) base[key] = result.capabilities?.[key] ?? false;
      setCapabilitiesDraft(base);
    });
  }, [selectedRoleId, selectedModule]);

  const saveRoleDetails = () => {
    if (!selectedRoleId) return;
    startTransition(async () => {
      const result = await updateRoleAction({
        roleId: selectedRoleId,
        name: nameDraft,
        description: descriptionDraft || null,
      });
      if (!result.ok) {
        toast.add({ title: "Could not save role", description: result.error });
        return;
      }
      toast.add({ title: "Role updated" });
      loadRoles();
    });
  };

  const savePermissions = () => {
    if (!selectedRoleId || !capabilitiesDraft) return;
    startTransition(async () => {
      const result = await updateRolePermissionsAction({
        roleId: selectedRoleId,
        module: selectedModule,
        capabilities: capabilitiesDraft,
      });
      if (!result.ok) {
        toast.add({
          title: "Could not save permissions",
          description: result.error,
        });
        return;
      }
      toast.add({
        title: `${MODULE_LABELS[selectedModule]} permissions saved`,
        description: `Applies to everyone on ${selectedRole?.name}.`,
      });
    });
  };

  const createRole = () => {
    if (!newRoleName.trim()) return;
    startTransition(async () => {
      const result = await createRoleAction({
        name: newRoleName,
        baseRole: newRoleBase,
      });
      if (!result.ok) {
        toast.add({
          title: "Could not create role",
          description: result.error,
        });
        return;
      }
      toast.add({
        title: "Role created",
        description: `${newRoleName} starts with ${ROLE_LABELS[newRoleBase]}'s permissions — adjust as needed.`,
      });
      setNewRoleOpen(false);
      setNewRoleName("");
      setNewRoleBase("GUIDE");
      setSelectedRoleId(result.roleId ?? null);
      loadRoles();
    });
  };

  const removeRole = (role: StaffRoleRow) => {
    startTransition(async () => {
      const result = await deleteRoleAction({ roleId: role.id });
      if (!result.ok) {
        toast.add({
          title: "Could not delete role",
          description: result.error,
        });
        return;
      }
      toast.add({ title: "Role deleted" });
      setSelectedRoleId(null);
      loadRoles();
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:data-[side=right]:max-w-2xl md:data-[side=right]:max-w-3xl p-0 gap-0 flex flex-col"
      >
        <SheetHeader className="">
          <SheetTitle className="">Manage Roles &amp; Permissions</SheetTitle>
          <SheetDescription className="">
            Every role — including Admin, CEO and the other built-ins — can be
            renamed and have its module-by-module permissions edited here.
            Changes apply immediately to everyone on that role.
          </SheetDescription>
        </SheetHeader>

        {/* ── Mobile: horizontal role strip ── Desktop: left sidebar + detail ── */}
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row min-h-0">
          {/* ── Role list: horizontal strip on mobile, vertical sidebar on md+ ── */}
          <div className="md:w-52 md:shrink-0 md:border-r md:border-border/50 md:overflow-y-auto md:custom-scroll md:px-3 md:py-4 md:flex-col md:gap-1 flex md:flex shrink-0 border-b md:border-b-0 border-border/50 overflow-x-auto custom-scroll px-3 py-2 md:py-4 gap-1 items-start md:items-stretch">
            {loadingRoles && !roles && (
              <Loader2 className="size-4 animate-spin text-muted-foreground mx-auto mt-2 md:mt-4 shrink-0" />
            )}

            {/* Role buttons */}
            <div className="flex md:flex-col gap-1 shrink-0 md:w-full">
              {roles?.map((role) => (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => setSelectedRoleId(role.id)}
                  className={`whitespace-nowrap md:whitespace-normal text-left rounded-md px-2.5 py-1.5 md:py-2 text-sm flex items-center justify-between gap-2 shrink-0 md:w-full min-h-[36px] ${
                    role.id === selectedRoleId
                      ? "bg-primary/10 text-foreground font-medium"
                      : "text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  <span className="truncate">{role.name}</span>
                  {role.is_system && (
                    <ToneBadge
                      tone="neutral"
                      label="System"
                      className="shrink-0 px-1.5 py-0.5 text-[10px] hidden sm:inline-flex"
                    />
                  )}
                </button>
              ))}
            </div>

            {/* New Role popover trigger */}
            <div className="shrink-0 md:w-full md:mt-2">
              <Popover>
                <PopoverTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="sm"
                      className="justify-start text-muted-foreground whitespace-nowrap"
                    >
                      <Plus className="size-3.5" /> New Role
                    </Button>
                  }
                ></PopoverTrigger>
                <PopoverContent className={"p-0! bg-transparent!"}>
                  <Card className="flex flex-col px-3 py-5 gap-6">
                    <InputGroup>
                      <InputGroupInput
                        placeholder="Role name"
                        value={newRoleName}
                        onChange={(e) => setNewRoleName(e.target.value)}
                        className=""
                      />
                    </InputGroup>
                    <DropdownMenu>
                      <DropdownMenuTrigger className="w-full">
                        <InputGroup>
                          <InputGroupInput
                            value={ROLE_LABELS[newRoleBase]}
                            readOnly
                            className="cursor-pointer"
                          />
                        </InputGroup>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {BASE_ROLES.map((b) => (
                          <DropdownMenuItem
                            key={b}
                            onClick={() => setNewRoleBase(b)}
                          >
                            {ROLE_LABELS[b]}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <p className="text-xs text-muted-foreground">
                      Starts with {ROLE_LABELS[newRoleBase]}&apos;s permissions
                      on every module — edit from there.
                    </p>
                    <Button
                      disabled={isPending || !newRoleName.trim()}
                      onClick={createRole}
                    >
                      {isPending && <Loader2 className="size-3 animate-spin" />}{" "}
                      Create
                    </Button>
                  </Card>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* ── Selected role detail panel ── */}
          <div className="flex-1 overflow-y-auto custom-scroll px-3 py-3 sm:px-4 sm:py-4 flex flex-col gap-4 sm:gap-5 min-w-0">
            {!selectedRole ? (
              <p className="text-sm text-muted-foreground">
                Select a role to edit.
              </p>
            ) : (
              <>
                {/* Role name + description */}
                <div className="flex flex-col gap-2">
                  <InputGroup>
                    <InputGroupAddon align={"block-start"}>
                      <InputGroupText>Name</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                    />
                  </InputGroup>

                  <InputGroup>
                    <InputGroupAddon align={"block-start"}>
                      <InputGroupText>Description</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupTextarea
                      value={descriptionDraft}
                      onChange={(e) => setDescriptionDraft(e.target.value)}
                      rows={2}
                    />
                  </InputGroup>

                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <Button
                      variant="secondary"
                      disabled={isPending}
                      onClick={saveRoleDetails}
                    >
                      {isPending && (
                        <Loader2 className="size-3.5 animate-spin" />
                      )}{" "}
                      Save Details
                    </Button>
                    {!selectedRole.is_system && (
                      <Button
                        variant="ghost"
                        className="text-destructive"
                        disabled={isPending}
                        onClick={() => removeRole(selectedRole)}
                      >
                        Delete Role
                      </Button>
                    )}
                  </div>
                </div>

                {/* Module permissions */}
                <div className="border-t border-border/50 pt-4">
                  {/* Module tabs — horizontal scroll on all screen sizes */}

                  <Tabs value={selectedModule} className="mb-5">
                    <TabsList>
                      {MODULES.map((m) => {
                        return (
                          <TabsTrigger
                            key={m}
                            value={m}
                            onClick={() => setSelectedModule(m)}
                          >
                            {MODULE_LABELS[m]}
                          </TabsTrigger>
                        );
                      })}
                    </TabsList>
                  </Tabs>

                  {loadingModule || !capabilitiesDraft ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground mt-4" />
                  ) : (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                        {MODULE_CAPABILITY_KEYS[selectedModule].map((key) => (
                          <label
                            key={key}
                            className="flex items-center justify-between gap-3 text-sm py-2 sm:py-1 min-h-[40px] sm:min-h-0 cursor-pointer"
                          >
                            <span className="text-foreground leading-tight">
                              {humanizeKey(key)}
                            </span>
                            <Switch
                              checked={capabilitiesDraft[key] ?? false}
                              onCheckedChange={(checked) =>
                                setCapabilitiesDraft((prev) =>
                                  prev ? { ...prev, [key]: checked } : prev,
                                )
                              }
                            />
                          </label>
                        ))}
                      </div>
                      <Button
                        className="mt-4 w-full sm:w-auto "
                        disabled={isPending}
                        onClick={savePermissions}
                      >
                        {isPending && (
                          <Loader2 className="size-3.5 animate-spin" />
                        )}{" "}
                        Save {MODULE_LABELS[selectedModule]} Permissions
                      </Button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default RolesPermissionsSheet;
