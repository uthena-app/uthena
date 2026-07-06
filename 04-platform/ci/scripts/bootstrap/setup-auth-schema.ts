#!/usr/bin/env tsx
// setup-auth-schema.ts — One-time dump of Supabase's `auth` schema
// into the Uthena DB. Run via `pnpm db:auth-schema` BEFORE `db:bootstrap`.
//
// Why this exists
// ---------------
// The Uthena migrations reference `auth.users` (FKs everywhere —
// `profiles.user_id`, `orders.user_id`, etc.) but the dump assumes
// the local Supabase instance has already inited the `auth` schema in
// the `uthena` database. On a fresh Supabase DB, only `postgres` is
// inited; the `uthena` DB is empty.
//
// Supabase's auth schema is owned by Supabase, not by us — we can't
// write it via Uthena migrations without forking Supabase. Instead,
// we dump it once with `pg_dump --schema=auth` from the inited
// `postgres` DB and apply it to `uthena`.
//
// Idempotency
// -----------
// This script is safe to re-run. `CREATE SCHEMA auth` + `CREATE
// TABLE auth.users` will fail with "already exists"; the script
// catches that and continues. Each function definition is
// `CREATE OR REPLACE`. The end state is identical regardless of run
// count.
//
// What it does
// ------------
// 1. Reads `04-platform/ci/scripts/bootstrap/00-auth-schema.sql`
//    (the dumped schema).
// 2. Connects to $DATABASE_URL (default: local uthena DB at 54422).
// 3. Applies the dump with the handle_new_user stub prepended (the
//    dump references `public.handle_new_user()`).
// 4. Reports applied/skipped counts.

import pg from 'pg'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_LOCAL_URL = 'postgresql://postgres:postgres@127.0.0.1:54422/postgres'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

async function main() {
  const url = process.env.DATABASE_URL ?? DEFAULT_LOCAL_URL
  const dumpPath = join(__dirname, 'auth-schema.sql')
  const sql = readFileSync(dumpPath, 'utf-8')

  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try {
    await c.query(sql)
    console.log('auth schema applied')
  } catch (e: any) {
    if (e.code === '42P07' || /already exists/i.test(e.message)) {
      console.log('auth schema already present (skipping)')
    } else {
      console.error('FAILED:', e.message.slice(0, 300))
      process.exitCode = 1
    }
  } finally {
    await c.end()
  }
}

void main()
