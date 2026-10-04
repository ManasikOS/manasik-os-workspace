/**
 * CSV/XLSX export for the Packages list.
 *
 * Reuses the generic encoders from the Departure Groups module
 * (`toCsv`, `downloadTextFile`, `downloadBinaryFile`, `timestampedFilename`,
 * `matrixToXlsx`) rather than re-implementing them — those functions carry no
 * Departure-Groups-specific types.
 */
import {
  downloadBinaryFile,
  downloadTextFile,
  timestampedFilename,
  toCsv,
} from "@/app/(main)/departure-groups/csv";
import { matrixToXlsx, XLSX_MIME } from "@/app/(main)/departure-groups/xlsx";
import type { PackageListItem } from "@/lib/types/packages";

export { downloadBinaryFile, downloadTextFile, timestampedFilename, XLSX_MIME };

const HEADERS = [
  "Code",
  "Title",
  "Journey Type",
  "Category",
  "Branch",
  "Status",
  "Visibility",
  "Featured",
  "Duration",
  "Completeness %",
  "Live Groups",
  "Seats Booked",
  "Seats Capacity",
  "Updated",
];

export function packagesToMatrix(items: PackageListItem[]): string[][] {
  return [
    HEADERS,
    ...items.map((p) => [
      p.code,
      p.title,
      p.journeyType,
      p.packageCategory,
      p.branch,
      p.status,
      p.visibility,
      p.featured ? "Yes" : "No",
      p.durationLabel,
      String(p.completeness),
      String(p.liveGroupCount),
      String(p.seatsBooked),
      String(p.seatsCapacity),
      new Date(p.updatedAt).toISOString(),
    ]),
  ];
}

export function packagesToCsv(items: PackageListItem[]): string {
  return toCsv(packagesToMatrix(items));
}

export function matrixToXlsxFile(items: PackageListItem[]) {
  return matrixToXlsx(packagesToMatrix(items), "Packages");
}
