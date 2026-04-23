import type { Intent } from "@medspa/shared";
import { classifierModelId, invokeClaude } from "../integrations/bedrock.js";
import { buildClassifierPrompt } from "./prompts.js";
import type { Vertical } from "../verticals/types.js";

/**
 * Haiku-backed intent classifier. Returns a stable intent even when the model
 * returns noisy tokens. Falls back to the caller-supplied `fallback` intent on
 * parse failure — medspa uses "clinical" (safety bias), garage-doors uses "faq".
 */
export async function classifyIntent(args: {
  message: string;
  vertical: Vertical;
  /** Fallback intent if the model output is not in the vertical's category set. */
  fallback: Intent;
}): Promise<Intent> {
  const res = await invokeClaude({
    modelId: classifierModelId(),
    system: buildClassifierPrompt({ vertical: args.vertical }),
    maxTokens: 8,
    temperature: 0,
    messages: [{ role: "user", content: args.message }],
  });

  const text = res.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("")
    .toLowerCase()
    .trim();

  for (const cat of args.vertical.classifier.categories) {
    if (text.startsWith(cat)) return cat;
  }
  return args.fallback;
}
