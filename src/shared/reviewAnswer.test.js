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
    expect(isReviewAnswerMatch("event loop\ncoordinates tasks", "event loop coordinates tasks")).toBe(true);
  });

  it("rejects empty input", () => {
    expect(isReviewAnswerMatch("", "correct answer")).toBe(false);
    expect(isReviewAnswerMatch("   ", "correct answer")).toBe(false);
  });

  it("rejects different answers", () => {
    expect(isReviewAnswerMatch("macrotask", "microtask")).toBe(false);
  });
});
