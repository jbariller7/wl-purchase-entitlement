import { google } from "googleapis";

export interface LegacySheetAssignment {
  sheetTab: string;
  rowNumber: number;
}

export interface LegacyPersonalDataSubject {
  emails: string[];
  sheetAssignments: LegacySheetAssignment[];
}

export interface LegacyPersonalDataErasureResult {
  sheetEmailCellsCleared: number;
  mailerLiteSubscribersForgotten: number;
}

interface SheetsClient {
  spreadsheets: {
    values: {
      batchClear(input: {
        spreadsheetId: string;
        requestBody: { ranges: string[] };
      }): Promise<unknown>;
    };
  };
}

interface ErasureDependencies {
  fetchImpl?: typeof fetch;
  sheetsFactory?: () => Promise<SheetsClient>;
  spreadsheetId?: string;
  mailerLiteToken?: string;
}

function required(name: string, override?: string): string {
  const value = override ?? process.env[name];
  if (!value) throw new Error(`Missing ${name} for legacy personal-data erasure.`);
  return value;
}

async function createSheetsClient(): Promise<SheetsClient> {
  const auth = new google.auth.JWT({
    email: required("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    key: required("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  return google.sheets({ version: "v4", auth });
}

function sheetEmailRange(assignment: LegacySheetAssignment): string {
  if (!Number.isSafeInteger(assignment.rowNumber) || assignment.rowNumber < 1) {
    throw new Error("A linked legacy key has an invalid Google Sheet row number.");
  }
  const escapedTab = assignment.sheetTab.replace(/'/g, "''");
  return `'${escapedTab}'!B${assignment.rowNumber}`;
}

export class LegacyPersonalDataErasureService {
  private readonly fetchImpl: typeof fetch;
  private readonly sheetsFactory: () => Promise<SheetsClient>;

  constructor(private readonly dependencies: ErasureDependencies = {}) {
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
    this.sheetsFactory = dependencies.sheetsFactory ?? createSheetsClient;
  }

  private async clearSheetEmails(assignments: LegacySheetAssignment[]): Promise<number> {
    const ranges = [...new Set(assignments.map(sheetEmailRange))];
    if (!ranges.length) return 0;
    const sheets = await this.sheetsFactory();
    const spreadsheetId = required("GOOGLE_SHEET_ID", this.dependencies.spreadsheetId);
    for (let offset = 0; offset < ranges.length; offset += 500) {
      await sheets.spreadsheets.values.batchClear({
        spreadsheetId,
        requestBody: { ranges: ranges.slice(offset, offset + 500) }
      });
    }
    return ranges.length;
  }

  private async forgetMailerLiteSubscriber(email: string): Promise<boolean> {
    const token = required("MAILERLITE_API_TOKEN", this.dependencies.mailerLiteToken);
    const headers = { authorization: `Bearer ${token}`, accept: "application/json" };
    let lookup: Response;
    try {
      lookup = await this.fetchImpl(
        `https://connect.mailerlite.com/api/subscribers/${encodeURIComponent(email)}`,
        { method: "GET", headers, signal: AbortSignal.timeout(20_000) }
      );
    } catch {
      throw new Error("MailerLite subscriber lookup request failed.");
    }
    if (lookup.status === 404) return false;
    if (!lookup.ok) throw new Error(`MailerLite subscriber lookup failed (${lookup.status}).`);
    const body = await lookup.json() as { data?: { id?: string | number } };
    const subscriberId = body.data?.id;
    if (subscriberId === undefined || subscriberId === null || String(subscriberId).length === 0) {
      throw new Error("MailerLite subscriber lookup returned no subscriber ID.");
    }
    let forgotten: Response;
    try {
      forgotten = await this.fetchImpl(
        `https://connect.mailerlite.com/api/subscribers/${encodeURIComponent(String(subscriberId))}/forget`,
        { method: "POST", headers, signal: AbortSignal.timeout(20_000) }
      );
    } catch {
      throw new Error("MailerLite subscriber forget request failed.");
    }
    if (forgotten.status === 404) return false;
    if (!forgotten.ok) throw new Error(`MailerLite subscriber forget failed (${forgotten.status}).`);
    return true;
  }

  async erase(subject: LegacyPersonalDataSubject): Promise<LegacyPersonalDataErasureResult> {
    const emails = [...new Set(subject.emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
    const sheetEmailCellsCleared = await this.clearSheetEmails(subject.sheetAssignments);
    let mailerLiteSubscribersForgotten = 0;
    for (const email of emails) {
      if (await this.forgetMailerLiteSubscriber(email)) mailerLiteSubscribersForgotten += 1;
    }
    return { sheetEmailCellsCleared, mailerLiteSubscribersForgotten };
  }
}
