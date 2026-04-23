import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { tenantConfigSchema } from "@medspa/shared";
import { randomUUID } from "node:crypto";
import { unscoped, withTenant } from "../db/client.js";
import type { PoolClient } from "pg";
import {
  insertTenant,
  listTenants,
  listConversations,
  listBookings,
  listMessages,
} from "../db/repository.js";
import { audit } from "../lib/audit.js";
import { getConfig } from "../lib/config.js";

/**
 * Admin + dashboard-proxy routes. Protected by a shared Bearer token that the
 * Next.js dashboard holds server-side (never exposed to the browser). Per the
 * MVP spec there is no multi-user auth yet.
 */
export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (req, reply) => {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${getConfig().API_PROXY_TOKEN}`) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  // ---------- Tenants ----------
  app.get("/admin/tenants", async () => {
    const tenants = await unscoped((c) => listTenants(c));
    return { tenants };
  });

  const createTenantBody = z.object({
    name: z.string().min(1),
    twilioNumber: z.string().regex(/^\+[1-9]\d{7,14}$/),
    vertical: z.enum(["medspa", "garage-doors"]).default("medspa"),
    bookingAdapter: z
      .enum(["mock", "boulevard", "vagaro", "google-calendar"])
      .default("mock"),
    config: tenantConfigSchema,
  });

  app.post("/admin/tenants", async (req, reply) => {
    const parsed = createTenantBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const id = randomUUID();
    const row = await unscoped((c: PoolClient) =>
      insertTenant(c, { id, ...parsed.data }),
    );
    await audit({
      tenantId: row.id,
      actor: "admin",
      action: "tenant_created",
      resourceType: "tenant",
      resourceId: row.id,
    });
    return reply.code(201).send({ tenant: row });
  });

  // ---------- Conversations (per-tenant) ----------
  app.get<{
    Params: { tenantId: string };
    Querystring: { limit?: string };
  }>("/admin/tenants/:tenantId/conversations", async (req) => {
    const limit = Math.min(Number(req.query.limit ?? "50"), 200);
    const rows = await withTenant(
      { tenantId: req.params.tenantId, actor: "dashboard" },
      (c) => listConversations(c, req.params.tenantId, limit),
    );
    return { conversations: rows };
  });

  app.get<{ Params: { tenantId: string; conversationId: string } }>(
    "/admin/tenants/:tenantId/conversations/:conversationId/messages",
    async (req) => {
      const rows = await withTenant(
        { tenantId: req.params.tenantId, actor: "dashboard" },
        (c) => listMessages(c, req.params.conversationId, 200),
      );
      await audit({
        tenantId: req.params.tenantId,
        actor: "dashboard",
        action: "phi_read",
        resourceType: "conversation",
        resourceId: req.params.conversationId,
      });
      return { messages: rows };
    },
  );

  // ---------- Bookings ----------
  app.get<{
    Params: { tenantId: string };
    Querystring: { limit?: string };
  }>("/admin/tenants/:tenantId/bookings", async (req) => {
    const limit = Math.min(Number(req.query.limit ?? "50"), 200);
    const rows = await withTenant(
      { tenantId: req.params.tenantId, actor: "dashboard" },
      (c) => listBookings(c, req.params.tenantId, limit),
    );
    return { bookings: rows };
  });
};
