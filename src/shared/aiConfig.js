import { defaultDeepSeekModel } from "./deepseekExtractor.js";

export const aiProvider = "deepseek";

export function normalizeAiConfig(config = {}) {
  return {
    provider: aiProvider,
    model: String(config.model || defaultDeepSeekModel).trim() || defaultDeepSeekModel,
    apiKey: String(config.apiKey || "").trim(),
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
