/**
 * PHI redaction for logs. We never emit patient names, phone numbers, emails,
 * dates of birth, or free-text medical content to stdout or external sinks.
 *
 * This is a belt-and-braces layer: the orchestrator already splits PHI into
 * the DB (encrypted at rest) and emits only a short conversation_id handle in
 * logs. This redactor catches anything that slips through.
 */

// Order matters: more specific patterns redact before greedy phone regex.
const PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "[EMAIL]", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { label: "[SSN]", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { label: "[DOB]", re: /\b(0?[1-9]|1[0-2])[/-](0?[1-9]|[12]\d|3[01])[/-](19|20)\d{2}\b/g },
  { label: "[PHONE]", re: /\+?\d[\d\s().-]{7,}\d/g },
];

const SENSITIVE_KEYS = new Set([
  "phone",
  "phone_number",
  "patientPhone",
  "patientPhoneE164",
  "patient_phone",
  "patientName",
  "patient_name",
  "email",
  "dob",
  "content",
  "body",
  "message",
  "transcript",
]);

export function redactString(input: string): string {
  let out = input;
  for (const { label, re } of PATTERNS) {
    out = out.replace(re, label);
  }
  return out;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[DEPTH]";
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k)) {
        out[k] = typeof v === "string" ? "[REDACTED]" : "[REDACTED]";
      } else {
        out[k] = redact(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

import { createHash } from "node:crypto";

/** Hash a phone number for storage. Tenant-scoped salt prevents cross-tenant
 *  rainbow-table attacks if the DB is ever exfiltrated. */
export function hashPhone(phoneE164: string, tenantId: string): string {
  return createHash("sha256")
    .update(`${tenantId}:${phoneE164}`)
    .digest("hex");
}
