export const extractionSourceSnippetLimit = 4000;

export function sourcesForAcceptedNode(node, sourceText, createdAt = Date.now()) {
  const nodeSources = Array.isArray(node?.sources)
    ? node.sources
        .map((source) => ({
          text: String(source?.text || "").trim(),
          createdAt: Number(source?.createdAt ?? createdAt),
        }))
        .filter((source) => source.text)
    : [];

  if (nodeSources.length) return nodeSources;

  const sourceSnippet = String(sourceText || "").trim().slice(0, extractionSourceSnippetLimit);
  return sourceSnippet ? [{ text: sourceSnippet, createdAt }] : [];
}
