/**
 * Checking what the person chose (MI4.6). Pure: given the choices the SERVER offered for a conversion and the values that came
 * back from the browser, say which are acceptable and what each is called. A value that was not on offer is refused here, before
 * any request is written — the browser never gets to name an id the server did not put in front of it. (Each kind's executor
 * checks again at execution, because the world may have moved since.)
 */

import {
  CONVERSION_CATALOGUE,
  type ConversionFieldChoices,
  type ConversionKind,
  type ConversionParams,
} from "@/lib/inbox/conversions/catalogue";

export type CheckedConversionParams =
  | { ok: true; params: ConversionParams; labels: Record<string, string> }
  | { ok: false; error: string };

export function validateConversionParams(kind: ConversionKind, given: Record<string, unknown>, choices: readonly ConversionFieldChoices[]): CheckedConversionParams {
  const params: ConversionParams = {};
  const labels: Record<string, string> = {};

  for (const field of CONVERSION_CATALOGUE[kind].fields) {
    const offered = choices.find((choice) => choice.name === field.name);
    const value = given[field.name];

    if (field.type === "SELECT") {
      const option = offered?.options?.find((candidate) => candidate.value === value);
      if (!option) return { ok: false, error: `Choose ${field.label.toLowerCase()} from the list.` };
      params[field.name] = option.value;
      labels[field.name] = option.label;
    } else if (field.type === "NUMBER") {
      const number = typeof value === "number" ? value : Number.NaN;
      const min = offered?.min ?? 1;
      const max = offered?.max ?? min;
      if (!Number.isInteger(number) || number < min || number > max) {
        return { ok: false, error: max < min ? `${field.label} is not available right now.` : `${field.label} must be a whole number from ${min} to ${max}.` };
      }
      params[field.name] = number;
    } else {
      // A yes/no left blank means no.
      params[field.name] = value === true;
    }
  }

  return { ok: true, params, labels };
}
