import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { getConfig } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import { mockInvokeClaude, mockEmbedText } from "./bedrock-mock.js";

const mockEnabled = () => process.env.MOCK_BEDROCK === "1";

let clientSingleton: BedrockRuntimeClient | null = null;
function client(): BedrockRuntimeClient {
  if (!clientSingleton) {
    const cfg = getConfig();
    clientSingleton = new BedrockRuntimeClient({
      region: cfg.AWS_REGION,
      ...(cfg.AWS_ACCESS_KEY_ID && cfg.AWS_SECRET_ACCESS_KEY
        ? {
            credentials: {
              accessKeyId: cfg.AWS_ACCESS_KEY_ID,
              secretAccessKey: cfg.AWS_SECRET_ACCESS_KEY,
            },
          }
        : {}),
    });
  }
  return clientSingleton;
}

// --------------------------------------------------------------------------
// Claude (reasoning + classifier) via Bedrock's Anthropic-compatible payload.
// --------------------------------------------------------------------------

export interface AnthropicMessage {
  role: "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "tool_use"; id: string; name: string; input: unknown }
        | {
            type: "tool_result";
            tool_use_id: string;
            content: string;
            is_error?: boolean;
          }
      >;
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ClaudeCallInput {
  modelId: string;
  system: string;
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

export interface ClaudeCallOutput {
  stopReason: string;
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
  >;
  usage: { inputTokens: number; outputTokens: number };
}

export async function invokeClaude(
  input: ClaudeCallInput,
): Promise<ClaudeCallOutput> {
  if (mockEnabled()) return mockInvokeClaude(input);
  const body = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: input.maxTokens ?? 1024,
    temperature: input.temperature ?? 0.3,
    system: input.system,
    messages: input.messages,
    ...(input.tools ? { tools: input.tools } : {}),
    ...(input.stopSequences ? { stop_sequences: input.stopSequences } : {}),
  };

  const cmd = new InvokeModelCommand({
    modelId: input.modelId,
    contentType: "application/json",
    accept: "application/json",
    body: new TextEncoder().encode(JSON.stringify(body)),
  });

  const res = await client().send(cmd);
  const text = new TextDecoder().decode(res.body);
  const parsed = JSON.parse(text) as {
    stop_reason: string;
    content: ClaudeCallOutput["content"];
    usage: { input_tokens: number; output_tokens: number };
  };

  return {
    stopReason: parsed.stop_reason,
    content: parsed.content,
    usage: {
      inputTokens: parsed.usage.input_tokens,
      outputTokens: parsed.usage.output_tokens,
    },
  };
}

export function reasoningModelId(): string {
  return getConfig().BEDROCK_REASONING_MODEL_ID;
}
export function classifierModelId(): string {
  return getConfig().BEDROCK_CLASSIFIER_MODEL_ID;
}

// --------------------------------------------------------------------------
// Titan Text Embeddings v2 (1024 dims — matches schema VECTOR(1024))
// --------------------------------------------------------------------------

export async function embedText(text: string): Promise<number[]> {
  if (mockEnabled()) return mockEmbedText(text);
  const cmd = new InvokeModelCommand({
    modelId: getConfig().BEDROCK_EMBEDDING_MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: new TextEncoder().encode(
      JSON.stringify({ inputText: text, dimensions: 1024, normalize: true }),
    ),
  });
  const res = await client().send(cmd);
  const parsed = JSON.parse(new TextDecoder().decode(res.body)) as {
    embedding: number[];
  };
  if (!Array.isArray(parsed.embedding) || parsed.embedding.length !== 1024) {
    logger.error(
      { len: parsed.embedding?.length },
      "unexpected embedding dimension",
    );
    throw new Error("unexpected embedding dimension from Bedrock");
  }
  return parsed.embedding;
}
