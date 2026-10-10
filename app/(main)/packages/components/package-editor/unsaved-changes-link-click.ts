/**
 * Decides whether a click on a link would take the person away from this page
 * inside the app, so the editor can ask about unsaved changes first.
 *
 * Returns the place the link goes to (path, query and hash), or `null` when the
 * click should be left alone: modified clicks (new tab / window), downloads,
 * links to another site, links that open elsewhere, and links that stay on the
 * same page (a `#hash` jump or the very same address).
 */
export function getLeavingLinkTarget(input: {
  click: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean };
  link: { href: string; target: string; hasDownload: boolean };
  currentHref: string;
}): string | null {
  const { click, link, currentHref } = input;

  if (click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null;
  if (link.hasDownload) return null;
  if (link.target !== "" && link.target !== "_self") return null;

  let destination: URL;
  let current: URL;
  try {
    destination = new URL(link.href, currentHref);
    current = new URL(currentHref);
  } catch {
    return null;
  }

  if (destination.origin !== current.origin) return null;
  if (destination.pathname === current.pathname && destination.search === current.search) return null;

  return `${destination.pathname}${destination.search}${destination.hash}`;
}
