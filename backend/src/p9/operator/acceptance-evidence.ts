export const ACCEPTANCE_COUNT_TABLES = [
  "User",
  "PasswordCredential",
  "AuthIdentity",
  "Invitation",
  "Session",
  "RefreshToken",
  "Device",
  "DevicePairing",
  "UserSettings",
  "DeviceSettings",
  "AuditEvent",
] as const;

export type AcceptanceCountTable = typeof ACCEPTANCE_COUNT_TABLES[number];
export type AcceptanceCounts = Record<AcceptanceCountTable, number>;
export type AcceptanceEvidencePhase = "fixture-create" | "login" | "cleanup";

export interface AcceptanceCountDatabase {
  [table: string]: { count(args?: unknown): Promise<number> };
}

export interface AcceptanceDeltaResult {
  phase: AcceptanceEvidencePhase;
  ok: boolean;
  delta: Partial<AcceptanceCounts>;
  unexpected: string[];
}

export function emptyAcceptanceCounts(): AcceptanceCounts {
  return Object.fromEntries(ACCEPTANCE_COUNT_TABLES.map((table) => [table, 0])) as AcceptanceCounts;
}

export async function readAcceptanceCounts(database: AcceptanceCountDatabase): Promise<AcceptanceCounts> {
  const entries = await Promise.all(ACCEPTANCE_COUNT_TABLES.map(async (table) => {
    const model = database[table];
    if (!model) throw new Error(`acceptance evidence model is unavailable: ${table}`);
    return [table, await model.count()] as const;
  }));
  return Object.fromEntries(entries) as AcceptanceCounts;
}

function expectedDelta(phase: AcceptanceEvidencePhase): AcceptanceCounts {
  const expected = emptyAcceptanceCounts();
  if (phase === "fixture-create") {
    expected.User = 1;
    expected.PasswordCredential = 1;
    expected.AuthIdentity = 1;
    expected.UserSettings = 1;
  } else if (phase === "login") {
    expected.Session = 1;
    expected.RefreshToken = 1;
    expected.AuditEvent = 1;
  } else {
    expected.User = -1;
    expected.PasswordCredential = -1;
    expected.AuthIdentity = -1;
    expected.UserSettings = -1;
    expected.Session = -1;
    expected.RefreshToken = -1;
    expected.AuditEvent = -1;
  }
  return expected;
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

export function classifyAcceptanceDelta(
  phase: AcceptanceEvidencePhase,
  before: AcceptanceCounts,
  after: AcceptanceCounts,
): AcceptanceDeltaResult {
  const expected = expectedDelta(phase);
  const delta: Partial<AcceptanceCounts> = {};
  const unexpected: string[] = [];
  for (const table of ACCEPTANCE_COUNT_TABLES) {
    const actual = after[table] - before[table];
    delta[table] = actual;
    if (actual !== expected[table]) unexpected.push(`${table}:${signed(actual)} (expected ${signed(expected[table])})`);
  }
  return { phase, ok: unexpected.length === 0, delta, unexpected };
}
