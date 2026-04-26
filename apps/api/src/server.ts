import Fastify from "fastify";
import formbody from "@fastify/formbody";
import cors from "@fastify/cors";
import { getConfig } from "./lib/config.js";
import { logger } from "./lib/logger.js";
import { closePool } from "./db/client.js";
import { healthRoutes } from "./routes/health.js";
import { twilioRoutes } from "./routes/twilio.js";
import { twilioVoiceRoutes } from "./routes/twilio-voice.js";

export async function buildServer() {
  const cfg = getConfig();
  const app = Fastify({
    logger,
    trustProxy: true,
    bodyLimit: 1_048_576,
  });
  app.decorate("config", cfg);

  await app.register(formbody);
  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
  });

  await app.register(healthRoutes);
  await app.register(twilioRoutes);
  await app.register(twilioVoiceRoutes);

  app.setErrorHandler((err, _req, reply) => {
    logger.error({ err }, "unhandled error");
    reply.status(err.statusCode ?? 500).send({
      error: err.message,
    });
  });

  return app;
}

async function main() {
  const cfg = getConfig();
  const app = await buildServer();
  const close = async () => {
    logger.info("shutting down");
    await app.close();
    await closePool();
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);

  await app.listen({ port: cfg.PORT, host: "0.0.0.0" });
  logger.info({ port: cfg.PORT }, "medspa-api listening");
}

// Start only if invoked directly (allows the eval harness to import buildServer)
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    logger.error({ err }, "fatal");
    process.exit(1);
  });
}
