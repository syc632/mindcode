import { describe, expect, it } from "vitest";
import { isReviewAnswerMatch, normalizeReviewAnswer } from "./reviewAnswer.js";

describe("review answer matching", () => {
  it("normalizes whitespace and case", () => {
    expect(normalizeReviewAnswer("  Async   Await\nFlow  ")).toBe("async await flow");
  });

  it("matches answers after normalization", () => {
    expect(isReviewAnswerMatch("  Promise   Result ", "promise result")).toBe(true);
  });

  it("matches multiline answers when normalized text is equal", () => {
    expect(isReviewAnswerMatch("事件循环\n协调任务", "事件循环 协调任务")).toBe(true);
  });

  it("rejects empty input", () => {
    expect(isReviewAnswerMatch("", "正确答案")).toBe(false);
    expect(isReviewAnswerMatch("   ", "正确答案")).toBe(false);
  });

  it("rejects different answers", () => {
    expect(isReviewAnswerMatch("宏任务", "微任务")).toBe(false);
  });
});
