import { describe, expect, it } from "vitest";
import { isDue, sm2 } from "./sm2.js";

const baseCard = {
  ef: 2.5,
  interval: 1,
  repetitions: 0,
  nextReview: 0,
};

describe("sm2", () => {
  it("resets repetitions when quality is below 3", () => {
    const result = sm2({ ...baseCard, repetitions: 4, interval: 10 }, 2, 1000);

    expect(result.repetitions).toBe(0);
    expect(result.interval).toBe(1);
    expect(result.nextReview).toBe(86401000);
  });

  it("advances first successful review to one day", () => {
    const result = sm2(baseCard, 4, 1000);

    expect(result.repetitions).toBe(1);
    expect(result.interval).toBe(1);
    expect(result.ef).toBeCloseTo(2.5);
  });

  it("advances second successful review to six days", () => {
    const result = sm2({ ...baseCard, repetitions: 1, interval: 1 }, 5, 1000);

    expect(result.repetitions).toBe(2);
    expect(result.interval).toBe(6);
    expect(result.ef).toBeCloseTo(2.6);
  });

  it("keeps easiness factor above 1.3", () => {
    const result = sm2({ ...baseCard, ef: 1.31 }, 0, 1000);

    expect(result.ef).toBe(1.3);
  });
});

describe("isDue", () => {
  it("treats missing nextReview as due", () => {
    expect(isDue({}, 1000)).toBe(true);
  });

  it("detects past and future due dates", () => {
    expect(isDue({ nextReview: 999 }, 1000)).toBe(true);
    expect(isDue({ nextReview: 1001 }, 1000)).toBe(false);
  });
});
