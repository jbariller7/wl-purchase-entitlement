import { google } from "googleapis";
import { SHEET_TAB_BY_PRODUCT } from "./catalog.js";

export interface KeyInventoryCount {
  sheetTab: string;
  available: number;
  assigned: number;
  total: number;
  duplicateRows: number;
}

export interface FirestoreInventoryCount {
  sheetTab: string;
  available: number;
  assigned: number;
}

interface SheetsClient {
  spreadsheets: {
    values: {
      get(input: { spreadsheetId: string; range: string }): Promise<{ data: { values?: unknown[][] | null } }>;
    };
  };
}

interface KeyInventoryDiagnosticDependencies {
  sheetsFactory?: () => Promise<SheetsClient>;
  spreadsheetId?: string;
  tabs?: string[];
}

function required(name: string, override?: string): string {
  const value = override ?? process.env[name];
  if (!value) throw new Error(`Missing ${name} for the key-inventory diagnostic.`);
  return value;
}

async function createSheetsClient(): Promise<SheetsClient> {
  const auth = new google.auth.JWT({
    email: required("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    key: required("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  });
  return google.sheets({ version: "v4", auth }) as unknown as SheetsClient;
}

function escapedSheetRange(sheetTab: string): string {
  return `'${sheetTab.replace(/'/g, "''")}'!A2:B`;
}

export function summarizeKeyInventoryRows(sheetTab: string, rows: unknown[][]): KeyInventoryCount {
  let available = 0;
  let assigned = 0;
  let duplicateRows = 0;
  const seen = new Set<string>();
  for (const row of rows) {
    const key = String(row[0] ?? "").trim();
    if (!key) continue;
    if (seen.has(key)) duplicateRows += 1;
    else seen.add(key);
    // Column B contains the assignment email in the historical sheet. It is
    // inspected only for blank/nonblank state and is never returned or logged.
    if (String(row[1] ?? "").trim()) assigned += 1;
    else available += 1;
  }
  return { sheetTab, available, assigned, total: available + assigned, duplicateRows };
}

export class LegacyKeyInventoryDiagnosticService {
  private readonly sheetsFactory: () => Promise<SheetsClient>;
  private readonly tabs: string[];

  constructor(private readonly dependencies: KeyInventoryDiagnosticDependencies = {}) {
    this.sheetsFactory = dependencies.sheetsFactory ?? createSheetsClient;
    this.tabs = [...new Set(dependencies.tabs ?? Object.values(SHEET_TAB_BY_PRODUCT))].sort();
  }

  async compare(firestoreSummary: FirestoreInventoryCount[], now: Date): Promise<Record<string, unknown>> {
    const checkedAt = now.toISOString();
    try {
      const sheets = await this.sheetsFactory();
      const spreadsheetId = required("GOOGLE_SHEET_ID", this.dependencies.spreadsheetId);
      const source: KeyInventoryCount[] = [];
      for (const sheetTab of this.tabs) {
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: escapedSheetRange(sheetTab)
        });
        source.push(summarizeKeyInventoryRows(sheetTab, response.data.values ?? []));
      }

      const firestoreByTab = new Map(firestoreSummary.map((row) => [row.sheetTab, row]));
      const tabs = source.map((sheet) => {
        const firestore = firestoreByTab.get(sheet.sheetTab) ?? { available: 0, assigned: 0 };
        const firestoreTotal = firestore.available + firestore.assigned;
        return {
          sheetTab: sheet.sheetTab,
          sheet: {
            available: sheet.available,
            assigned: sheet.assigned,
            total: sheet.total,
            duplicateRows: sheet.duplicateRows
          },
          firestore: {
            available: firestore.available,
            assigned: firestore.assigned,
            total: firestoreTotal
          },
          delta: {
            available: sheet.available - firestore.available,
            assigned: sheet.assigned - firestore.assigned,
            total: sheet.total - firestoreTotal
          },
          matches: sheet.available === firestore.available &&
            sheet.assigned === firestore.assigned && sheet.duplicateRows === 0
        };
      });
      const sheetTotals = source.reduce((totals, row) => ({
        available: totals.available + row.available,
        assigned: totals.assigned + row.assigned,
        total: totals.total + row.total,
        duplicateRows: totals.duplicateRows + row.duplicateRows
      }), { available: 0, assigned: 0, total: 0, duplicateRows: 0 });
      const firestoreTotals = firestoreSummary.reduce((totals, row) => ({
        available: totals.available + row.available,
        assigned: totals.assigned + row.assigned,
        total: totals.total + row.available + row.assigned
      }), { available: 0, assigned: 0, total: 0 });
      const firestoreInitialized = firestoreTotals.total > 0;
      const allMatch = tabs.every((row) => row.matches) &&
        firestoreSummary.every((row) => this.tabs.includes(row.sheetTab));
      const state = sheetTotals.total === 0
        ? "empty_source"
        : !firestoreInitialized && sheetTotals.duplicateRows === 0
          ? "ready_for_initial_import"
          : allMatch
            ? "in_sync"
            : "mismatch";
      const issues = [
        ...(sheetTotals.duplicateRows ? [`${sheetTotals.duplicateRows} duplicate key row${sheetTotals.duplicateRows === 1 ? "" : "s"} must be resolved in Google Sheets before import.`] : []),
        ...(state === "ready_for_initial_import" ? ["Firestore is empty and the Google Sheet is ready for the one-time import dry run."] : []),
        ...(state === "mismatch" ? ["Google Sheets and Firestore counts differ. Keep fulfillment disabled until the discrepancy is understood."] : []),
        ...(state === "empty_source" ? ["No key rows were found in the configured Google Sheet tabs."] : [])
      ];
      return {
        checkedAt,
        readOnly: true,
        state,
        passed: state === "in_sync",
        readyForInitialImport: state === "ready_for_initial_import",
        sheet: sheetTotals,
        firestore: firestoreTotals,
        tabs,
        issues
      };
    } catch {
      return {
        checkedAt,
        readOnly: true,
        state: "unavailable",
        passed: false,
        readyForInitialImport: false,
        sheet: null,
        firestore: null,
        tabs: [],
        issues: ["Google Sheets inventory could not be read with the configured server credential."]
      };
    }
  }
}
