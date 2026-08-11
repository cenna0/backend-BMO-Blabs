export const P9_REQUIRED_MIGRATIONS = [
  "20260804110000_p9_1_foundation",
  "20260804123000_p9_1_integrity_constraints",
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
