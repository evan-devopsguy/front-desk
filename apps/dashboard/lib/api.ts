/**
 * Server-side proxy client. The dashboard never calls the API from the
 * browser directly — PHI would cross Vercel's edge. Instead, Next.js server
 * components and route handlers call the API with the shared proxy token,
 * then render server-rendered HTML/JSON to the client.
 */
const API_URL = process.env.API_INTERNAL_URL ?? "http://localhost:3001";
const TOKEN = process.env.API_PROXY_TOKEN ?? "dev-proxy-token-change-me";

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { authorization: `Bearer ${TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`api ${path} ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export interface TenantSummary {
  id: string;
  name: string;
  twilioNumber: string;
  bookingAdapter: string;
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  tenantId: string;
  channel: "sms" | "voice" | "ig";
  contactPhoneHash: string | null;
  status: "active" | "booked" | "escalated" | "abandoned";
  createdAt: string;
}

export interface MessageRecord {
  id: string;
  role: "patient" | "contact" | "assistant" | "system" | "tool";
  content: string;
  createdAt: string;
}

export interface BookingRecord {
  id: string;
  service: string;
  scheduledAt: string;
  contactName: string;
  estimatedValueCents: number | null;
  createdAt: string;
}

export async function listTenants(): Promise<TenantSummary[]> {
  const { tenants } = await apiFetch<{ tenants: TenantSummary[] }>(
    "/admin/tenants",
  );
  return tenants;
}

export async function listConversations(
  tenantId: string,
): Promise<ConversationSummary[]> {
  const { conversations } = await apiFetch<{
    conversations: ConversationSummary[];
  }>(`/admin/tenants/${tenantId}/conversations`);
  return conversations;
}

export async function listMessages(
  tenantId: string,
  conversationId: string,
): Promise<MessageRecord[]> {
  const { messages } = await apiFetch<{ messages: MessageRecord[] }>(
    `/admin/tenants/${tenantId}/conversations/${conversationId}/messages`,
  );
  return messages;
}

export async function listBookings(
  tenantId: string,
): Promise<BookingRecord[]> {
  const { bookings } = await apiFetch<{ bookings: BookingRecord[] }>(
    `/admin/tenants/${tenantId}/bookings`,
  );
  return bookings;
}
