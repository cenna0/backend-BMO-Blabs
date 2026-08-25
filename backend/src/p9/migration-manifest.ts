export const P9_REQUIRED_MIGRATIONS = [
  "20260804110000_p9_1_foundation",
  "20260804123000_p9_1_integrity_constraints",
  "20260811190000_phase2_application_foundation",
  "20260814120000_whatsapp_conversations",
  "20260814210000_whatsapp_identity_aliases",
  "20260815120000_spotify_phase26_lifecycle",
  "20260818110000_pairing_code_only_enrollment",
  "20260824100000_one_active_device_per_user",
] as const;

export interface P9MigrationState {
  name: string;
  finishedAt: Date | null;
}

export function areRequiredP9MigrationsFinished(
  migrations: readonly P9MigrationState[],
): boolean {
  const finishedNames = new Set(
    migrations
      .filter((migration) => migration.finishedAt !== null)
      .map((migration) => migration.name),
  );
  return P9_REQUIRED_MIGRATIONS.every((name) => finishedNames.has(name));
}
