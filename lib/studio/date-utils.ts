export function buildPaddedDays(
  days: { date: string; count: number }[],
  weekCount: number,
): { date: string; count: number }[] {
  const paddedDays: { date: string; count: number }[] = [];
  const today = new Date();
  for (let i = weekCount * 7 - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const existing = days.find((x) => x.date === dateStr);
    paddedDays.push({ date: dateStr, count: existing?.count ?? 0 });
  }
  return paddedDays;
}
