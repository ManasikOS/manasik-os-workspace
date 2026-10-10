/**
 * What pressing "Save" does. One place decides it, so the footer button and the
 * "save and leave" prompt can never disagree.
 *
 * - `save-draft`     the package is not on sale: save it as a draft.
 * - `review-first`   it is on sale and a payment, contract or booking term
 *                    changed: show the comparison and ask for a reason first.
 * - `save-directly`  it is on sale and only display text changed: save at once.
 */
export type PackageSaveRoute = "save-draft" | "review-first" | "save-directly";

/**
 * A step can be opened when it is behind you, or when every step before it is
 * valid. `stepValidity` is keyed by 1-based step number, `targetIndex` is 0-based.
 */
export function canOpenPackageEditorStep(input: {
  targetIndex: number;
  activeStep: number;
  stepValidity: Readonly<Record<number, boolean>>;
}): boolean {
  const { targetIndex, activeStep, stepValidity } = input;
  if (targetIndex <= activeStep) return true;
  for (let step = 1; step <= targetIndex; step++) {
    if (!stepValidity[step]) return false;
  }
  return true;
}

export function decidePackageSaveRoute(input: {
  isLive: boolean;
  sensitiveChangeCount: number;
}): PackageSaveRoute {
  if (!input.isLive) return "save-draft";
  return input.sensitiveChangeCount > 0 ? "review-first" : "save-directly";
}
