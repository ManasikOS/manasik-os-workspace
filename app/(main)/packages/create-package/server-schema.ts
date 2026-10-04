/**
 * Re-exported from the single source of truth at `lib/validations/packages.ts`.
 * Kept here so existing relative imports (`./server-schema`) inside the
 * packages route keep working without a wider rename.
 */
export { packageFormSchema, packageFormPatchSchema, toPackageFormData } from "@/lib/validations/packages";
