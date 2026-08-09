// ─── Cron matching ────────────────────────────────────────────────────

/**
 * Check whether a cron expression matches the given time (default: now).
 * Standard 5-field cron: minute hour day month weekday
 */
export function matchesCron(expression: string, now: Date = new Date()): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minPart, hourPart, domPart, monPart, dowPart] = parts;
  const m = now.getMinutes();
  const h = now.getHours();
  const dom = now.getDate();
  const mon = now.getMonth() + 1;
  const dow = now.getDay();
  return (
    matchCronPart(minPart, m, 0, 59) &&
    matchCronPart(hourPart, h, 0, 23) &&
    matchCronPart(domPart, dom, 1, 31) &&
    matchCronPart(monPart, mon, 1, 12) &&
    matchCronPart(dowPart, dow, 0, 6)
  );
}

function matchCronPart(part: string, val: number, _min: number, max: number): boolean {
  if (part === "*") return true;
  if (part.includes(",")) return part.split(",").some((p) => matchCronPart(p.trim(), val, _min, max));
  if (part.includes("-")) {
    const [lo, hi] = part.split("-").map(Number);
    return val >= lo && val <= hi;
  }
  if (part.startsWith("*/")) {
    const step = Number(part.slice(2));
    return step > 0 && val % step === 0;
  }
  return Number(part) === val;
}
