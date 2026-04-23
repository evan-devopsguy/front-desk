import type { PoolClient } from "pg";
import { embedText } from "../integrations/bedrock.js";
import { toPgVector } from "./ingest.js";

export interface RetrievedChunk {
  content: string;
  sourceUrl: string | null;
  distance: number;
}

/**
 * Semantic search over a tenant's knowledge base. Must be called inside a
 * withTenant() transaction — RLS prevents cross-tenant leakage at the DB
 * layer, but we also pass tenantId explicitly as a belt-and-braces guard.
 */
export async function retrieveKnowledge(
  client: PoolClient,
  args: { tenantId: string; query: string; topK?: number },
): Promise<RetrievedChunk[]> {
  const topK = args.topK ?? 5;
  const embedding = await embedText(args.query);
  const res = await client.query(
    `SELECT content, source_url, embedding <=> $2::vector AS distance
       FROM knowledge_chunks
      WHERE tenant_id = $1
      ORDER BY embedding <=> $2::vector
      LIMIT $3`,
    [args.tenantId, toPgVector(embedding), topK],
  );
  return res.rows.map((r) => ({
    content: r.content,
    sourceUrl: r.source_url,
    distance: Number(r.distance),
  }));
}
