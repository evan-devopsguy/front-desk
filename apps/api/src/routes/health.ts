import type { FastifyPluginAsync } from "fastify";
import { getPool } from "../db/client.js";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/healthz", async () => ({ ok: true }));

  app.get("/readyz", async (_req, reply) => {
    try {
      const res = await getPool().query("SELECT 1 AS ok");
      return { ok: res.rows[0].ok === 1 };
    } catch (err) {
      return reply.code(503).send({ ok: false, error: (err as Error).message });
    }
  });
};
