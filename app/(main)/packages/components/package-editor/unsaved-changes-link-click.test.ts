import { describe, expect, it } from "vitest";

import { getLeavingLinkTarget } from "./unsaved-changes-link-click";

const CURRENT = "https://crm.example.com/packages/new";
const PLAIN_CLICK = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
const PLAIN_LINK = { href: "https://crm.example.com/packages", target: "", hasDownload: false };

describe("getLeavingLinkTarget", () => {
  it("returns the destination of a plain click on an internal link", () => {
    expect(getLeavingLinkTarget({ click: PLAIN_CLICK, link: PLAIN_LINK, currentHref: CURRENT })).toBe("/packages");
  });

  it("keeps the query string and hash", () => {
    const link = { ...PLAIN_LINK, href: "https://crm.example.com/packages?tab=archived#top" };
    expect(getLeavingLinkTarget({ click: PLAIN_CLICK, link, currentHref: CURRENT })).toBe("/packages?tab=archived#top");
  });

  it("leaves modified clicks and non-primary buttons alone", () => {
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      const click = { ...PLAIN_CLICK, ...modifier };
      expect(getLeavingLinkTarget({ click, link: PLAIN_LINK, currentHref: CURRENT })).toBeNull();
    }
  });

  it("leaves links that open elsewhere or download", () => {
    expect(
      getLeavingLinkTarget({ click: PLAIN_CLICK, link: { ...PLAIN_LINK, target: "_blank" }, currentHref: CURRENT }),
    ).toBeNull();
    expect(
      getLeavingLinkTarget({ click: PLAIN_CLICK, link: { ...PLAIN_LINK, hasDownload: true }, currentHref: CURRENT }),
    ).toBeNull();
  });

  it("leaves links to another site", () => {
    const link = { ...PLAIN_LINK, href: "https://example.org/packages" };
    expect(getLeavingLinkTarget({ click: PLAIN_CLICK, link, currentHref: CURRENT })).toBeNull();
  });

  it("leaves links that stay on this page", () => {
    const sameAddress = { ...PLAIN_LINK, href: CURRENT };
    const hashJump = { ...PLAIN_LINK, href: `${CURRENT}#section` };
    expect(getLeavingLinkTarget({ click: PLAIN_CLICK, link: sameAddress, currentHref: CURRENT })).toBeNull();
    expect(getLeavingLinkTarget({ click: PLAIN_CLICK, link: hashJump, currentHref: CURRENT })).toBeNull();
  });
});
