import { VERSION, type Arc0Config } from "./config.js";

/**
 * Migration functions for config version updates.
 * Each function migrates from one version to the next.
 */

type MigrationFn = (config: Arc0Config) => Arc0Config;

// Map of version -> migration function to apply
const migrations: Record<string, MigrationFn> = {
  // Example: "1.0.0": (config) => { ...transform config... return config; }
};

/**
 * Compare semver versions.
 * Returns -1 if a < b, 0 if equal, 1 if a > b
 */
function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    const va = partsA[i] ?? 0;
    const vb = partsB[i] ?? 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

/**
 * Get ordered list of migration versions between two versions.
 */
function getMigrationVersions(
  fromVersion: string,
  toVersion: string,
): string[] {
  return Object.keys(migrations)
    .filter(
      (v) =>
        compareVersions(v, fromVersion) > 0 &&
        compareVersions(v, toVersion) <= 0,
    )
    .sort(compareVersions);
}

/**
 * Run migrations on config if needed.
 * Returns the migrated config with updated version.
 */
export function migrateConfig(config: Arc0Config): Arc0Config {
  const configVersion = config.version ?? "0.0.0";

  if (compareVersions(configVersion, VERSION) >= 0) {
    // Config is current or newer, no migration needed
    return config;
  }

  const versionsToApply = getMigrationVersions(configVersion, VERSION);

  let migratedConfig = { ...config };
  for (const version of versionsToApply) {
    const migrationFn = migrations[version];
    if (migrationFn) {
      migratedConfig = migrationFn(migratedConfig);
    }
  }

  // Update version to current
  migratedConfig.version = VERSION;

  return migratedConfig;
}

/**
 * Check if config needs migration.
 */
export function needsMigration(config: Arc0Config): boolean {
  const configVersion = config.version ?? "0.0.0";
  return compareVersions(configVersion, VERSION) < 0;
}
