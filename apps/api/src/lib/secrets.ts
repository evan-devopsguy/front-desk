import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { getConfig } from "./config.js";
import { logger } from "./logger.js";

let cachedClient: SecretsManagerClient | null = null;
function client(): SecretsManagerClient {
  if (!cachedClient) {
    cachedClient = new SecretsManagerClient({ region: getConfig().AWS_REGION });
  }
  return cachedClient;
}

interface CacheEntry {
  value: Record<string, string>;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60 * 1000;

/**
 * Fetch a Secrets Manager secret as a flat JSON object of strings. Caches per
 * arn for TTL_MS. Used to load adapter credentials (e.g. google-calendar) on
 * the inbound request path. Throws on parse failure rather than masking it —
 * a malformed secret is an operator bug, not a runtime degradation.
 */
export async function getSecretJson(arn: string): Promise<Record<string, string>> {
  const now = Date.now();
  const hit = cache.get(arn);
  if (hit && hit.expiresAt > now) return hit.value;

  const res = await client().send(new GetSecretValueCommand({ SecretId: arn }));
  if (!res.SecretString) {
    throw new Error(`secret ${arn} has no SecretString (binary secrets are not supported)`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(res.SecretString);
  } catch (err) {
    throw new Error(`secret ${arn} is not valid JSON: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`secret ${arn} must be a JSON object of strings`);
  }
  const value: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v !== "string") {
      throw new Error(`secret ${arn} field ${k} must be a string`);
    }
    value[k] = v;
  }

  cache.set(arn, { value, expiresAt: now + TTL_MS });
  logger.info({ arn, fields: Object.keys(value) }, "secrets.fetched");
  return value;
}
