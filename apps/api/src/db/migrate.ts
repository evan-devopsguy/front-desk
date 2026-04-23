import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unscoped, closePool } from "./client.js";
import { logger } from "../lib/logger.js";

/**
 * Forward-only migration runner. Applies every `NNN_*.sql` file in
 * `migrations/` exactly once, tracked in `schema_migrations`. Each file runs
 * in its own transaction so a failure leaves the catalog consistent.
 *
 * For fresh local databases, `schema.sql` is still applied via
 * docker-entrypoint-initdb.d; migrations bring existing DBs forward and are
 * idempotent when run against a schema that already matches.
 */

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "migrations",
);

export async function migrate() {
  await unscoped(async (c) => {
    await c.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  });

  const done = await unscoped(async (c) => {
    const res = await c.query(`SELECT id FROM schema_migrations`);
    return new Set(res.rows.map((r) => r.id as string));
  });

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const f of files) {
    const id = f.replace(/\.sql$/, "");
    if (done.has(id)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, f), "utf8");
    await unscoped(async (c) => {
      await c.query("BEGIN");
      try {
        await c.query(sql);
        await c.query(`INSERT INTO schema_migrations (id) VALUES ($1)`, [id]);
        await c.query("COMMIT");
        logger.info({ migration: id }, "migration applied");
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      }
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .catch((e) => {
      logger.error({ err: e }, "migration failed");
      process.exit(1);
    })
    .finally(closePool);
}
