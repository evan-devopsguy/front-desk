import type { PoolClient } from "pg";
import { unscoped } from "../db/client.js";
import { logger } from "./logger.js";
import { redact } from "./pii.js";

export type AuditAction =
  | "phi_read"
  | "phi_write"
  | "message_received"
  | "message_sent"
  | "booking_created"
  | "booking_cancelled"
  | "conversation_escalated"
  | "tenant_created"
  | "tenant_updated"
  | "knowledge_ingested"
  | "classifier_decision"
  | "llm_call"
  | string;

export interface AuditEntry {
  tenantId: string | null;
  actor: string;
  action: AuditAction;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Write an audit entry. Safe to call without a tenant context (used by admin
 * routes). When a tenant context exists, prefer writing via that client so
 * the row is covered by the request's transaction.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  const row = {
    tenantId: entry.tenantId,
    actor: entry.actor,
    action: entry.action,
    resourceType: entry.resourceType ?? null,
    resourceId: entry.resourceId ?? null,
    metadata: entry.metadata ? (redact(entry.metadata) as Record<string, unknown>) : null,
  };
  try {
    await unscoped(async (client) => {
      // Allow audit writes regardless of RLS context — use a dedicated fn.
      await client.query(
        `SELECT set_config('app.tenant_id', $1, true), set_config('app.actor', $2, true)`,
        [row.tenantId ?? "", row.actor],
      );
      await client.query(
        `INSERT INTO audit_log (tenant_id, actor, action, resource_type, resource_id, metadata)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          row.tenantId,
          row.actor,
          row.action,
          row.resourceType,
          row.resourceId,
          row.metadata,
        ],
      );
    });
  } catch (err) {
    // Audit must never block the request path, but we log loudly so that
    // alerting can fire. Missing audit rows must be investigated.
    logger.error({ err, action: entry.action }, "audit write failed");
  }
}

/** Audit within an existing tenant transaction — preferred for PHI paths. */
export async function auditWithin(
  client: PoolClient,
  entry: AuditEntry,
): Promise<void> {
  const row = {
    ...entry,
    metadata: entry.metadata ? (redact(entry.metadata) as Record<string, unknown>) : null,
  };
  await client.query(
    `INSERT INTO audit_log (tenant_id, actor, action, resource_type, resource_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      row.tenantId,
      row.actor,
      row.action,
      row.resourceType ?? null,
      row.resourceId ?? null,
      row.metadata ?? null,
    ],
  );
}
