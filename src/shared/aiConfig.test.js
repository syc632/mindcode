import { describe, expect, it } from "vitest";
import { normalizeAiConfig, publicAiConfigStatus } from "./aiConfig.js";

describe("aiConfig", () => {
  it("normalizes Qwen config defaults", () => {
    expect(normalizeAiConfig({ apiKey: "  sk-test  " })).toEqual({
      provider: "qwen",
      model: "qwen3.6-plus",
      apiKey: "sk-test",
    });
  });

  it("drops API keys saved for another provider", () => {
    expect(normalizeAiConfig({ provider: "deepseek", apiKey: "sk-old" }).apiKey).toBe("");
  });

  it("does not expose the API key in public status", () => {
    expect(publicAiConfigStatus({ apiKey: "sk-secret" })).toEqual({
      provider: "qwen",
      model: "qwen3.6-plus",
      hasApiKey: true,
    });
  });
});
