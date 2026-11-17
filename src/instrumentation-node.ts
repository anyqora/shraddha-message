import path from "node:path";
import fs from "node:fs";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { db } from "./lib/db";

export async function runMigrations() {
  if (!process.env.DATABASE_URL) return;
  const folder = [path.join(process.cwd(), "drizzle"), path.join(process.cwd(), "..", "..", "drizzle")].find((p) => fs.existsSync(p));
  if (!folder) return console.warn("[migrate] drizzle folder not found");
  try {
    await migrate(db, { migrationsFolder: folder });
    console.log("[migrate] database is up to date");
  } catch (e) {
    console.error("[migrate] failed", e);
  }
}
