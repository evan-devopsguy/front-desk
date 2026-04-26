import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),

  DATABASE_URL: z.string().url(),
  DATABASE_APP_ROLE: z.string().default("medspa_app"),

  AWS_REGION: z.string().default("us-east-1"),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  BEDROCK_REASONING_MODEL_ID: z
    .string()
    .default("us.anthropic.claude-sonnet-4-5-20250929-v1:0"),
  BEDROCK_CLASSIFIER_MODEL_ID: z
    .string()
    .default("us.anthropic.claude-haiku-4-5-20251001-v1:0"),
  BEDROCK_EMBEDDING_MODEL_ID: z.string().default("amazon.titan-embed-text-v2:0"),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3001"),

  SECRETS_PREFIX: z.string().default("/medspa/dev"),
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | null = null;
export function getConfig(): AppConfig {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${msg}`);
  }
  cached = parsed.data;
  return cached;
}

export function isProd(): boolean {
  return getConfig().NODE_ENV === "production";
}
