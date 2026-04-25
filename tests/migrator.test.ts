import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MalformedMigrationError,
  MigrationFailedError,
  discoverMigrations,
  runMigrationsFromDir,
} from "../server/db/migrator.ts";

let tempDir: string;
let db: Database;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "claude-remote-migrator-"));
  db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

function writeMigration(filename: string, sql: string) {
  writeFileSync(join(tempDir, filename), sql);
}

function tableExists(name: string): boolean {
  const row = db
    .prepare<{ name: string }, [string]>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .get(name);
  return row !== null;
}

function appliedVersions(): number[] {
  return db
    .prepare<{ version: number }, []>("SELECT version FROM schema_version ORDER BY version")
    .all()
    .map((r) => r.version);
}

describe("Migration Runner", () => {
  test("applies migrations to a fresh database in version order", () => {
    writeMigration("002_add_widgets.sql", "CREATE TABLE widgets (id INTEGER);");
    writeMigration("001_init.sql", "CREATE TABLE things (id INTEGER);");

    const result = runMigrationsFromDir(db, tempDir);

    expect(result.applied.map((m) => m.version)).toEqual([1, 2]);
    expect(appliedVersions()).toEqual([1, 2]);
    expect(tableExists("things")).toBe(true);
    expect(tableExists("widgets")).toBe(true);
  });

  test("is idempotent: running twice on the same directory applies nothing the second time", () => {
    writeMigration("001_init.sql", "CREATE TABLE things (id INTEGER);");
    writeMigration("002_add_widgets.sql", "CREATE TABLE widgets (id INTEGER);");

    runMigrationsFromDir(db, tempDir);
    const second = runMigrationsFromDir(db, tempDir);

    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toEqual([1, 2]);
  });

  test("only applies new migrations when added after a previous run", () => {
    writeMigration("001_init.sql", "CREATE TABLE things (id INTEGER);");
    runMigrationsFromDir(db, tempDir);

    writeMigration("002_add_widgets.sql", "CREATE TABLE widgets (id INTEGER);");
    const second = runMigrationsFromDir(db, tempDir);

    expect(second.applied.map((m) => m.version)).toEqual([2]);
    expect(second.alreadyApplied).toEqual([1]);
    expect(tableExists("widgets")).toBe(true);
  });

  test("creates the schema_version table on first run", () => {
    writeMigration("001_init.sql", "CREATE TABLE things (id INTEGER);");

    expect(tableExists("schema_version")).toBe(false);
    runMigrationsFromDir(db, tempDir);
    expect(tableExists("schema_version")).toBe(true);

    const row = db
      .prepare<{ version: number; name: string; applied_at: string }, []>(
        "SELECT version, name, applied_at FROM schema_version",
      )
      .get();
    expect(row?.version).toBe(1);
    expect(row?.name).toBe("init");
    expect(row?.applied_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("fails loudly on a filename that does not match NNN_<name>.sql", () => {
    writeMigration("001_init.sql", "CREATE TABLE things (id INTEGER);");
    writeMigration("garbage.sql", "CREATE TABLE x (id INTEGER);");

    expect(() => discoverMigrations(tempDir)).toThrow(MalformedMigrationError);
    expect(() => discoverMigrations(tempDir)).toThrow(/garbage\.sql/);
  });

  test("fails loudly on duplicate version numbers", () => {
    writeMigration("001_init.sql", "CREATE TABLE things (id INTEGER);");
    writeMigration("001_other.sql", "CREATE TABLE things2 (id INTEGER);");

    expect(() => discoverMigrations(tempDir)).toThrow(MalformedMigrationError);
    expect(() => discoverMigrations(tempDir)).toThrow(/duplicate version 1/);
  });

  test("fails loudly on an empty migration file", () => {
    writeMigration("001_empty.sql", "   \n  ");

    expect(() => discoverMigrations(tempDir)).toThrow(MalformedMigrationError);
    expect(() => discoverMigrations(tempDir)).toThrow(/empty/);
  });

  test("fails loudly on invalid SQL with a clear error referencing the file", () => {
    writeMigration("001_broken.sql", "CREATE TABEL bad_syntax (id INTEGER);");

    expect(() => runMigrationsFromDir(db, tempDir)).toThrow(MigrationFailedError);
    expect(() => runMigrationsFromDir(db, tempDir)).toThrow(/001_broken\.sql/);
  });

  test("rolls back a failing migration so its version is not recorded", () => {
    writeMigration("001_init.sql", "CREATE TABLE things (id INTEGER);");
    writeMigration(
      "002_partial_then_broken.sql",
      "CREATE TABLE widgets (id INTEGER); INVALID SQL HERE;",
    );

    expect(() => runMigrationsFromDir(db, tempDir)).toThrow(MigrationFailedError);

    expect(appliedVersions()).toEqual([1]);
    expect(tableExists("widgets")).toBe(false);
  });

  test("fails clearly when the migrations directory does not exist", () => {
    const missing = join(tempDir, "does-not-exist");
    expect(() => discoverMigrations(missing)).toThrow(MalformedMigrationError);
  });

  test("returns an empty result when the directory has no .sql files", () => {
    writeFileSync(join(tempDir, "README.md"), "not a migration");

    const result = runMigrationsFromDir(db, tempDir);
    expect(result.applied).toEqual([]);
    expect(result.alreadyApplied).toEqual([]);
    expect(tableExists("schema_version")).toBe(true);
  });
});
