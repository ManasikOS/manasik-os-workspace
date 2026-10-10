"use client";

import PageHeader from "@/components/page-header";
import { useProgressRouter } from "@/hooks/use-progress-router";

import { INITIAL_PACKAGE_FORM_DATA } from "../../create-package/types";
import type { PackageEditSnapshot } from "../../package-edit-snapshot";
import { PackageEditorWorkspace } from "./package-editor-workspace";

interface PackageEditorScreenProps {
  mode: "create" | "edit";
  /** Required when `mode` is `"edit"`. */
  packageId?: string;
  /** What the server loaded for the package being edited. Not used when creating. */
  snapshot?: PackageEditSnapshot;
}

/**
 * The page that creates or edits a package: a heading, then the editor as one
 * long page of sections. Leaving goes back to the package (edit) or the
 * Packages list (create).
 */
export default function PackageEditorScreen({ mode, packageId, snapshot }: PackageEditorScreenProps) {
  const router = useProgressRouter();
  const returnTo = mode === "edit" && packageId ? `/packages/${packageId}` : "/packages";
  const title = mode === "edit" ? snapshot?.formData.title.trim() || "Untitled package" : "New package";

  return (
    <div className="mx-auto flex w-full flex-col gap-6 pb-6">
      <PageHeader
        title={mode === "edit" ? "Edit package" : "Create package"}
        subTitle={mode === "edit" ? title : "Build a commercial & operational template for sales and Departure Groups."}
        breadcrumb={[
          { title: "Home", link: "/dashboard" },
          { title: "Packages", link: "/packages" },
          ...(mode === "edit" && packageId ? [{ title, link: returnTo }] : []),
          mode === "edit" && packageId
            ? { title: "Edit", link: `/packages/${packageId}/edit` }
            : { title: "New", link: "/packages/new" },
        ]}
        action={null}
      />

      <PackageEditorWorkspace
        mode={mode}
        initialPackageId={mode === "edit" ? (packageId ?? null) : null}
        initialFormData={snapshot?.formData ?? INITIAL_PACKAGE_FORM_DATA}
        initialUpdatedAt={snapshot?.updatedAt ?? null}
        initialStatus={snapshot?.status ?? "Draft"}
        initialLiveGroupCount={snapshot?.liveGroupCount ?? 0}
        initialPendingChange={snapshot?.pendingChange ?? null}
        canEditSensitiveTerms={snapshot?.canEditSensitiveTerms ?? true}
        onClose={() => router.push(returnTo)}
        onDraftSaved={({ packageId: savedId, isFirstSave }) => {
          // A new draft now has an id. Put it in the address so a refresh reopens
          // this draft instead of an empty form (which would save a second copy).
          if (isFirstSave) window.history.replaceState(window.history.state, "", `/packages/${savedId}/edit`);
        }}
        onPublished={(publishedId) => {
          router.push(`/packages/${publishedId}`);
          router.refresh();
        }}
      />
    </div>
  );
}
