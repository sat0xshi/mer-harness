import { calendar } from "./gameConfig";
// JST has no DST; new game features use calendar midnight, independent of user settings.
export function jstDay(now: Date | number): string {
  return new Date(Number(now) + calendar.jstOffsetMs).toISOString().slice(0, 10);
}
export const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / calendar.dayMs;
export const jstDayNumber = (now: number) => dayNumber(jstDay(now));
