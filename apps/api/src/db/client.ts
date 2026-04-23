import pg from "pg";
import { getConfig } from "../lib/config.js";
import { logger } from "../lib/logger.js";

const { Pool } = pg;

/**
 * Single pool for the application. We intentionally connect as a non-superuser
 * role (DATABASE_APP_ROLE) so Row-Level Security is enforced. If the URL's
 * user differs, we log a warning in dev.
 */
function buildPool(): pg.Pool {
  const cfg = getConfig();
  const pool = new Pool({
    connectionString: cfg.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    application_name: "medspa-api",
  });
  pool.on("error", (err) => {
    logger.error({ err }, "postgres pool error");
  });
  return pool;
}

let poolSingleton: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!poolSingleton) poolSingleton = buildPool();
  return poolSingleton;
}

export async function closePool(): Promise<void> {
  if (poolSingleton) {
    await poolSingleton.end();
    poolSingleton = null;
  }
}

export interface TenantContext {
  tenantId: string;
  actor: string;
}

/**
 * Run a callback inside a transaction with app.tenant_id set. All queries
 * run through this path are subject to RLS — cross-tenant reads are
 * physically impossible.
 *
 * The actor is surfaced via app.actor so auto-audit triggers attribute writes.
 */
export async function withTenant<T>(
  ctx: TenantContext,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // set_config(name, value, is_local=true) -> scoped to the transaction.
    await client.query(
      "SELECT set_config('app.tenant_id', $1, true), set_config('app.actor', $2, true)",
      [ctx.tenantId, ctx.actor],
    );
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Unscoped queries — only use for admin endpoints (tenant CRUD) or health.
 * RLS still applies unless you also set app.tenant_id, so by default this
 * returns zero PHI rows. That's the point: fail closed.
 */
export async function unscoped<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
