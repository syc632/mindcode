import { defaultQwenModel } from "./qwenExtractor.js";

export const aiProvider = "qwen";

export function normalizeAiConfig(config = {}) {
  const apiKey = config.provider && config.provider !== aiProvider ? "" : String(config.apiKey || "").trim();
  return {
    provider: aiProvider,
    model: defaultQwenModel,
    apiKey,
  };
}

export function publicAiConfigStatus(config = {}) {
  const normalized = normalizeAiConfig(config);
  return {
    provider: normalized.provider,
    model: normalized.model,
    hasApiKey: Boolean(normalized.apiKey),
  };
}
