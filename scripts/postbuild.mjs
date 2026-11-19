// Copies files the standalone server needs next to it (Next.js does not do this itself):
// static assets, public/, and the MySQL migrations applied at server start.
import { cpSync, existsSync } from 'node:fs'

const out = '.next/standalone'
if (!existsSync(out)) process.exit(0)
cpSync('.next/static', `${out}/.next/static`, { recursive: true })
if (existsSync('public')) cpSync('public', `${out}/public`, { recursive: true })
cpSync('db/mysql/migrations', `${out}/db/mysql/migrations`, { recursive: true })
console.log('postbuild: copied static, public and db/mysql/migrations into', out)
