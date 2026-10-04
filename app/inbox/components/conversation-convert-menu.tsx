"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { Ellipsis, ListPlus, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { ProposalDiffLine } from "@/lib/agent/kernel/proposals/types";
import type {
  ConversionFieldChoices,
  ConversionKind,
  OfferedConversion,
} from "@/lib/inbox/conversions/catalogue";

import {
  confirmConversationConversionAction,
  dismissConversationConversionAction,
  loadConversationConversionsAction,
  loadConversionChoicesAction,
  previewConversationConversionAction,
} from "../conversion-actions";
import { useInboxRefresh } from "./inbox-refresh-context";

type Step =
  | { kind: "closed" }
  | {
      kind: "details";
      conversion: OfferedConversion;
      choices: ConversionFieldChoices[] | null;
    }
  | {
      kind: "review";
      conversion: OfferedConversion;
      proposalId: string;
      title: string;
      humanDiff: ProposalDiffLine[];
    }
  | { kind: "done"; conversion: OfferedConversion };

type FieldValues = Record<string, string | number | boolean>;

/** The starting value of each field: the server's suggested default, else nothing chosen. */
function initialValues(
  conversion: OfferedConversion,
  choices: ConversionFieldChoices[],
): FieldValues {
  const values: FieldValues = {};
  for (const field of conversion.fields) {
    const offered = choices.find((choice) => choice.name === field.name);
    if (offered?.defaultValue !== undefined)
      values[field.name] = offered.defaultValue;
    else if (field.type === "BOOLEAN") values[field.name] = false;
  }
  return values;
}

/**
 * "Create task or case" — MI4.6. Turns the open conversation into one piece of work that points back at it. Two steps so
 * nothing is created by accident: first you fill in what is needed and see exactly what will be made, then you press Create.
 * Options that cannot work yet stay in the list, greyed, with the reason ("Select a departure group for this customer first").
 * Anything you must choose — a traveller, a package, how many seats — is picked from a list the server prepared for this
 * conversation, never typed in.
 */
export function ConversationConvertMenu({
  conversationId,
  variant = "panel",
  suggested = null,
  extraItems = null,
}: {
  conversationId: string;
  /** "panel" is the full-width trigger in the context panel; "composer" is the compact "More actions" button. */
  variant?: "panel" | "composer" | "recommendation";
  /** The action the composer suggests next. It gets its own button and is listed first in the menu. */
  suggested?: { kind: ConversionKind; label: string } | null;
  /** Extra menu rows placed above the conversions (the composer adds "Create quote" here). */
  extraItems?: ReactNode;
}) {
  const [conversions, setConversions] = useState<OfferedConversion[] | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ kind: "closed" });
  const [note, setNote] = useState("");
  const [values, setValues] = useState<FieldValues>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const refreshInbox = useInboxRefresh();
  const suggestedKind = suggested?.kind ?? null;
  const suggestedOption = suggested
    ? conversions?.find((conversion) => conversion.kind === suggestedKind)
    : undefined;

  useEffect(() => {
    if (variant !== "recommendation" || !suggestedKind) return;
    let cancelled = false;
    startTransition(async () => {
      const result = await loadConversationConversionsAction({
        conversationId,
      });
      if (cancelled) return;
      if (result.ok) setConversions(result.conversions);
      else setLoadError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId, suggestedKind, variant]);

  function loadOptions(open: boolean) {
    if (!open || conversions) return;
    setLoadError(null);
    startTransition(async () => {
      const result = await loadConversationConversionsAction({
        conversationId,
      });
      if (result.ok) setConversions(result.conversions);
      else setLoadError(result.error);
    });
  }

  /** The suggested button opens that conversion straight away; the options are read first if the menu was never opened. */
  function chooseSuggested() {
    if (!suggested) return;
    const known = conversions?.find(
      (conversion) => conversion.kind === suggested.kind,
    );
    if (known) {
      choose(known);
      return;
    }
    setLoadError(null);
    startTransition(async () => {
      const result = await loadConversationConversionsAction({
        conversationId,
      });
      if (!result.ok) {
        setLoadError(result.error);
        return;
      }
      setConversions(result.conversions);
      const match = result.conversions.find(
        (conversion) => conversion.kind === suggested.kind,
      );
      if (match) choose(match);
    });
  }

  function choose(conversion: OfferedConversion) {
    if (!conversion.available) return;
    setNote("");
    setValues({});
    setError(null);
    if (conversion.fields.length === 0) {
      setStep({ kind: "details", conversion, choices: [] });
      return;
    }
    setStep({ kind: "details", conversion, choices: null });
    startTransition(async () => {
      const result = await loadConversionChoicesAction({
        conversationId,
        kind: conversion.kind,
      });
      if (!result.ok) {
        setError(result.error);
        setStep({ kind: "details", conversion, choices: [] });
        return;
      }
      setValues(initialValues(conversion, result.fields));
      setStep({ kind: "details", conversion, choices: result.fields });
    });
  }

  function review(conversion: OfferedConversion) {
    setError(null);
    startTransition(async () => {
      const result = await previewConversationConversionAction({
        conversationId,
        kind: conversion.kind,
        note,
        params: values,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStep({
        kind: "review",
        conversion,
        proposalId: result.proposalId,
        title: result.title,
        humanDiff: result.humanDiff,
      });
    });
  }

  function create(proposalId: string, conversion: OfferedConversion) {
    setError(null);
    startTransition(async () => {
      const result = await confirmConversationConversionAction({ proposalId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStep({ kind: "done", conversion });
      refreshInbox();
    });
  }

  /** Closing the sheet (or pressing Cancel) after the request was written withdraws it, so no stale request lingers. */
  function close() {
    if (step.kind === "review")
      void dismissConversationConversionAction({ proposalId: step.proposalId });
    setStep({ kind: "closed" });
  }

  return (
    <>
      {suggested && (
        <Button
          type="button"
          variant={"secondary"}
          disabled={
            pending ||
            (conversions !== null && suggestedOption?.available !== true)
          }
          onClick={chooseSuggested}
        >
          {suggested.label}
        </Button>
      )}
      <DropdownMenu onOpenChange={loadOptions}>
        {variant === "composer" || variant === "recommendation" ? (
          <DropdownMenuTrigger
            render={
              <Button type="button" variant="ghost" aria-label="More actions" />
            }
          >
            <Ellipsis className="size-3.5" />
          </DropdownMenuTrigger>
        ) : (
          <DropdownMenuTrigger
            render={<Button type="button" variant="outline_without_border" />}
          >
            <ListPlus className="size-3.5" />
            Create task or case
          </DropdownMenuTrigger>
        )}
        <DropdownMenuContent align="start" className="w-80">
          {extraItems}
          {loadError && (
            <p role="alert" className="px-2 py-1.5 text-xs text-destructive">
              {loadError}
            </p>
          )}
          {!conversions && !loadError && (
            <p className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
              <Loader2 className="animate-spin" size={14} /> Loading options…
            </p>
          )}

          {conversions
            ?.toSorted(
              (a, b) =>
                Number(b.kind === suggested?.kind) -
                Number(a.kind === suggested?.kind),
            )
            .map((conversion) => (
              <DropdownMenuItem
                key={conversion.kind}
                disabled={!conversion.available}
                onClick={() => choose(conversion)}
                className="flex-col items-start gap-0.5"
              >
                <span className="text-sm">
                  {conversion.label}
                  {conversion.kind === suggested?.kind && conversion.available
                    ? " · Suggested"
                    : ""}
                </span>
                <span className="text-xs text-muted-foreground">
                  {conversion.available
                    ? conversion.description
                    : conversion.reason}
                </span>
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {variant === "recommendation" &&
        conversions !== null &&
        suggestedOption?.available !== true && (
          <p
            role="status"
            className="basis-full text-xs font-medium text-foreground"
          >
            {suggestedOption?.reason ??
              "This workflow is not available for this conversation."}
          </p>
        )}
      {variant === "recommendation" && loadError && (
        <p role="alert" className="basis-full text-xs text-destructive">
          {loadError}
        </p>
      )}

      <Sheet
        open={step.kind !== "closed"}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <SheetContent className="sm:max-w-md">
          {step.kind === "details" && (
            <>
              <SheetHeader>
                <SheetTitle>{step.conversion.label}</SheetTitle>
                <SheetDescription>
                  {step.conversion.description}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 overflow-y-auto px-4">
                {step.choices === null && (
                  <p className="text-sm text-muted-foreground">
                    Loading choices…
                  </p>
                )}
                {step.choices?.length !== 0 &&
                  step.conversion.fields.map((field) => {
                    const offered = step.choices?.find(
                      (choice) => choice.name === field.name,
                    );
                    if (!offered) return null;
                    if (field.type === "SELECT") {
                      return (
                        <div key={field.name} className="flex flex-col gap-1.5">
                          <label className="text-xs font-medium text-muted-foreground">
                            {field.label}
                          </label>
                          <Select
                            value={
                              typeof values[field.name] === "string"
                                ? String(values[field.name])
                                : ""
                            }
                            onValueChange={(value) =>
                              setValues((current) => ({
                                ...current,
                                [field.name]: String(value),
                              }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Choose…" />
                            </SelectTrigger>
                            <SelectContent>
                              {(offered.options ?? []).map((option) => (
                                <SelectItem
                                  key={option.value}
                                  value={option.value}
                                >
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {(offered.options ?? []).length === 0 && (
                            <p className="text-xs text-muted-foreground">
                              Nothing is available to choose from yet.
                            </p>
                          )}
                        </div>
                      );
                    }
                    if (field.type === "NUMBER") {
                      return (
                        <InputGroup key={field.name}>
                          <InputGroupAddon align="block-start">
                            <InputGroupText>
                              {field.label}
                              {offered.max !== undefined
                                ? ` (1 to ${offered.max})`
                                : ""}
                            </InputGroupText>
                          </InputGroupAddon>
                          <InputGroupInput
                            type="number"
                            inputMode="numeric"
                            min={offered.min}
                            max={offered.max}
                            value={
                              typeof values[field.name] === "number"
                                ? String(values[field.name])
                                : ""
                            }
                            onChange={(event) =>
                              setValues((current) => ({
                                ...current,
                                [field.name]:
                                  event.target.value === ""
                                    ? ""
                                    : Number(event.target.value),
                              }))
                            }
                          />
                        </InputGroup>
                      );
                    }
                    return (
                      <label
                        key={field.name}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Checkbox
                          checked={values[field.name] === true}
                          onCheckedChange={(checked) =>
                            setValues((current) => ({
                              ...current,
                              [field.name]: checked === true,
                            }))
                          }
                        />
                        {field.label}
                      </label>
                    );
                  })}
                <InputGroup>
                  <InputGroupAddon align="block-start">
                    <InputGroupText>
                      Note for the team (optional)
                    </InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    value={note}
                    maxLength={300}
                    placeholder="What should they know?"
                    onChange={(event) => setNote(event.target.value)}
                  />
                </InputGroup>
                {error && (
                  <p role="alert" className="text-xs text-destructive">
                    {error}
                  </p>
                )}
              </div>
              <SheetFooter>
                <Button
                  type="button"
                  variant="outline_without_border"
                  onClick={close}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={pending || step.choices === null}
                  onClick={() => review(step.conversion)}
                >
                  {pending ? "Preparing…" : "Review"}
                </Button>
              </SheetFooter>
            </>
          )}
          {step.kind === "review" && (
            <>
              <SheetHeader>
                <SheetTitle>Check before creating</SheetTitle>
                <SheetDescription>
                  Nothing has been created yet. This is what will be made,
                  linked back to this conversation.
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-3 px-4">
                <p className="text-sm font-medium">{step.title}</p>
                <dl className="space-y-2 text-sm">
                  {step.humanDiff.map((line) => (
                    <div
                      key={line.field}
                      className="flex justify-between gap-3"
                    >
                      <dt className="text-muted-foreground capitalize">
                        {line.field}
                      </dt>
                      <dd className="text-right">{String(line.to ?? "—")}</dd>
                    </div>
                  ))}
                </dl>
                {error && (
                  <p role="alert" className="text-xs text-destructive">
                    {error}
                  </p>
                )}
              </div>
              <SheetFooter>
                <Button
                  type="button"
                  variant="outline_without_border"
                  onClick={close}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() => create(step.proposalId, step.conversion)}
                >
                  {pending ? "Creating…" : "Create"}
                </Button>
              </SheetFooter>
            </>
          )}
          {step.kind === "done" && (
            <>
              <SheetHeader>
                <SheetTitle>Created</SheetTitle>
                <SheetDescription>
                  {step.conversion.label} was added and is linked to this
                  conversation.
                </SheetDescription>
              </SheetHeader>
              <SheetFooter>
                <Button
                  type="button"
                  onClick={() => setStep({ kind: "closed" })}
                >
                  Done
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
