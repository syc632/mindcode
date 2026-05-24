export function formatObsidianNotes(notes = []) {
  return notes
    .map((note) => {
      const path = String(note?.path || note?.name || "未命名笔记").trim();
      const content = String(note?.content || "").trim();
      if (!content) return "";
      return `# Obsidian 笔记：${path}\n\n${content}`;
    })
    .filter(Boolean)
    .join("\n\n---\n\n");
}

export function limitToTwoSentences(value = "") {
  const normalized = String(value)
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";

  const sentences = normalized.match(/[^。！？!?]+[。！？!?]?/g) || [normalized];
  return sentences.slice(0, 2).join("").trim();
}

export function formatObsidianSummaries(notes = []) {
  return notes
    .map((note) => {
      const path = String(note?.path || note?.name || "未命名笔记").trim();
      const summary = limitToTwoSentences(note?.summary || "");
      if (!summary) return "";
      return `# Obsidian 摘要：${path}\n\n${summary}`;
    })
    .filter(Boolean)
    .join("\n\n---\n\n");
}

export function sourceTextForExtraction({ summaryText = "", rawSourceText = "" } = {}) {
  return {
    extractionText: String(summaryText || "").trim(),
    sourceText: String(rawSourceText || summaryText || "").trim(),
  };
}
