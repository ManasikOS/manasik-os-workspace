import { notFound, redirect } from "next/navigation";

import { isUuid } from "@/lib/utils";

/**
 * `/packages/create-package(?id=)` is kept as a redirect for one release so
 * existing bookmarks and any external links keep working. New navigation
 * goes to `/packages/new` and `/packages/[packageId]/edit`.
 */
export default async function CreatePackageRedirect({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  // The id comes straight from the URL: only a real package id is followed.
  if (id !== undefined && !isUuid(id)) notFound();
  redirect(id ? `/packages/${id}/edit` : "/packages/new");
}
