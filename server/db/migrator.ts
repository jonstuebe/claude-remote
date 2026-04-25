import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Database } from "bun:sqlite";

export type Migration = {
  version: number;
  name: string;
  filename: string;
  sql: string;
};

export type MigrationRunResult = {
  applied: Migration[];
  alreadyApplied: number[];
};

export class MalformedMigrationError extends Error {
  constructor(message: string) {
    super(`Malformed migration: ${message}`);
    this.name = "MalformedMigrationError";
  }
}

export class MigrationFailedError extends Error {
  override readonly cause: unknown;
  constructor(migration: Migration, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Migration ${migration.filename} (version ${migration.version}) failed: ${reason}`);
    this.name = "MigrationFailedError";
    this.cause = cause;
  }
}

const FILENAME_PATTERN = /^(\d+)_([A-Za-z0-9][A-Za-z0-9_-]*)\.sql$/;

export function discoverMigrations(dir: string): Migration[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    throw new MalformedMigrationError(
      `cannot read migrations directory "${dir}": ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const sqlFiles = entries.filter((name) => name.endsWith(".sql")).sort();
  const seenVersions = new Map<number, string>();
  const migrations: Migration[] = [];

  for (const filename of sqlFiles) {
    const match = FILENAME_PATTERN.exec(filename);
    if (!match) {
      throw new MalformedMigrationError(
        `filename "${filename}" does not match the required pattern "<number>_<name>.sql" (e.g. "001_init.sql")`,
      );
    }

    const version = Number.parseInt(match[1]!, 10);
    if (!Number.isInteger(version) || version <= 0) {
      throw new MalformedMigrationError(`filename "${filename}" has a non-positive version number`);
    }

    const previous = seenVersions.get(version);
    if (previous) {
      throw new MalformedMigrationError(
        `duplicate version ${version} — found in both "${previous}" and "${filename}"`,
      );
    }
    seenVersions.set(version, filename);

    const fullPath = resolve(dir, filename);
    const sql = readFileSync(fullPath, "utf8");
    if (sql.trim().length === 0) {
      throw new MalformedMigrationError(
        `migration "${filename}" is empty — every migration must contain at least one SQL statement`,
      );
    }

    migrations.push({ version, name: match[2]!, filename, sql });
  }

  migrations.sort((a, b) => a.version - b.version);
  return migrations;
}

function ensureSchemaVersionTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

function readAppliedVersions(db: Database): Set<number> {
  const rows = db.prepare<{ version: number }, []>("SELECT version FROM schema_version").all();
  return new Set(rows.map((r) => r.version));
}

export function runMigrations(db: Database, migrations: Migration[]): MigrationRunResult {
  ensureSchemaVersionTable(db);
  const applied = readAppliedVersions(db);

  const apply = db.transaction((m: Migration) => {
    db.exec(m.sql);
    db.run("INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)", [
      m.version,
      m.name,
      new Date().toISOString(),
    ]);
  });

  const newlyApplied: Migration[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    try {
      apply(migration);
    } catch (err) {
      throw new MigrationFailedError(migration, err);
    }
    newlyApplied.push(migration);
  }

  return {
    applied: newlyApplied,
    alreadyApplied: [...applied].sort((a, b) => a - b),
  };
}

export function runMigrationsFromDir(db: Database, dir: string): MigrationRunResult {
  return runMigrations(db, discoverMigrations(dir));
}
