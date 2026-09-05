const DAY_MS = 86400000;

export function sm2(card, quality, now = Date.now()) {
  const normalizedQuality = Math.max(0, Math.min(5, Number(quality)));
  let ef = Number(card.ef ?? 2.5);
  let interval = Number(card.interval ?? 1);
  let repetitions = Number(card.repetitions ?? 0);

  if (normalizedQuality < 3) {
    repetitions = 0;
    interval = 1;
  } else {
    if (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = 6;
    else interval = Math.max(1, Math.round(interval * ef));
    repetitions += 1;
  }

  ef = Math.max(
    1.3,
    ef + 0.1 - (5 - normalizedQuality) * (0.08 + (5 - normalizedQuality) * 0.02),
  );

  return {
    ef,
    interval,
    repetitions,
    nextReview: now + interval * DAY_MS,
    updatedAt: now,
  };
}

export function isDue(card, now = Date.now()) {
  return !card.nextReview || now >= card.nextReview;
}

export function daysUntil(timestamp, now = Date.now()) {
  const days = Math.ceil((timestamp - now) / DAY_MS);
  if (days <= 0) return "Due today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}
