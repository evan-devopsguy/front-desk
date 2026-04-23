import pino from "pino";
import { getConfig } from "./config.js";
import { redact, redactString } from "./phi.js";

/**
 * Lazy pino logger. Built on first access so tests and scripts that set env
 * after import still see the correct configuration.
 *
 * All logs pass through the PHI redactor twice — once at the object level
 * (pino's formatter) and once for any interpolated string arguments.
 */

let cached: pino.Logger | null = null;

function build(): pino.Logger {
  const cfg = getConfig();
  return pino({
    level: cfg.LOG_LEVEL,
    base: { service: "medspa-api", env: cfg.NODE_ENV },
    formatters: {
      log(object) {
        return redact(object) as Record<string, unknown>;
      },
    },
    hooks: {
      logMethod(inputArgs, method) {
        const next = inputArgs.map((arg) =>
          typeof arg === "string" ? redactString(arg) : arg,
        );
        return method.apply(this, next as Parameters<typeof method>);
      },
    },
    transport:
      cfg.NODE_ENV === "development"
        ? {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "SYS:standard",
              ignore: "pid,hostname,service,env",
            },
          }
        : undefined,
  });
}

export const logger = new Proxy({} as pino.Logger, {
  get(_t, prop) {
    if (!cached) cached = build();
    return Reflect.get(cached, prop, cached);
  },
});

export type Logger = pino.Logger;
