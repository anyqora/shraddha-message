import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "@/db/schema";

const g = globalThis as unknown as { __smPool?: mysql.Pool };

export const pool: mysql.Pool =
  g.__smPool ??
  mysql.createPool({
    uri: process.env.DATABASE_URL || "mysql://localhost/none",
    connectionLimit: Number(process.env.DATABASE_POOL_MAX ?? 5),
    timezone: "Z",
    charset: "utf8mb4",
    dateStrings: false,
  });
g.__smPool = pool;

export const db = drizzle(pool, { schema, mode: "default" });
