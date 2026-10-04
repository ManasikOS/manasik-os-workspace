/**
 * `.xlsx` read/write for the Departure Groups import/export. The actual
 * implementation is generic and lives in `@/lib/xlsx` — re-exported here so
 * existing imports (`../xlsx`) keep working.
 */

export { XLSX_MIME, parseXlsx, matrixToXlsx, readSpreadsheetFile } from "@/lib/xlsx";
