import { redirect } from "next/navigation";

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
  redirect(id ? `/packages/${id}/edit` : "/packages/new");
}
