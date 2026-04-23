import * as cheerio from "cheerio";
import { withTenant } from "../db/client.js";
import { embedText } from "../integrations/bedrock.js";
import { auditWithin } from "../lib/audit.js";
import { logger } from "../lib/logger.js";

export interface IngestOptions {
  tenantId: string;
  urls: string[];
  actor?: string;
  /** Chunk size in chars; ~600 fits most product pages and stays under the
   *  embedding model's input budget comfortably. */
  chunkChars?: number;
  chunkOverlap?: number;
}

/**
 * Scrape URLs, strip boilerplate, chunk, embed, and upsert into
 * knowledge_chunks. Tenant-scoped — callers must pass tenantId.
 *
 * On re-ingest we delete the tenant's prior chunks sourced from the same URLs
 * so the KB stays clean. Other URLs for the same tenant are untouched.
 */
export async function ingestUrls(opts: IngestOptions): Promise<{
  chunks: number;
  urls: number;
}> {
  const chunkChars = opts.chunkChars ?? 600;
  const overlap = opts.chunkOverlap ?? 80;
  let totalChunks = 0;

  const texts: Array<{ url: string; chunks: string[] }> = [];
  for (const url of opts.urls) {
    try {
      const html = await fetchHtml(url);
      const text = extractText(html);
      const chunks = chunkText(text, chunkChars, overlap);
      texts.push({ url, chunks });
    } catch (err) {
      logger.warn({ url, err }, "rag: failed to fetch url");
    }
  }

  await withTenant(
    { tenantId: opts.tenantId, actor: opts.actor ?? "system" },
    async (client) => {
      // Clear prior chunks for the URLs we're re-ingesting (keeps other KB intact)
      if (opts.urls.length > 0) {
        await client.query(
          `DELETE FROM knowledge_chunks
             WHERE tenant_id = $1 AND source_url = ANY($2::text[])`,
          [opts.tenantId, opts.urls],
        );
      }

      for (const { url, chunks } of texts) {
        for (const chunk of chunks) {
          const embedding = await embedText(chunk);
          await client.query(
            `INSERT INTO knowledge_chunks (tenant_id, content, embedding, source_url)
             VALUES ($1, $2, $3::vector, $4)`,
            [opts.tenantId, chunk, toPgVector(embedding), url],
          );
          totalChunks++;
        }
      }

      await auditWithin(client, {
        tenantId: opts.tenantId,
        actor: opts.actor ?? "system",
        action: "knowledge_ingested",
        metadata: { urls: opts.urls.length, chunks: totalChunks },
      });
    },
  );

  return { chunks: totalChunks, urls: texts.length };
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "MedSpaAI-RAG/0.1 (+https://medspa.ai)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

function extractText(html: string): string {
  const $ = cheerio.load(html);
  $("script,style,noscript,nav,header,footer,svg").remove();
  const body = $("main").text() || $("body").text() || $.root().text();
  return body.replace(/\s+/g, " ").trim();
}

export function chunkText(
  text: string,
  size: number,
  overlap: number,
): string[] {
  if (text.length === 0) return [];
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(text.length, i + size);
    // Prefer to end on sentence boundary
    let boundary = end;
    if (end < text.length) {
      const window = text.slice(i, end);
      const lastStop = Math.max(
        window.lastIndexOf(". "),
        window.lastIndexOf("? "),
        window.lastIndexOf("! "),
      );
      if (lastStop > size * 0.6) boundary = i + lastStop + 1;
    }
    chunks.push(text.slice(i, boundary).trim());
    if (boundary >= text.length) break;
    i = Math.max(boundary - overlap, i + 1);
  }
  return chunks.filter((c) => c.length > 40);
}

export function toPgVector(v: number[]): string {
  return `[${v.join(",")}]`;
}
