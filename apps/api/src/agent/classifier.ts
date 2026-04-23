import type { Intent } from "@medspa/shared";
import { classifierModelId, invokeClaude } from "../integrations/bedrock.js";
import { buildClassifierPrompt } from "./prompts.js";

/**
 * Haiku-backed intent classifier. Returns a stable intent even when the model
 * returns noisy tokens. Defaults to "clinical" on parse failure for safety.
 */
export async function classifyIntent(message: string): Promise<Intent> {
  const res = await invokeClaude({
    modelId: classifierModelId(),
    system: buildClassifierPrompt(),
    maxTokens: 8,
    temperature: 0,
    messages: [{ role: "user", content: message }],
  });

  const text = res.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("")
    .toLowerCase()
    .trim();

  if (text.startsWith("faq")) return "faq";
  if (text.startsWith("booking")) return "booking";
  if (text.startsWith("clinical")) return "clinical";
  if (text.startsWith("complaint")) return "complaint";
  if (text.startsWith("spam")) return "spam";
  return "clinical";
}
