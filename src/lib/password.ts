import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";

function run(pw: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((res, rej) =>
    scrypt(pw, salt, 64, { N, r, p, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))),
  );
}

/** Format: scrypt$N$r$p$salt$hash (compatible with the previous panel). */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const k = await run(pw, salt, 16384, 8, 1);
  return `scrypt$16384$8$1$${salt.toString("base64")}$${k.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, N, r, p, salt, hash] = (stored ?? "").split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const k = await run(pw, Buffer.from(salt, "base64"), Number(N), Number(r), Number(p));
  return k.length === expected.length && timingSafeEqual(k, expected);
}
