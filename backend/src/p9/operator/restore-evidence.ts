export interface RestoreEvidenceQuery {
  name: string;
  sql: string;
}

export interface RestoreQueryRunner {
  query<T extends Record<string, unknown>>(sql: string): Promise<T[]>;
}

export interface RestoreApplicationEvidence {
  loginStatus: number;
  meStatus: number;
  opsReadyStatus: number;
}

export interface RestoreEvidence {
  migrations: Array<{ name: string; applied: boolean }>;
  schema: string[];
  entityCounts: Record<string, number>;
  orphanChecks: { orphanDevices: number; orphanPairings: number; orphanOwnership: number };
  passwordHashFormat: { invalidHashCount: number };
  lifecycleStates: Array<{ entity: string; state: string; count: number }>;
  settings: {
    timezoneCount: number;
    voiceCount: number;
    minVolume: number;
    maxVolume: number;
    minSpeed: number;
    maxSpeed: number;
  };
  audit: { count: number; eventTypes: string[]; secretBearingMetadataCount: number };
}

const entityTables = [
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

export function buildRestoreEvidenceQueries(): RestoreEvidenceQuery[] {
  const entityCountSql = entityTables
    .map((table) => `SELECT '${table}' AS entity, COUNT(*)::int AS count FROM "${table}"`)
    .join(" UNION ALL ");
  return [
    {
      name: "migrations",
      sql: "SELECT migration_name AS name, finished_at IS NOT NULL AS applied FROM \"_prisma_migrations\" ORDER BY started_at, migration_name",
    },
    {
      name: "schema",
      sql: "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    },
    { name: "entity-counts", sql: entityCountSql },
    {
      name: "orphan-checks",
      sql: "SELECT (SELECT COUNT(*)::int FROM \"Device\" d LEFT JOIN \"User\" u ON u.id = d.\"userId\" WHERE u.id IS NULL) AS \"orphanDevices\", (SELECT COUNT(*)::int FROM \"DevicePairing\" p LEFT JOIN \"Device\" d ON d.id = p.\"deviceId\" AND d.\"userId\" = p.\"userId\" WHERE p.\"deviceId\" IS NOT NULL AND d.id IS NULL) AS \"orphanPairings\", (SELECT COUNT(*)::int FROM \"Device\" d LEFT JOIN \"User\" u ON u.id = d.\"userId\" WHERE u.id IS NULL) AS \"orphanOwnership\"",
    },
    {
      name: "argon2id-password-format",
      sql: "SELECT COUNT(*)::int AS \"invalidHashCount\" FROM \"PasswordCredential\" WHERE \"passwordHash\" NOT LIKE '$argon2id$%'",
    },
    {
      name: "lifecycle-states",
      sql: "SELECT 'Invitation' AS entity, status::text AS state, COUNT(*)::int AS count FROM \"Invitation\" GROUP BY status UNION ALL SELECT 'DevicePairing', status::text, COUNT(*)::int FROM \"DevicePairing\" GROUP BY status UNION ALL SELECT 'Device', status::text, COUNT(*)::int FROM \"Device\" GROUP BY status UNION ALL SELECT 'Session', CASE WHEN \"revokedAt\" IS NULL THEN 'ACTIVE' ELSE 'REVOKED' END, COUNT(*)::int FROM \"Session\" GROUP BY 2 UNION ALL SELECT 'RefreshToken', CASE WHEN \"usedAt\" IS NULL AND \"revokedAt\" IS NULL THEN 'ACTIVE' ELSE 'CLOSED' END, COUNT(*)::int FROM \"RefreshToken\" GROUP BY 2",
    },
    {
      name: "settings-invariants",
      sql: "SELECT (SELECT COUNT(DISTINCT timezone)::int FROM \"UserSettings\") AS \"timezoneCount\", (SELECT COUNT(DISTINCT \"voiceProfileId\")::int FROM \"DeviceSettings\") AS \"voiceCount\", (SELECT COALESCE(MIN(\"playbackVolume\"), 0)::int FROM \"DeviceSettings\") AS \"minVolume\", (SELECT COALESCE(MAX(\"playbackVolume\"), 0)::int FROM \"DeviceSettings\") AS \"maxVolume\", (SELECT COALESCE(MIN(\"speechSpeed\"), 0)::float FROM \"DeviceSettings\") AS \"minSpeed\", (SELECT COALESCE(MAX(\"speechSpeed\"), 0)::float FROM \"DeviceSettings\") AS \"maxSpeed\"",
    },
    {
      name: "audit-summary",
      sql: "SELECT (SELECT COUNT(*)::int FROM \"AuditEvent\") AS count, (SELECT COALESCE(array_agg(\"eventType\"::text ORDER BY \"eventType\"), ARRAY[]::text[]) FROM (SELECT DISTINCT \"eventType\" FROM \"AuditEvent\") types) AS \"eventTypes\", (SELECT COUNT(*)::int FROM \"AuditEvent\" WHERE metadata::text ~* '(password|passphrase|token|secret|private.?key|authorization|credential|jwt)') AS \"secretBearingMetadataCount\"",
    },
  ];
}

export function validateApplicationEvidence(evidence: RestoreApplicationEvidence): RestoreApplicationEvidence {
  if (evidence.loginStatus !== 200) throw new Error("application login evidence failed");
  if (evidence.meStatus !== 200) throw new Error("application /api/v1/me evidence failed");
  if (evidence.opsReadyStatus !== 200) throw new Error("protected operations readiness evidence failed");
  return evidence;
}

export function validateRestoreEvidence(evidence: RestoreEvidence): RestoreEvidence {
  if (evidence.migrations.some((migration) => !migration.applied)) throw new Error("restore migration evidence failed");
  if (evidence.orphanChecks.orphanDevices !== 0 || evidence.orphanChecks.orphanPairings !== 0 || evidence.orphanChecks.orphanOwnership !== 0) {
    throw new Error("restore ownership evidence failed");
  }
  if (evidence.passwordHashFormat.invalidHashCount !== 0) throw new Error("restore password-hash format evidence failed");
  if (
    evidence.settings.timezoneCount !== 1 ||
    evidence.settings.voiceCount !== 1 ||
    evidence.settings.minVolume < 0 || evidence.settings.maxVolume > 100 ||
    evidence.settings.minSpeed <= 0 || evidence.settings.maxSpeed <= 0
  ) throw new Error("restore settings invariant evidence failed");
  if (evidence.audit.secretBearingMetadataCount !== 0) throw new Error("restore audit metadata secret scan failed");
  return evidence;
}

export async function collectRestoreEvidence(queryRunner: RestoreQueryRunner): Promise<RestoreEvidence> {
  const queries = buildRestoreEvidenceQueries();
  const rows = new Map<string, Array<Record<string, unknown>>>();
  for (const query of queries) rows.set(query.name, await queryRunner.query(query.sql));
  const number = (value: unknown): number => typeof value === "number" ? value : Number(value ?? 0);
  const migrations = (rows.get("migrations") ?? []).map((row) => ({ name: String(row.name ?? ""), applied: row.applied === true }));
  const schema = (rows.get("schema") ?? []).map((row) => String(row.table_name ?? ""));
  const entityCounts = Object.fromEntries((rows.get("entity-counts") ?? []).map((row) => [String(row.entity ?? ""), number(row.count)]));
  const orphan = rows.get("orphan-checks")?.[0] ?? {};
  const argon = rows.get("argon2id-password-format")?.[0] ?? {};
  const settings = rows.get("settings-invariants")?.[0] ?? {};
  const audit = rows.get("audit-summary")?.[0] ?? {};
  const lifecycleStates = (rows.get("lifecycle-states") ?? []).map((row) => ({ entity: String(row.entity ?? ""), state: String(row.state ?? ""), count: number(row.count) }));
  return {
    migrations,
    schema,
    entityCounts,
    orphanChecks: {
      orphanDevices: number(orphan.orphanDevices),
      orphanPairings: number(orphan.orphanPairings),
      orphanOwnership: number(orphan.orphanOwnership),
    },
    passwordHashFormat: { invalidHashCount: number(argon.invalidHashCount) },
    lifecycleStates,
    settings: {
      timezoneCount: number(settings.timezoneCount),
      voiceCount: number(settings.voiceCount),
      minVolume: number(settings.minVolume),
      maxVolume: number(settings.maxVolume),
      minSpeed: number(settings.minSpeed),
      maxSpeed: number(settings.maxSpeed),
    },
    audit: {
      count: number(audit.count),
      eventTypes: Array.isArray(audit.eventTypes) ? audit.eventTypes.map(String) : [],
      secretBearingMetadataCount: number(audit.secretBearingMetadataCount),
    },
  };
}
