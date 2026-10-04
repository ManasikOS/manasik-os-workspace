"use client";

import { ArrowDown, ArrowUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@/components/ui/input-group";
import {
  EMOJI_LEVELS,
  ENQUIRY_QUESTION_OPTIONS,
  HANDOFF_STYLES,
  MESSAGE_FORMATS,
  PACKAGE_DETAIL_OPTIONS,
  PACKAGE_ENQUIRY_STYLES,
  REPLY_LENGTHS,
  type AiBehaviour,
} from "@/lib/validations/ai-behaviour";

const REPLY_LENGTH_LABELS: Record<(typeof REPLY_LENGTHS)[number], string> = {
  SHORT: "Very short (1-3 sentences)",
  BALANCED: "Balanced",
  DETAILED: "Detailed when asked",
};
const EMOJI_LABELS: Record<(typeof EMOJI_LEVELS)[number], string> = {
  NONE: "No emoji",
  LIGHT: "A little",
  FREE: "Freely",
};
const FORMAT_LABELS: Record<(typeof MESSAGE_FORMATS)[number], string> = {
  PLAIN: "Plain sentences",
  BULLETS: "Bullet lines and bold",
};
const PACKAGE_ENQUIRY_LABELS: Record<(typeof PACKAGE_ENQUIRY_STYLES)[number], { title: string; hint: string }> = {
  ASK_FIRST: { title: "Ask first, then show", hint: "Asks how many are travelling before listing anything." },
  SHORT_SUMMARY: { title: "Short summary, then ask", hint: "Name, dates and starting price; details only when they pick one." },
  FULL_DETAILS: { title: "Show full details straight away", hint: "Lists every open departure with the details you tick below." },
};
const HANDOFF_LABELS: Record<(typeof HANDOFF_STYLES)[number], { title: string; hint: string }> = {
  AFTER_ENQUIRY: { title: "After collecting the enquiry", hint: "Tells the customer your team will follow up, then hands over." },
  WHEN_ASKED: { title: "Only when the customer asks", hint: "Keeps helping until they ask for a person." },
  OFFER_ALWAYS: { title: "Always offer a person", hint: "Mentions that a colleague can take over after each answer." },
};

function RadioGroupField<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  disabled,
}: {
  legend: string;
  name: string;
  options: { value: T; title: string; hint?: string }[];
  value: T;
  onChange: (next: T) => void;
  disabled: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-xs font-medium">{legend}</legend>
      <div className="flex flex-col gap-1.5">
        {options.map((option) => (
          <label key={option.value} className="flex items-start gap-2 text-sm">
            <input
              className="mt-1"
              type="radio"
              name={name}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              disabled={disabled}
            />
            <span>
              {option.title}
              {option.hint && <span className="block text-xs text-muted-foreground">{option.hint}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function AiBehaviourFields({
  behaviour,
  onChange,
  canEdit,
}: {
  behaviour: AiBehaviour;
  onChange: (next: AiBehaviour) => void;
  canEdit: boolean;
}) {
  const patch = (partial: Partial<AiBehaviour>) => onChange({ ...behaviour, ...partial });

  const toggleDetail = (key: string) =>
    patch({
      detailsToShow: behaviour.detailsToShow.includes(key)
        ? behaviour.detailsToShow.filter((item) => item !== key)
        : [...behaviour.detailsToShow, key],
    });

  const toggleQuestion = (key: string) =>
    patch({
      questionsToAsk: behaviour.questionsToAsk.includes(key)
        ? behaviour.questionsToAsk.filter((item) => item !== key)
        : [...behaviour.questionsToAsk, key],
    });

  const moveQuestion = (index: number, direction: -1 | 1) => {
    const next = [...behaviour.questionsToAsk];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    patch({ questionsToAsk: next });
  };

  const questionLabel = (key: string) => ENQUIRY_QUESTION_OPTIONS.find((option) => option.key === key)?.label ?? key;

  return (
    <div className="border-t pt-4 flex flex-col gap-5">
      <div>
        <h3 className="text-sm font-semibold">How the assistant talks</h3>
        <p className="text-xs text-muted-foreground">
          Choose how replies look and what the assistant asks. These apply to every new reply, on any channel, once saved.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <RadioGroupField
          legend="Reply length"
          name="reply-length"
          value={behaviour.replyLength}
          onChange={(replyLength) => patch({ replyLength })}
          disabled={!canEdit}
          options={REPLY_LENGTHS.map((value) => ({ value, title: REPLY_LENGTH_LABELS[value] }))}
        />
        <RadioGroupField
          legend="Emoji"
          name="emoji"
          value={behaviour.emoji}
          onChange={(emoji) => patch({ emoji })}
          disabled={!canEdit}
          options={EMOJI_LEVELS.map((value) => ({ value, title: EMOJI_LABELS[value] }))}
        />
        <RadioGroupField
          legend="Message style"
          name="message-format"
          value={behaviour.format}
          onChange={(format) => patch({ format })}
          disabled={!canEdit}
          options={MESSAGE_FORMATS.map((value) => ({ value, title: FORMAT_LABELS[value] }))}
        />
      </div>

      <RadioGroupField
        legend="When a customer asks about packages"
        name="package-enquiry"
        value={behaviour.packageEnquiry}
        onChange={(packageEnquiry) => patch({ packageEnquiry })}
        disabled={!canEdit}
        options={PACKAGE_ENQUIRY_STYLES.map((value) => ({ value, ...PACKAGE_ENQUIRY_LABELS[value] }))}
      />

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-xs font-medium">Details to include when showing a package</legend>
        <p className="text-xs text-muted-foreground">
          The assistant only states what your package data actually contains, so ticking Hotels does nothing until hotels are
          confirmed for that departure.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {PACKAGE_DETAIL_OPTIONS.map((option) => (
            <label key={option.key} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={behaviour.detailsToShow.includes(option.key)}
                onCheckedChange={() => toggleDetail(option.key)}
                disabled={!canEdit}
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium">Questions to ask a new enquiry, in this order</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {ENQUIRY_QUESTION_OPTIONS.map((option) => (
            <label key={option.key} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={behaviour.questionsToAsk.includes(option.key)}
                onCheckedChange={() => toggleQuestion(option.key)}
                disabled={!canEdit}
              />
              {option.label}
            </label>
          ))}
        </div>
        {behaviour.questionsToAsk.length > 1 && (
          <ol className="flex flex-col gap-1 rounded-md border p-2">
            {behaviour.questionsToAsk.map((key, index) => (
              <li key={key} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {index + 1}. {questionLabel(key)}
                </span>
                {canEdit && (
                  <span className="flex gap-1">
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      aria-label={`Move ${questionLabel(key)} up`}
                      disabled={index === 0}
                      onClick={() => moveQuestion(index, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      aria-label={`Move ${questionLabel(key)} down`}
                      disabled={index === behaviour.questionsToAsk.length - 1}
                      onClick={() => moveQuestion(index, 1)}
                    >
                      <ArrowDown />
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={behaviour.oneQuestionAtATime}
            onCheckedChange={(checked) => patch({ oneQuestionAtATime: Boolean(checked) })}
            disabled={!canEdit}
          />
          Ask only one question per message
        </label>
      </fieldset>

      <RadioGroupField
        legend="When a person from your team takes over"
        name="handoff-style"
        value={behaviour.handoff}
        onChange={(handoff) => patch({ handoff })}
        disabled={!canEdit}
        options={HANDOFF_STYLES.map((value) => ({ value, ...HANDOFF_LABELS[value] }))}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <InputGroup>
          <InputGroupAddon align="block-start">Greeting (optional)</InputGroupAddon>
          <InputGroupTextarea
            value={behaviour.greeting}
            onChange={(event) => patch({ greeting: event.target.value })}
            disabled={!canEdit}
            rows={3}
            maxLength={400}
            placeholder="Assalamu alaikum! Welcome to Royal Fathima Travels. How can we help with your Umrah or Hajj plans?"
          />
        </InputGroup>
        <InputGroup>
          <InputGroupAddon align="block-start">Closing message (optional)</InputGroupAddon>
          <InputGroupTextarea
            value={behaviour.closing}
            onChange={(event) => patch({ closing: event.target.value })}
            disabled={!canEdit}
            rows={3}
            maxLength={400}
            placeholder="Thank you! Our team will call you within one hour."
          />
        </InputGroup>
      </div>

      <InputGroup>
        <InputGroupAddon align="block-start">Your own rules (optional)</InputGroupAddon>
        <InputGroupTextarea
          value={behaviour.extraRules}
          onChange={(event) => patch({ extraRules: event.target.value })}
          disabled={!canEdit}
          rows={4}
          maxLength={2000}
          placeholder="Anything else, in plain words. For example: never discuss visa fees; always mention we run family groups; offer a call after 6 pm."
        />
      </InputGroup>
    </div>
  );
}
