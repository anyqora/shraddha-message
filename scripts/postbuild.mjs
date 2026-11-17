// Copies files the standalone server needs next to it (Next.js does not do this itself).
import { cpSync, existsSync } from "node:fs";
const out = ".next/standalone";
if (!existsSync(out)) process.exit(0);
cpSync(".next/static", `${out}/.next/static`, { recursive: true });
if (existsSync("public")) cpSync("public", `${out}/public`, { recursive: true });
cpSync("drizzle", `${out}/drizzle`, { recursive: true });
console.log("postbuild: copied static, public and drizzle into", out);
