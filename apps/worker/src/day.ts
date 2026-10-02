// Japan uses UTC+9 year-round; this quota resets at calendar midnight.
export function jstDay(now: Date | number): string {
  return new Date(Number(now) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
