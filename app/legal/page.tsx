import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Legal" };

export default function LegalIndexPage() {
  return (
    <>
      <h1>Legal</h1>
      <ul>
        <li>
          <Link href="/legal/privacy">Privacy Policy</Link>
        </li>
        <li>
          <Link href="/legal/terms">Terms of Service</Link>
        </li>
        <li>
          <Link href="/legal/data-deletion">Data Deletion Instructions</Link>
        </li>
      </ul>
    </>
  );
}
