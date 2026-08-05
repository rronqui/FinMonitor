import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { migrate } from "./migrations";

const DB_PATH = process.env.FINMONITOR_DB_PATH ?? path.join(process.cwd(), "data", "finmonitor.db");

let instance: Database.Database | null = null;

export function db(): Database.Database {
  if (instance) return instance;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const d = new Database(DB_PATH);
  d.pragma("journal_mode = WAL");
  migrate(d);
  instance = d;
  return d;
}

export function getMeta(key: string): string | undefined {
  const row = db().prepare("SELECT value FROM meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setMeta(key: string, value: string): void {
  db()
    .prepare(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}
