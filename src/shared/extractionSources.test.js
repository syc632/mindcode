import { describe, expect, it } from "vitest";
import { extractionSourceSnippetLimit, sourcesForAcceptedNode } from "./extractionSources.js";

describe("extractionSources", () => {
  it("keeps node-specific source summaries instead of reusing the full document snippet", () => {
    const sources = sourcesForAcceptedNode(
      {
        sources: [{ text: "Summary: Angular momentum is conserved when net external torque is zero.", createdAt: 12 }],
      },
      "Global PDF text that starts with a cover page and table of contents.",
      99,
    );

    expect(sources).toEqual([
      { text: "Summary: Angular momentum is conserved when net external torque is zero.", createdAt: 12 },
    ]);
  });

  it("falls back to a clipped document snippet when no node-specific source exists", () => {
    const sources = sourcesForAcceptedNode({ sources: [] }, ` ${"A".repeat(extractionSourceSnippetLimit + 10)} `, 99);

    expect(sources).toEqual([{ text: "A".repeat(extractionSourceSnippetLimit), createdAt: 99 }]);
  });
});
