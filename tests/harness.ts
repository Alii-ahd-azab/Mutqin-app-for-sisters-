// Local, disposable Supabase-like database for the database tests (PGlite; never a remote connection).
// The Sisters production SCHEMA (pg_dump, no data) + Supabase-like roles and Auth stubs + synthetic
// test data; the migrations of this repository that came after the dump are applied by the tests.
//
// Schema dump: SISTERS_SCHEMA_DUMP or ./sisters-live-schema.sql (pg_dump --schema-only of production).
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

export const SCHEMA_DUMP = process.env.SISTERS_SCHEMA_DUMP || path.resolve('sisters-live-schema.sql');
const MIGRATIONS = path.resolve('supabase/migrations');

/** Migrations written after the schema dump (the dump already contains everything before). */
export const NEW_MIGRATIONS = [
  '20261027120000_program_date_5am_cairo.sql',
  '20261027120100_distant_review_days.sql',
  '20261027120200_notification_state.sql',
  '20261030120000_distant_review_priority_and_alert_dismissals.sql',
];

// Minimal stand-ins for the Supabase platform objects the schema references.
const AUTH_STUBS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text unique, encrypted_password text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to public;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase's default privileges on the public schema (objects created by the owner).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

const KEEP_SCHEMAS = new Set(['public', 'app_private', 'private']);

/** The public / app_private / private objects of the pg_dump (platform schemas are left out). */
export function sistersSchemaSql(dumpPath = SCHEMA_DUMP): string {
  const dump = fs.readFileSync(dumpPath, 'utf8').replace(/\r\n/g, '\n');
  const blocks = dump.split(/\n--\n-- Name: /);
  const out: string[] = [];
  for (const block of blocks.slice(1)) {
    const header = block.slice(0, block.indexOf('\n'));
    const m = /^(.*); Type: ([A-Z ]+); Schema: ([^;]+); Owner:/.exec(header);
    if (!m) continue;
    const [, name, type, schema] = m;
    const body = block.slice(block.indexOf('\n--\n') + 4).replace(/\n\\unrestrict .*$/m, '');
    if (type === 'SCHEMA') {
      if (KEEP_SCHEMAS.has(name) && name !== 'public') out.push(body);
      continue;
    }
    if (!KEEP_SCHEMAS.has(schema)) continue;
    // The rls_auto_enable() helper is only used by a platform event trigger.
    if (type === 'FUNCTION' && name.startsWith('rls_auto_enable')) continue;
    out.push(body);
  }
  // As in the dump's preamble: function bodies are checked when the whole schema exists.
  return ['SET check_function_bodies = false;', ...out, 'SET check_function_bodies = true;'].join('\n');
}

/** GRANT / REVOKE statements of the migrations already contained in the dump (the dump has no ACLs). */
function existingPrivileges(): string[] {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && !NEW_MIGRATIONS.includes(f)).sort();
  const stmts: string[] = [];
  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8').replace(/\r\n/g, '\n');
    for (const m of sql.matchAll(/^\s*(grant|revoke)\b[^;]*;/gim)) stmts.push(m[0].trim());
  }
  return stmts;
}

export function migrationSql(name: string): string {
  return fs.readFileSync(path.join(MIGRATIONS, name), 'utf8');
}

/** A fresh database with the Sisters schema (no data, new migrations not applied). */
export async function createSchemaDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(AUTH_STUBS);
  await db.exec(sistersSchemaSql());
  for (const stmt of existingPrivileges()) {
    try {
      await db.exec(stmt);
    } catch {
      // a privilege on an object that a later migration dropped or renamed
    }
  }
  return db;
}

export async function applyNewMigrations(db: PGlite, upTo?: string) {
  for (const name of NEW_MIGRATIONS) {
    await db.exec(migrationSql(name));
    if (name === upTo) break;
  }
}

/** Run fn as a Supabase API role (anon / authenticated with claims) inside a rolled-back transaction. */
export async function asRole<T>(db: PGlite, role: 'anon' | 'authenticated' | 'service_role', sub: string | null, fn: (tx: any) => Promise<T>) {
  let result: T | undefined;
  try {
    await db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [sub ? JSON.stringify({ sub, role }) : '']);
      await tx.query(`set local role ${role}`);
      result = await fn(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return result as T;
}
class Rollback extends Error {}
