import type { PoolClient } from "pg";
import type {
  Conversation,
  ConversationStatus,
  Channel,
  Message,
  MessageRole,
} from "@medspa/shared";
import type { TenantConfig } from "@medspa/shared";
import { tenantConfigSchema } from "@medspa/shared";

/**
 * Tenant-scoped data access. All callers must use withTenant() so RLS applies.
 */

export interface TenantRow {
  id: string;
  name: string;
  twilioNumber: string;
  vertical: "medspa" | "garage-doors";
  bookingAdapter: "mock" | "boulevard" | "vagaro" | "google-calendar";
  bookingCredentialsSecretArn: string | null;
  config: TenantConfig;
  createdAt: string;
}

function rowToTenant(r: Record<string, unknown>): TenantRow {
  return {
    id: r.id as string,
    name: r.name as string,
    twilioNumber: r.twilio_number as string,
    vertical: r.vertical as TenantRow["vertical"],
    bookingAdapter: r.booking_adapter as TenantRow["bookingAdapter"],
    bookingCredentialsSecretArn: (r.booking_credentials_secret_arn as string) ?? null,
    config: tenantConfigSchema.parse(r.config),
    createdAt: (r.created_at as Date).toISOString(),
  };
}

export async function findTenantByPhone(
  client: PoolClient,
  phoneE164: string,
): Promise<TenantRow | null> {
  // Admin path: caller must set app.tenant_id to the matched row to read other
  // columns. We look up by unique twilio_number using a SECURITY-DEFINER bypass
  // — but for MVP we simply use an unscoped lookup from the admin route and
  // then switch into the tenant context.
  const res = await client.query(
    `SELECT id, name, twilio_number, vertical, booking_adapter,
            booking_credentials_secret_arn, config, created_at
       FROM tenants WHERE twilio_number = $1`,
    [phoneE164],
  );
  return res.rows[0] ? rowToTenant(res.rows[0]) : null;
}

export async function getTenant(
  client: PoolClient,
  id: string,
): Promise<TenantRow | null> {
  const res = await client.query(
    `SELECT id, name, twilio_number, vertical, booking_adapter,
            booking_credentials_secret_arn, config, created_at
       FROM tenants WHERE id = $1`,
    [id],
  );
  return res.rows[0] ? rowToTenant(res.rows[0]) : null;
}

export async function insertTenant(
  client: PoolClient,
  input: {
    id: string;
    name: string;
    twilioNumber: string;
    vertical: "medspa" | "garage-doors";
    bookingAdapter: "mock" | "boulevard" | "vagaro" | "google-calendar";
    config: TenantConfig;
  },
): Promise<TenantRow> {
  const res = await client.query(
    `INSERT INTO tenants (id, name, twilio_number, vertical, booking_adapter, config)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, name, twilio_number, vertical, booking_adapter,
               booking_credentials_secret_arn, config, created_at`,
    [
      input.id,
      input.name,
      input.twilioNumber,
      input.vertical,
      input.bookingAdapter,
      input.config,
    ],
  );
  return rowToTenant(res.rows[0]);
}

export async function listTenants(client: PoolClient): Promise<TenantRow[]> {
  const res = await client.query(
    `SELECT id, name, twilio_number, vertical, booking_adapter,
            booking_credentials_secret_arn, config, created_at
       FROM tenants ORDER BY created_at DESC`,
  );
  return res.rows.map(rowToTenant);
}

export async function findOrCreateConversation(
  client: PoolClient,
  input: { tenantId: string; channel: Channel; contactPhoneHash: string },
): Promise<Conversation> {
  const existing = await client.query(
    `SELECT id, tenant_id, channel, contact_phone_hash, status, created_at
       FROM conversations
      WHERE tenant_id = $1 AND contact_phone_hash = $2 AND status = 'active'
      ORDER BY created_at DESC LIMIT 1`,
    [input.tenantId, input.contactPhoneHash],
  );
  if (existing.rows[0]) return rowToConversation(existing.rows[0]);

  const res = await client.query(
    `INSERT INTO conversations (tenant_id, channel, contact_phone_hash, status)
     VALUES ($1,$2,$3,'active')
     RETURNING id, tenant_id, channel, contact_phone_hash, status, created_at`,
    [input.tenantId, input.channel, input.contactPhoneHash],
  );
  return rowToConversation(res.rows[0]);
}

function rowToConversation(r: Record<string, unknown>): Conversation {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    channel: r.channel as Channel,
    contactPhoneHash: (r.contact_phone_hash as string) ?? null,
    status: r.status as ConversationStatus,
    createdAt: (r.created_at as Date).toISOString(),
  };
}

export async function updateConversationStatus(
  client: PoolClient,
  id: string,
  status: ConversationStatus,
): Promise<void> {
  await client.query(
    `UPDATE conversations SET status = $2, updated_at = NOW() WHERE id = $1`,
    [id, status],
  );
}

export async function insertMessage(
  client: PoolClient,
  input: {
    tenantId: string;
    conversationId: string;
    role: MessageRole | "tool";
    content: string;
    toolCalls?: unknown;
  },
): Promise<Message> {
  const res = await client.query(
    `INSERT INTO messages (tenant_id, conversation_id, role, content, tool_calls)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, conversation_id, role, content, tool_calls, created_at`,
    [
      input.tenantId,
      input.conversationId,
      input.role,
      input.content,
      input.toolCalls ? JSON.stringify(input.toolCalls) : null,
    ],
  );
  const r = res.rows[0];
  return {
    id: r.id,
    conversationId: r.conversation_id,
    role: r.role,
    content: r.content,
    toolCalls: r.tool_calls,
    createdAt: (r.created_at as Date).toISOString(),
  };
}

export async function listMessages(
  client: PoolClient,
  conversationId: string,
  limit = 50,
): Promise<Message[]> {
  const res = await client.query(
    `SELECT id, conversation_id, role, content, tool_calls, created_at
       FROM messages WHERE conversation_id = $1
      ORDER BY created_at ASC LIMIT $2`,
    [conversationId, limit],
  );
  return res.rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    role: r.role,
    content: r.content,
    toolCalls: r.tool_calls,
    createdAt: (r.created_at as Date).toISOString(),
  }));
}

export async function insertBooking(
  client: PoolClient,
  input: {
    tenantId: string;
    conversationId: string;
    externalBookingId: string | null;
    service: string;
    scheduledAt: string;
    contactName: string;
    contactPhoneHash: string;
    estimatedValueCents: number | null;
  },
): Promise<{ id: string }> {
  const res = await client.query(
    `INSERT INTO bookings (tenant_id, conversation_id, external_booking_id,
                           service, scheduled_at, contact_name, contact_phone_hash,
                           estimated_value_cents)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [
      input.tenantId,
      input.conversationId,
      input.externalBookingId,
      input.service,
      input.scheduledAt,
      input.contactName,
      input.contactPhoneHash,
      input.estimatedValueCents,
    ],
  );
  return { id: res.rows[0].id };
}

export async function listConversations(
  client: PoolClient,
  tenantId: string,
  limit = 50,
): Promise<Conversation[]> {
  const res = await client.query(
    `SELECT id, tenant_id, channel, contact_phone_hash, status, created_at
       FROM conversations
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [tenantId, limit],
  );
  return res.rows.map(rowToConversation);
}

export async function listBookings(
  client: PoolClient,
  tenantId: string,
  limit = 50,
): Promise<
  Array<{
    id: string;
    service: string;
    scheduledAt: string;
    contactName: string;
    estimatedValueCents: number | null;
    createdAt: string;
  }>
> {
  const res = await client.query(
    `SELECT id, service, scheduled_at, contact_name, estimated_value_cents, created_at
       FROM bookings WHERE tenant_id = $1
      ORDER BY scheduled_at DESC LIMIT $2`,
    [tenantId, limit],
  );
  return res.rows.map((r) => ({
    id: r.id,
    service: r.service,
    scheduledAt: (r.scheduled_at as Date).toISOString(),
    contactName: r.contact_name,
    estimatedValueCents: r.estimated_value_cents,
    createdAt: (r.created_at as Date).toISOString(),
  }));
}
