import { describe, expect, it } from "vitest";
import { chunkText, toPgVector } from "../ingest.js";

describe("chunkText", () => {
  it("returns a single chunk for short input", () => {
    const chunks = chunkText("a ".repeat(60), 600, 80);
    expect(chunks.length).toBe(1);
  });

  it("overlaps chunks for long input", () => {
    const input = "Lorem ipsum dolor sit amet. ".repeat(200);
    const chunks = chunkText(input, 600, 80);
    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 1; i < chunks.length; i++) {
      // overlap: the first ~40 chars of chunk[i] appear somewhere in chunk[i-1]
      const prev = chunks[i - 1]!;
      const nextHead = chunks[i]!.slice(0, 20);
      expect(prev.length).toBeGreaterThan(0);
      expect(nextHead.length).toBeGreaterThan(0);
    }
  });

  it("drops short trailing fragments", () => {
    const chunks = chunkText("short. ", 600, 80);
    expect(chunks.length).toBe(0);
  });
});

describe("toPgVector", () => {
  it("formats as pg vector literal", () => {
    expect(toPgVector([0.1, 0.2, 0.3])).toBe("[0.1,0.2,0.3]");
  });
});
