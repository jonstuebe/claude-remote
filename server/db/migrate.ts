#!/usr/bin/env bun
import { resolve } from "node:path";
import { loadConfig } from "../config.ts";
import { openDatabase } from "./client.ts";
import { runMigrationsFromDir } from "./migrator.ts";

const MIGRATIONS_DIR = resolve(import.meta.dir, "migrations");

function main() {
  const config = loadConfig();
  const db = openDatabase(config.dbPath);

  try {
    const result = runMigrationsFromDir(db, MIGRATIONS_DIR);
    if (result.applied.length === 0) {
      console.log(
        `[db] no pending migrations (${result.alreadyApplied.length} already applied) — ${config.dbPath}`,
      );
    } else {
      for (const m of result.applied) {
        console.log(`[db] applied migration ${m.filename}`);
      }
      console.log(`[db] ${result.applied.length} migration(s) applied — ${config.dbPath}`);
    }
  } catch (err) {
    console.error("[db] migration failed:");
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
