export function normalizeReviewAnswer(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function isReviewAnswerMatch(input, expected) {
  const normalizedInput = normalizeReviewAnswer(input);
  const normalizedExpected = normalizeReviewAnswer(expected);
  return Boolean(normalizedInput && normalizedExpected && normalizedInput === normalizedExpected);
}
