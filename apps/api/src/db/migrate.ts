#!/usr/bin/env tsx
/**
 * Apply schema.sql to the configured database. Idempotent — safe to re-run.
 * Production uses Terraform + a migration step; for MVP this is sufficient.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { getConfig } from "../lib/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const cfg = getConfig();
  const sql = await readFile(join(__dirname, "schema.sql"), "utf-8");
  const client = new pg.Client({ connectionString: cfg.DATABASE_URL });
  await client.connect();
  try {
    await client.query(sql);
    console.log("schema applied");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
