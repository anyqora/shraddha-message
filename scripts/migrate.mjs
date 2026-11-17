// Usage: DATABASE_URL=mysql://... node scripts/migrate.mjs
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
const pool = mysql.createPool({ uri: process.env.DATABASE_URL, timezone: "Z" });
await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
console.log("migrations applied");
await pool.end();
