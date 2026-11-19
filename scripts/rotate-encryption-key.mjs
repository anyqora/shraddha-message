#!/usr/bin/env node
/**
 * Re-encrypt every secret stored in the database from one ENCRYPTION_KEY to another.
 * Use after importing data from another install, or when rotating the key.
 *
 *   OLD_ENCRYPTION_KEY=<64 hex> ENCRYPTION_KEY=<64 hex> DATABASE_URL=mysql://... node scripts/rotate-encryption-key.mjs [--dry-run]
 *
 * Values that don't decrypt with the old key are left untouched (and reported), so the script is
 * safe to re-run. Format matches src/lib/whatsapp/encryption.ts: iv(12 bytes):ciphertext:authTag
 * (hex, AES-256-GCM); legacy iv:ciphertext (AES-256-CBC) values are upgraded to GCM.
 */
import crypto from 'node:crypto'
import mysql from 'mysql2/promise'

const COLUMNS = [
  ['whatsapp_config', 'access_token'],
  ['whatsapp_config', 'verify_token'],
  ['ai_configs', 'api_key'],
  ['ai_configs', 'embeddings_api_key'],
  ['webhook_endpoints', 'secret'],
]

const OLD = process.env.OLD_ENCRYPTION_KEY
const NEW = process.env.ENCRYPTION_KEY
const DRY = process.argv.includes('--dry-run')
if (!/^[0-9a-f]{64}$/i.test(OLD ?? '') || !/^[0-9a-f]{64}$/i.test(NEW ?? '') || !process.env.DATABASE_URL) {
  console.error('OLD_ENCRYPTION_KEY and ENCRYPTION_KEY (64 hex chars) and DATABASE_URL are required')
  process.exit(2)
}

function decrypt(text, keyHex) {
  const key = Buffer.from(keyHex, 'hex')
  const parts = text.split(':')
  if (parts.length === 3) {
    const [iv, data, tag] = parts
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'))
    d.setAuthTag(Buffer.from(tag, 'hex'))
    return d.update(data, 'hex', 'utf8') + d.final('utf8')
  }
  if (parts.length === 2) {
    const [iv, data] = parts
    const d = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(iv, 'hex'))
    return d.update(data, 'hex', 'utf8') + d.final('utf8')
  }
  throw new Error('not an encrypted value')
}

function encrypt(text, keyHex) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv)
  const data = c.update(text, 'utf8', 'hex') + c.final('hex')
  return `${iv.toString('hex')}:${data}:${c.getAuthTag().toString('hex')}`
}

const db = await mysql.createConnection({ uri: process.env.DATABASE_URL })
let changed = 0
let skipped = 0
for (const [table, col] of COLUMNS) {
  const [exists] = await db.query(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, col]
  )
  if (!exists.length) continue
  const [rows] = await db.query(`SELECT id, \`${col}\` AS v FROM \`${table}\` WHERE \`${col}\` IS NOT NULL AND \`${col}\` <> ''`)
  for (const r of rows) {
    let plain
    try {
      plain = decrypt(String(r.v), OLD)
    } catch {
      try {
        decrypt(String(r.v), NEW)
        continue // already on the new key
      } catch {
        skipped++
        console.warn(`  ${table}.${col} id=${r.id}: does not decrypt with either key, left as is`)
        continue
      }
    }
    if (!DRY) await db.query(`UPDATE \`${table}\` SET \`${col}\` = ? WHERE id = ?`, [encrypt(plain, NEW), r.id])
    changed++
  }
}
console.log(`${DRY ? '[dry run] would re-encrypt' : 're-encrypted'} ${changed} value(s); ${skipped} left untouched`)
await db.end()
