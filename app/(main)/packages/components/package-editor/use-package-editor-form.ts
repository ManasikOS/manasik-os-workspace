"use client";

import { useCallback, useMemo, useState } from "react";

import { computePackageChanges } from "@/lib/packages/change-diff";

import type { PackageFormData } from "../../create-package/types";

/**
 * The form the person is editing, and how it differs from what the database
 * holds. Nothing here saves anything — see `usePackageEditorSave`.
 */
export function usePackageEditorForm(initialFormData: PackageFormData) {
  const [formData, setFormData] = useState<PackageFormData>(initialFormData);
  // What the database holds right now, as far as this browser knows: the form as loaded, then as last saved.
  const [savedForm, setSavedForm] = useState<PackageFormData>(initialFormData);

  const changes = useMemo(() => computePackageChanges(savedForm, formData), [savedForm, formData]);
  // Payment, contract and booking changes (tier above 0) need a review before a package on sale is saved.
  const sensitiveChanges = useMemo(() => changes.filter((change) => change.tier > 0), [changes]);

  /** Records that `form` is now what the database holds. */
  const markSaved = useCallback((form: PackageFormData) => setSavedForm(form), []);

  return {
    formData,
    setFormData,
    changes,
    sensitiveChanges,
    isDirty: changes.length > 0,
    markSaved,
  };
}
